import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import { EventStreamManager } from "../event-stream";
import { WorkflowEventEmitter } from "../event-emitter";
import type { 
  WorkflowEvent, 
  NodeProgressEvent, 
  WorkflowStatusEvent,
  ProgressPayload 
} from "../event-types";
import type { IExecutionStateStore } from "../../types";
import type { NodeJobData } from "../types";

/**
 * Integration tests for the simplified event streaming implementation.
 * 
 * **Feature: bullmq-improvements, Task 2.5.7: Event streaming tests**
 * **Validates: Requirements FR-6.1, FR-6.2, FR-6.3, FR-6.4**
 * 
 * These tests verify end-to-end event streaming behavior:
 * - Events emitted via job.updateProgress() are received by subscribers
 * - Native completed/failed events are handled correctly
 * - Local event emission works for workflow status events
 * - Subscription filtering works correctly
 */

// ============================================================================
// MOCK STATE STORE
// ============================================================================

const mockStateStore: IExecutionStateStore = {
  createExecution: async () => 'mock-exec-id',
  getExecution: async (executionId: string) => ({
    executionId,
    workflowId: 'test-workflow',
    status: 'running',
    nodeResults: {},
    startedAt: new Date(),
    completedAt: null,
    depth: 0,
    parentExecutionId: null,
    inputData: {},
    metadata: {},
  }),
  setExecutionStatus: async () => {},
  updateNodeResult: async () => {},
  getNodeResults: async () => ({}),
  cacheNodeResult: async () => {},
  getPendingNodeCount: async () => 0,
  updateExecutionMetadata: async () => {},
  addLog: async () => {},
  getLogs: async () => [],
  addSpan: async () => {},
  updateSpan: async () => {},
  getTrace: async () => null,
  saveWorkflow: async () => 1,
  getWorkflow: async () => null,
  getWorkflowVersion: async () => null,
  listWorkflows: async () => [],
  deactivateWorkflow: async () => {},
};

// ============================================================================
// TEST SETUP
// ============================================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_QUEUE_NAME = 'test-event-streaming';

describe("Event streaming integration tests", () => {
  let redis: Redis;
  let testQueue: Queue<NodeJobData>;
  let testWorker: Worker<NodeJobData>;
  let eventStreamManager: EventStreamManager;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    
    await new Promise<void>((resolve, reject) => {
      redis.on('ready', resolve);
      redis.on('error', reject);
      setTimeout(() => reject(new Error('Redis connection timeout')), 5000);
    });
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Create test queue with same prefix as EventStreamManager expects
    testQueue = new Queue<NodeJobData>('node-execution', { 
      connection: redis,
      prefix: 'spane',
    });
    
    eventStreamManager = new EventStreamManager(redis, mockStateStore);
    await eventStreamManager.start();
    
    // Clean up any existing jobs
    await testQueue.obliterate({ force: true });
    
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    if (testWorker) {
      await testWorker.close();
    }
    await eventStreamManager.close();
    await testQueue.close();
  });

  describe("Progress event streaming via job.updateProgress()", () => {
    test("node progress events are received by subscribers", async () => {
      const executionId = 'exec-test-progress';
      const workflowId = 'wf-test';
      const nodeId = 'node-1';

      let receivedEvent: WorkflowEvent | null = null;
      const subscription = eventStreamManager.subscribe(executionId);
      const iterator = subscription[Symbol.asyncIterator]();

      // Create a worker that emits progress events
      testWorker = new Worker<NodeJobData>(
        'node-execution',
        async (job: Job<NodeJobData>) => {
          // Emit node started event via updateProgress
          await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);
          return { success: true };
        },
        { connection: redis, prefix: 'spane' }
      );

      // Add a job to trigger the worker
      await testQueue.add('test-job', {
        executionId,
        workflowId,
        nodeId,
        inputData: {},
      });

      // Wait for the progress event
      const result = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 3000)
        ),
      ]);

      if (!result.done && result.value) {
        receivedEvent = result.value;
      }

      await iterator.return?.();

      // Verify the event was received
      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.type).toBe('node:progress');
      
      const nodeEvent = receivedEvent as NodeProgressEvent;
      expect(nodeEvent.executionId).toBe(executionId);
      expect(nodeEvent.nodeId).toBe(nodeId);
      expect(nodeEvent.status).toBe('running');
    });

    test("node completed events are received via native completed handler", async () => {
      const executionId = 'exec-test-completed';
      const workflowId = 'wf-test';
      const nodeId = 'node-completed';

      const receivedEvents: WorkflowEvent[] = [];
      const subscription = eventStreamManager.subscribe(executionId);
      const iterator = subscription[Symbol.asyncIterator]();

      // Create a worker that completes successfully
      testWorker = new Worker<NodeJobData>(
        'node-execution',
        async (job: Job<NodeJobData>) => {
          return { success: true, data: { result: 'test-output' } };
        },
        { connection: redis, prefix: 'spane' }
      );

      // Add a job
      await testQueue.add('test-job', {
        executionId,
        workflowId,
        nodeId,
        inputData: {},
      });

      // Collect events with timeout
      const collectEvents = async () => {
        for (let i = 0; i < 3; i++) {
          const result = await Promise.race([
            iterator.next(),
            new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
              setTimeout(() => resolve({ value: undefined, done: true }), 1000)
            ),
          ]);

          if (!result.done && result.value) {
            receivedEvents.push(result.value);
          } else {
            break;
          }
        }
      };

      await collectEvents();
      await iterator.return?.();

      // Should receive at least one completed event
      const completedEvents = receivedEvents.filter(
        e => e.type === 'node:progress' && (e as NodeProgressEvent).status === 'completed'
      );
      
      expect(completedEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Local event emission via emitLocal()", () => {
    test("workflow status events are delivered to local subscribers", async () => {
      const executionId = 'exec-local-test';
      const workflowId = 'wf-local';

      let receivedEvent: WorkflowEvent | null = null;
      const subscription = eventStreamManager.subscribe(executionId);
      const iterator = subscription[Symbol.asyncIterator]();

      // Emit a workflow status event locally
      const statusEvent: WorkflowStatusEvent = {
        type: 'workflow:status',
        timestamp: Date.now(),
        executionId,
        workflowId,
        status: 'started',
      };

      eventStreamManager.emitLocal(statusEvent);

      // Receive the event
      const result = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500)
        ),
      ]);

      if (!result.done && result.value) {
        receivedEvent = result.value;
      }

      await iterator.return?.();

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent).toEqual(statusEvent);
    });

    test("multiple subscribers receive the same local event", async () => {
      const executionId = 'exec-multi-sub';
      const workflowId = 'wf-multi';

      const receivedEvents: WorkflowEvent[][] = [[], [], []];
      const iterators: AsyncIterator<WorkflowEvent>[] = [];

      // Create multiple subscribers
      for (let i = 0; i < 3; i++) {
        const subscription = eventStreamManager.subscribe(executionId);
        iterators.push(subscription[Symbol.asyncIterator]());
      }

      // Emit event
      const statusEvent: WorkflowStatusEvent = {
        type: 'workflow:status',
        timestamp: Date.now(),
        executionId,
        workflowId,
        status: 'completed',
      };

      eventStreamManager.emitLocal(statusEvent);

      // Collect from all subscribers
      for (let i = 0; i < iterators.length; i++) {
        const result = await Promise.race([
          iterators[i].next(),
          new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: true }), 500)
          ),
        ]);

        if (!result.done && result.value) {
          receivedEvents[i].push(result.value);
        }
      }

      // Cleanup
      for (const iterator of iterators) {
        await iterator.return?.();
      }

      // All subscribers should receive the event
      for (const events of receivedEvents) {
        expect(events.length).toBe(1);
        expect(events[0]).toEqual(statusEvent);
      }
    });
  });

  describe("Subscription filtering", () => {
    test("filtered subscription only receives matching events", async () => {
      const targetExecId = 'exec-target';
      const otherExecId = 'exec-other';

      const receivedEvents: WorkflowEvent[] = [];
      const subscription = eventStreamManager.subscribe(targetExecId);
      const iterator = subscription[Symbol.asyncIterator]();

      // Emit events for different executions
      const otherEvent: WorkflowStatusEvent = {
        type: 'workflow:status',
        timestamp: Date.now(),
        executionId: otherExecId,
        workflowId: 'wf-other',
        status: 'started',
      };

      const targetEvent: WorkflowStatusEvent = {
        type: 'workflow:status',
        timestamp: Date.now(),
        executionId: targetExecId,
        workflowId: 'wf-target',
        status: 'started',
      };

      eventStreamManager.emitLocal(otherEvent);
      eventStreamManager.emitLocal(targetEvent);

      // Collect events
      const result = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500)
        ),
      ]);

      if (!result.done && result.value) {
        receivedEvents.push(result.value);
      }

      await iterator.return?.();

      // Should only receive the target event
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0]).toEqual(targetEvent);
    });
  });

  describe("EventStreamManager lifecycle", () => {
    test("isRunning() returns correct state", async () => {
      const manager = new EventStreamManager(redis, mockStateStore);
      
      expect(manager.isRunning()).toBe(false);
      
      await manager.start();
      expect(manager.isRunning()).toBe(true);
      
      await manager.close();
      expect(manager.isRunning()).toBe(false);
    });

    test("getSubscriptionCount() tracks active subscriptions", async () => {
      expect(eventStreamManager.getSubscriptionCount()).toBe(0);

      const sub1 = eventStreamManager.subscribe();
      const iter1 = sub1[Symbol.asyncIterator]();
      
      // Subscription count increases when iterator is created and handler attached
      // The handler is attached when we call next() or when the iterator is created
      // Let's trigger the handler attachment by calling next with a timeout
      const nextPromise = iter1.next();
      
      // Give time for the handler to be attached
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(eventStreamManager.getSubscriptionCount()).toBe(1);

      const sub2 = eventStreamManager.subscribe();
      const iter2 = sub2[Symbol.asyncIterator]();
      iter2.next(); // Trigger handler attachment
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(eventStreamManager.getSubscriptionCount()).toBe(2);

      // Cleanup
      await iter1.return?.();
      await iter2.return?.();
    });

    test("getExecutionState() returns execution state", async () => {
      const executionId = 'exec-state-test';
      
      const state = await eventStreamManager.getExecutionState(executionId);
      
      expect(state).not.toBeNull();
      expect(state!.type).toBe('execution:state');
      expect(state!.executionId).toBe(executionId);
      expect(state!.workflowId).toBe('test-workflow');
    });
  });
});
