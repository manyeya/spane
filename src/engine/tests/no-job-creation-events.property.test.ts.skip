import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { EventStreamManager } from "../event-stream";
import type { WorkflowStatusEvent, WorkflowStatus } from "../event-types";
import type { IExecutionStateStore } from "../../types";

/**
 * Property-based tests for no job creation on event emission.
 * 
 * **Feature: architecture-refactor, Property 3: No job creation for events**
 * **Validates: Requirements 1.3**
 * 
 * These tests verify that:
 * - Workflow status events (started, cancelled, paused, completed) do not create BullMQ jobs
 * - Event emission uses direct EventStreamManager.emitLocal() without nodeQueue.add()
 */

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const timestampArb = fc.integer({ min: 1700000000000, max: 2000000000000 });
const optionalErrorArb = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined });

const workflowStatusArb: fc.Arbitrary<WorkflowStatus> = fc.constantFrom(
  'started', 'completed', 'failed', 'paused', 'cancelled'
);

const workflowStatusEventArb: fc.Arbitrary<WorkflowStatusEvent> = fc.record({
  type: fc.constant('workflow:status' as const),
  timestamp: timestampArb,
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  status: workflowStatusArb,
  error: optionalErrorArb,
});

// ============================================================================
// MOCK STATE STORE
// ============================================================================

/**
 * Minimal mock of IExecutionStateStore for testing
 */
const mockStateStore: IExecutionStateStore = {
  createExecution: async () => 'mock-exec-id',
  getExecution: async () => null,
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
const NODE_QUEUE_NAME = 'node-execution';

describe("No job creation for events property tests", () => {
  let redis: Redis;
  let nodeQueue: Queue;
  let eventStreamManager: EventStreamManager;

  beforeAll(async () => {
    // Create Redis connection
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    
    // Wait for Redis connection
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
    // Create queue and event stream manager
    nodeQueue = new Queue(NODE_QUEUE_NAME, { connection: redis });
    eventStreamManager = new EventStreamManager(redis, mockStateStore);
    
    // Start the event stream manager
    await eventStreamManager.start();
    
    // Clean up any existing jobs in the queue
    await nodeQueue.obliterate({ force: true });
    
    // Give time for connections to establish
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    await eventStreamManager.close();
    await nodeQueue.close();
  });

  /**
   * **Feature: architecture-refactor, Property 3: No job creation for events**
   * 
   * *For any* workflow status change (started, cancelled, paused, completed), 
   * the nodeQueue job count SHALL NOT increase as a result of event emission.
   * 
   * **Validates: Requirements 1.3**
   */
  describe("Property 3: No job creation for events", () => {
    test("emitting workflow events does not create jobs in nodeQueue", async () => {
      await fc.assert(
        fc.asyncProperty(workflowStatusEventArb, async (event) => {
          // Get initial job count
          const initialCounts = await nodeQueue.getJobCounts();
          const initialTotal = 
            (initialCounts.waiting ?? 0) + 
            (initialCounts.active ?? 0) + 
            (initialCounts.delayed ?? 0) + 
            (initialCounts.prioritized ?? 0);

          // Emit the workflow event via EventStreamManager
          eventStreamManager.emitLocal(event);

          // Wait a bit for any potential job creation
          await new Promise(resolve => setTimeout(resolve, 50));

          // Get final job count
          const finalCounts = await nodeQueue.getJobCounts();
          const finalTotal = 
            (finalCounts.waiting ?? 0) + 
            (finalCounts.active ?? 0) + 
            (finalCounts.delayed ?? 0) + 
            (finalCounts.prioritized ?? 0);

          // Property: job count should not increase
          expect(finalTotal).toBe(initialTotal);
        }),
        { numRuns: 50 }
      );
    });

    test("multiple event emissions do not accumulate jobs", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(workflowStatusEventArb, { minLength: 1, maxLength: 10 }),
          async (events) => {
            // Get initial job count
            const initialCounts = await nodeQueue.getJobCounts();
            const initialTotal = 
              (initialCounts.waiting ?? 0) + 
              (initialCounts.active ?? 0) + 
              (initialCounts.delayed ?? 0) + 
              (initialCounts.prioritized ?? 0);

            // Emit all events
            for (const event of events) {
              eventStreamManager.emitLocal(event);
            }

            // Wait a bit for any potential job creation
            await new Promise(resolve => setTimeout(resolve, 100));

            // Get final job count
            const finalCounts = await nodeQueue.getJobCounts();
            const finalTotal = 
              (finalCounts.waiting ?? 0) + 
              (finalCounts.active ?? 0) + 
              (finalCounts.delayed ?? 0) + 
              (finalCounts.prioritized ?? 0);

            // Property: job count should not increase regardless of number of events
            expect(finalTotal).toBe(initialTotal);
          }
        ),
        { numRuns: 20 }
      );
    });

    test("no emit-workflow-event jobs are created", async () => {
      await fc.assert(
        fc.asyncProperty(workflowStatusEventArb, async (event) => {
          // Emit the workflow event
          eventStreamManager.emitLocal(event);

          // Wait a bit for any potential job creation
          await new Promise(resolve => setTimeout(resolve, 50));

          // Check for any jobs with the old 'emit-workflow-event' name
          const allJobs = await nodeQueue.getJobs(['waiting', 'active', 'delayed', 'prioritized']);
          const eventJobs = allJobs.filter(job => job.name === 'emit-workflow-event');

          // Property: no emit-workflow-event jobs should exist
          expect(eventJobs.length).toBe(0);
        }),
        { numRuns: 50 }
      );
    });

    test("event emission for all status types does not create jobs", async () => {
      const statuses: WorkflowStatus[] = ['started', 'completed', 'failed', 'paused', 'cancelled'];
      
      for (const status of statuses) {
        // Get initial job count
        const initialCounts = await nodeQueue.getJobCounts();
        const initialTotal = 
          (initialCounts.waiting ?? 0) + 
          (initialCounts.active ?? 0) + 
          (initialCounts.delayed ?? 0) + 
          (initialCounts.prioritized ?? 0);

        // Create and emit event for this status
        const event: WorkflowStatusEvent = {
          type: 'workflow:status',
          timestamp: Date.now(),
          executionId: `exec-test-${status}`,
          workflowId: `wf-test-${status}`,
          status,
        };

        eventStreamManager.emitLocal(event);

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 50));

        // Get final job count
        const finalCounts = await nodeQueue.getJobCounts();
        const finalTotal = 
          (finalCounts.waiting ?? 0) + 
          (finalCounts.active ?? 0) + 
          (finalCounts.delayed ?? 0) + 
          (finalCounts.prioritized ?? 0);

        // Property: job count should not increase for any status type
        expect(finalTotal).toBe(initialTotal);
      }
    });
  });
});
