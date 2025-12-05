import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "events";
import type {
  WorkflowEvent,
  NodeProgressEvent,
  ExecutionStateEvent,
  ErrorEvent,
} from "../event-types";
import type { IExecutionStateStore, ExecutionState, ExecutionResult } from "../../types";

/**
 * Integration tests for SSE endpoints.
 * 
 * These tests verify:
 * - Connection to SSE endpoint with executionId filter
 * - Initial state event sent on connect (Requirements 6.1, 6.2)
 * - Event reception and filtering (Requirements 2.1, 2.3)
 * - Client disconnection and cleanup (Requirements 2.3)
 * - Error handling for non-existent executions (Requirements 6.3)
 * - Reconnection capability (Requirements 2.4)
 * 
 * **Validates: Requirements 2.1, 2.3, 2.4, 6.1, 6.2, 6.3**
 */

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

/**
 * Mock EventStreamManager for testing SSE endpoint behavior
 */
class MockEventStreamManager {
  private emitter: EventEmitter;
  private mockExecutions: Map<string, ExecutionState>;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(1000);
    this.mockExecutions = new Map();
  }

  /**
   * Add a mock execution for testing
   */
  addExecution(execution: ExecutionState): void {
    this.mockExecutions.set(execution.executionId, execution);
  }

  /**
   * Emit an event (simulates receiving from QueueEvents)
   */
  emit(event: WorkflowEvent): void {
    this.emitter.emit('event', event);
  }

  /**
   * Get execution state for initial sync
   */
  async getExecutionState(executionId: string): Promise<ExecutionStateEvent | null> {
    const execution = this.mockExecutions.get(executionId);
    
    if (!execution) {
      return null;
    }

    return {
      type: 'execution:state',
      timestamp: Date.now(),
      executionId: execution.executionId,
      workflowId: execution.workflowId,
      status: execution.status,
      nodeResults: execution.nodeResults,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt?.toISOString(),
    };
  }

  /**
   * Subscribe to events with optional executionId filter
   */
  subscribe(executionId?: string): AsyncIterable<WorkflowEvent> {
    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
        let eventQueue: WorkflowEvent[] = [];
        let resolveNext: ((value: IteratorResult<WorkflowEvent>) => void) | null = null;
        let isDone = false;

        const handler = (event: WorkflowEvent) => {
          // Filter by executionId if provided
          if (executionId && 'executionId' in event && event.executionId !== executionId) {
            return;
          }

          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve({ value: event, done: false });
          } else {
            eventQueue.push(event);
          }
        };

        self.emitter.on('event', handler);

        return {
          async next(): Promise<IteratorResult<WorkflowEvent>> {
            if (isDone) {
              return { value: undefined, done: true };
            }

            if (eventQueue.length > 0) {
              return { value: eventQueue.shift()!, done: false };
            }

            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },

          async return(): Promise<IteratorResult<WorkflowEvent>> {
            isDone = true;
            self.emitter.off('event', handler);
            eventQueue = [];
            if (resolveNext) {
              resolveNext({ value: undefined, done: true });
              resolveNext = null;
            }
            return { value: undefined, done: true };
          },

          async throw(error: Error): Promise<IteratorResult<WorkflowEvent>> {
            isDone = true;
            self.emitter.off('event', handler);
            eventQueue = [];
            throw error;
          },
        };
      },
    };
  }

  getSubscriptionCount(): number {
    return this.emitter.listenerCount('event');
  }
}

/**
 * Simulates SSE endpoint behavior for testing.
 * This creates a stream that properly handles async event subscription.
 */
class SSEEndpointSimulator {
  constructor(private eventStreamManager: MockEventStreamManager) {}

  /**
   * Simulate GET /api/executions/:executionId/stream
   * Returns an async iterable that yields SSE-formatted events
   */
  streamExecution(executionId: string): {
    iterator: AsyncIterator<string>;
    cleanup: () => Promise<void>;
  } {
    const eventStreamManager = this.eventStreamManager;
    let subscriptionIterator: AsyncIterator<WorkflowEvent> | null = null;
    let initialStateSent = false;
    let errorSent = false;

    const iterator: AsyncIterator<string> = {
      async next(): Promise<IteratorResult<string>> {
        // First, send initial state
        if (!initialStateSent && !errorSent) {
          const initialState = await eventStreamManager.getExecutionState(executionId);

          if (!initialState) {
            // Execution not found - send error event (Requirement 6.3)
            errorSent = true;
            const errorEvent: ErrorEvent = {
              type: 'error',
              message: `Execution ${executionId} not found`,
              code: 'EXECUTION_NOT_FOUND',
            };
            return { value: `data: ${JSON.stringify(errorEvent)}\n\n`, done: false };
          }

          initialStateSent = true;
          // Start subscription after initial state
          const subscription = eventStreamManager.subscribe(executionId);
          subscriptionIterator = subscription[Symbol.asyncIterator]();
          return { value: `data: ${JSON.stringify(initialState)}\n\n`, done: false };
        }

        // If error was sent, we're done
        if (errorSent) {
          return { value: undefined as any, done: true };
        }

        // Stream events from subscription
        if (subscriptionIterator) {
          const result = await subscriptionIterator.next();
          if (result.done) {
            return { value: undefined as any, done: true };
          }
          return { value: `data: ${JSON.stringify(result.value)}\n\n`, done: false };
        }

        return { value: undefined as any, done: true };
      },

      async return(): Promise<IteratorResult<string>> {
        if (subscriptionIterator?.return) {
          await subscriptionIterator.return();
        }
        return { value: undefined as any, done: true };
      },
    };

    return {
      iterator,
      cleanup: async () => {
        if (subscriptionIterator?.return) {
          await subscriptionIterator.return();
        }
      },
    };
  }

  /**
   * Simulate GET /api/executions/stream (all events)
   */
  streamAllEvents(): {
    iterator: AsyncIterator<string>;
    cleanup: () => Promise<void>;
  } {
    const subscription = this.eventStreamManager.subscribe();
    const subscriptionIterator = subscription[Symbol.asyncIterator]();

    const iterator: AsyncIterator<string> = {
      async next(): Promise<IteratorResult<string>> {
        const result = await subscriptionIterator.next();
        if (result.done) {
          return { value: undefined as any, done: true };
        }
        return { value: `data: ${JSON.stringify(result.value)}\n\n`, done: false };
      },

      async return(): Promise<IteratorResult<string>> {
        if (subscriptionIterator.return) {
          await subscriptionIterator.return();
        }
        return { value: undefined as any, done: true };
      },
    };

    return {
      iterator,
      cleanup: async () => {
        if (subscriptionIterator.return) {
          await subscriptionIterator.return();
        }
      },
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createMockExecution(executionId: string, workflowId: string): ExecutionState {
  return {
    executionId,
    workflowId,
    status: 'running',
    nodeResults: {
      'node-1': { success: true, data: { result: 'test' } },
    },
    startedAt: new Date(),
    depth: 0,
  };
}

function parseSSEData(sseMessage: string): WorkflowEvent | ErrorEvent | null {
  const match = sseMessage.match(/^data: (.+)\n\n$/);
  if (match && match[1]) {
    return JSON.parse(match[1]);
  }
  return null;
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("SSE endpoint integration tests", () => {
  let eventStreamManager: MockEventStreamManager;
  let sseEndpoint: SSEEndpointSimulator;

  beforeEach(() => {
    eventStreamManager = new MockEventStreamManager();
    sseEndpoint = new SSEEndpointSimulator(eventStreamManager);
  });

  /**
   * Test initial state event on connect
   * **Validates: Requirements 6.1, 6.2**
   */
  describe("Initial state on connect", () => {
    test("sends initial state event as first event when execution exists", async () => {
      const executionId = "exec-test-123";
      const workflowId = "wf-test";
      
      // Add mock execution
      eventStreamManager.addExecution(createMockExecution(executionId, workflowId));

      // Start streaming
      const { iterator, cleanup } = sseEndpoint.streamExecution(executionId);

      // Get first event
      const firstResult = await iterator.next();
      expect(firstResult.done).toBe(false);

      const firstEvent = parseSSEData(firstResult.value as string);
      expect(firstEvent).not.toBeNull();
      expect(firstEvent!.type).toBe('execution:state');
      
      const stateEvent = firstEvent as ExecutionStateEvent;
      expect(stateEvent.executionId).toBe(executionId);
      expect(stateEvent.workflowId).toBe(workflowId);
      expect(stateEvent.status).toBe('running');
      expect(stateEvent.nodeResults).toHaveProperty('node-1');
      expect(stateEvent.startedAt).toBeDefined();

      // Cleanup
      await cleanup();
    });

    test("sends error event and closes when execution does not exist", async () => {
      const nonExistentId = "exec-does-not-exist";

      // Start streaming (no execution added)
      const { iterator, cleanup } = sseEndpoint.streamExecution(nonExistentId);

      // Get first (and only) event
      const firstResult = await iterator.next();
      expect(firstResult.done).toBe(false);

      const errorEvent = parseSSEData(firstResult.value as string) as ErrorEvent;
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.message).toContain(nonExistentId);
      expect(errorEvent.code).toBe('EXECUTION_NOT_FOUND');

      // Stream should be done after error
      const secondResult = await iterator.next();
      expect(secondResult.done).toBe(true);

      await cleanup();
    });
  });

  /**
   * Test event reception and filtering
   * **Validates: Requirements 2.1, 2.3**
   */
  describe("Event reception and filtering", () => {
    test("receives events matching the executionId filter", async () => {
      const executionId = "exec-filter-test";
      const workflowId = "wf-filter";
      
      eventStreamManager.addExecution(createMockExecution(executionId, workflowId));

      const { iterator, cleanup } = sseEndpoint.streamExecution(executionId);

      // Skip initial state event
      await iterator.next();

      // Emit a matching event
      const matchingEvent: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId,
        nodeId: 'node-2',
        workflowId,
        status: 'running',
      };
      eventStreamManager.emit(matchingEvent);

      // Should receive the matching event
      const result = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ value: '', done: true }), 100)
        ),
      ]);

      expect(result.done).toBe(false);
      const receivedEvent = parseSSEData(result.value as string) as NodeProgressEvent;
      expect(receivedEvent.type).toBe('node:progress');
      expect(receivedEvent.executionId).toBe(executionId);
      expect(receivedEvent.nodeId).toBe('node-2');

      await cleanup();
    });

    test("does not receive events for other executions", async () => {
      const targetExecutionId = "exec-target";
      const otherExecutionId = "exec-other";
      
      eventStreamManager.addExecution(createMockExecution(targetExecutionId, "wf-test"));

      const { iterator, cleanup } = sseEndpoint.streamExecution(targetExecutionId);

      // Skip initial state event
      await iterator.next();

      // Emit event for different execution
      const otherEvent: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId: otherExecutionId,
        nodeId: 'node-1',
        workflowId: 'wf-other',
        status: 'completed',
      };
      eventStreamManager.emit(otherEvent);

      // Should timeout (no event received)
      const result = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ value: '', done: true }), 50)
        ),
      ]);

      expect(result.done).toBe(true);

      await cleanup();
    });
  });

  /**
   * Test all-events stream (no filter)
   * **Validates: Requirements 2.2**
   */
  describe("All events stream", () => {
    test("receives events from all executions", async () => {
      const { iterator, cleanup } = sseEndpoint.streamAllEvents();

      // Emit events for different executions
      const event1: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId: 'exec-1',
        nodeId: 'node-1',
        workflowId: 'wf-1',
        status: 'running',
      };
      const event2: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId: 'exec-2',
        nodeId: 'node-1',
        workflowId: 'wf-2',
        status: 'completed',
      };

      eventStreamManager.emit(event1);
      eventStreamManager.emit(event2);

      // Should receive both events
      const result1 = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ value: '', done: true }), 100)
        ),
      ]);
      const result2 = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ value: '', done: true }), 100)
        ),
      ]);

      expect(result1.done).toBe(false);
      expect(result2.done).toBe(false);

      const received1 = parseSSEData(result1.value as string) as NodeProgressEvent;
      const received2 = parseSSEData(result2.value as string) as NodeProgressEvent;

      expect(received1.executionId).toBe('exec-1');
      expect(received2.executionId).toBe('exec-2');

      await cleanup();
    });
  });

  /**
   * Test client disconnection and cleanup
   * **Validates: Requirements 2.3**
   */
  describe("Client disconnection", () => {
    test("cleans up subscription when client disconnects", async () => {
      const executionId = "exec-disconnect-test";
      eventStreamManager.addExecution(createMockExecution(executionId, "wf-test"));

      const initialCount = eventStreamManager.getSubscriptionCount();

      const { iterator, cleanup } = sseEndpoint.streamExecution(executionId);

      // Skip initial state (this also starts the subscription)
      await iterator.next();

      // Subscription should be active
      expect(eventStreamManager.getSubscriptionCount()).toBe(initialCount + 1);

      // Simulate client disconnect
      await cleanup();

      // Subscription should be cleaned up
      expect(eventStreamManager.getSubscriptionCount()).toBe(initialCount);
    });
  });

  /**
   * Test reconnection capability
   * **Validates: Requirements 2.4**
   */
  describe("Reconnection capability", () => {
    test("can reconnect and receive initial state again", async () => {
      const executionId = "exec-reconnect-test";
      const workflowId = "wf-reconnect";
      
      eventStreamManager.addExecution(createMockExecution(executionId, workflowId));

      // First connection
      const { iterator: iterator1, cleanup: cleanup1 } = sseEndpoint.streamExecution(executionId);
      
      const firstConnect = await iterator1.next();
      const firstState = parseSSEData(firstConnect.value as string) as ExecutionStateEvent;
      expect(firstState.type).toBe('execution:state');
      expect(firstState.executionId).toBe(executionId);
      
      // Disconnect
      await cleanup1();

      // Reconnect
      const { iterator: iterator2, cleanup: cleanup2 } = sseEndpoint.streamExecution(executionId);
      
      const secondConnect = await iterator2.next();
      const secondState = parseSSEData(secondConnect.value as string) as ExecutionStateEvent;
      expect(secondState.type).toBe('execution:state');
      expect(secondState.executionId).toBe(executionId);

      await cleanup2();
    });

    test("receives events emitted after reconnection", async () => {
      const executionId = "exec-reconnect-events";
      eventStreamManager.addExecution(createMockExecution(executionId, "wf-test"));

      // First connection and disconnect
      const { iterator: iterator1, cleanup: cleanup1 } = sseEndpoint.streamExecution(executionId);
      await iterator1.next(); // Skip initial state
      await cleanup1();

      // Reconnect
      const { iterator: iterator2, cleanup: cleanup2 } = sseEndpoint.streamExecution(executionId);
      await iterator2.next(); // Skip initial state

      // Emit event after reconnection
      const newEvent: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId,
        nodeId: 'node-after-reconnect',
        workflowId: 'wf-test',
        status: 'completed',
      };
      eventStreamManager.emit(newEvent);

      // Should receive the new event
      const result = await Promise.race([
        iterator2.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ value: '', done: true }), 100)
        ),
      ]);

      expect(result.done).toBe(false);
      const receivedEvent = parseSSEData(result.value as string) as NodeProgressEvent;
      expect(receivedEvent.nodeId).toBe('node-after-reconnect');

      await cleanup2();
    });
  });
});
