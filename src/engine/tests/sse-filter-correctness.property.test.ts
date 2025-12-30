import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { EventEmitter } from "events";
import type {
  WorkflowEvent,
  NodeProgressEvent,
  WorkflowStatusEvent,
  NodeStatus,
  WorkflowStatus,
} from "../event-types";

/**
 * Property-based tests for SSE filter correctness.
 * 
 * **Feature: realtime-events, Property 3: SSE filter correctness**
 * **Validates: Requirements 2.1**
 * 
 * These tests verify that:
 * - For any SSE connection with an executionId filter, all received events
 *   SHALL have an executionId matching the filter value.
 */

// ============================================================================
// TEST HELPERS - Simplified EventStreamManager for testing filter logic
// ============================================================================

/**
 * Simplified version of EventStreamManager for testing filter logic.
 * This isolates the filtering behavior without requiring Redis/BullMQ.
 */
class TestEventStreamManager {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Emit an event (simulates receiving from QueueEvents)
   */
  emit(event: WorkflowEvent): void {
    this.emitter.emit('event', event);
  }

  /**
   * Subscribe to events with optional executionId filter.
   * This is the same filtering logic as the real EventStreamManager.
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
}

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,10}$/);

const nodeStatusArb: fc.Arbitrary<NodeStatus> = fc.constantFrom(
  'running', 'completed', 'failed', 'skipped'
);

const workflowStatusArb: fc.Arbitrary<WorkflowStatus> = fc.constantFrom(
  'started', 'completed', 'failed', 'paused', 'cancelled'
);

const nodeProgressEventArb = (executionId: string): fc.Arbitrary<NodeProgressEvent> =>
  fc.record({
    type: fc.constant('node:progress' as const),
    timestamp: fc.integer({ min: 1, max: Date.now() + 1000000 }),
    executionId: fc.constant(executionId),
    nodeId: nodeIdArb,
    workflowId: workflowIdArb,
    status: nodeStatusArb,
    data: fc.option(fc.anything(), { nil: undefined }),
    error: fc.option(fc.string(), { nil: undefined }),
    progress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  });

const workflowStatusEventArb = (executionId: string): fc.Arbitrary<WorkflowStatusEvent> =>
  fc.record({
    type: fc.constant('workflow:status' as const),
    timestamp: fc.integer({ min: 1, max: Date.now() + 1000000 }),
    executionId: fc.constant(executionId),
    workflowId: workflowIdArb,
    status: workflowStatusArb,
    error: fc.option(fc.string(), { nil: undefined }),
  });

const workflowEventArb = (executionId: string): fc.Arbitrary<WorkflowEvent> =>
  fc.oneof(
    nodeProgressEventArb(executionId),
    workflowStatusEventArb(executionId)
  );

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("SSE filter correctness property tests", () => {
  /**
   * **Feature: realtime-events, Property 3: SSE filter correctness**
   * 
   * *For any* SSE connection with an executionId filter, all received events
   * SHALL have an executionId matching the filter value.
   * 
   * **Validates: Requirements 2.1**
   */
  describe("Property 3: SSE filter correctness", () => {
    test("filtered subscription only receives events matching the filter executionId", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          executionIdArb,
          fc.array(fc.boolean(), { minLength: 5, maxLength: 20 }),
          async (targetExecutionId, otherExecutionId, eventPattern) => {
            // Ensure we have two different execution IDs
            fc.pre(targetExecutionId !== otherExecutionId);

            const manager = new TestEventStreamManager();
            const receivedEvents: WorkflowEvent[] = [];

            // Subscribe with filter
            const subscription = manager.subscribe(targetExecutionId);
            const iterator = subscription[Symbol.asyncIterator]();

            // Generate and emit events based on pattern
            // true = target execution, false = other execution
            const emittedTargetEvents: WorkflowEvent[] = [];

            for (const isTarget of eventPattern) {
              const execId = isTarget ? targetExecutionId : otherExecutionId;
              const event: NodeProgressEvent = {
                type: 'node:progress',
                timestamp: Date.now(),
                executionId: execId,
                nodeId: `node-${Math.random().toString(36).substr(2, 8)}`,
                workflowId: `wf-${Math.random().toString(36).substr(2, 6)}`,
                status: 'running',
              };

              if (isTarget) {
                emittedTargetEvents.push(event);
              }

              manager.emit(event);
            }

            // Collect received events (with timeout to prevent hanging)
            const expectedCount = emittedTargetEvents.length;
            for (let i = 0; i < expectedCount; i++) {
              const result = await Promise.race([
                iterator.next(),
                new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
                  setTimeout(() => resolve({ value: undefined, done: true }), 100)
                ),
              ]);

              if (result.done) break;
              receivedEvents.push(result.value);
            }

            // Cleanup
            await iterator.return?.();

            // Property: All received events must have the target executionId
            for (const event of receivedEvents) {
              if ('executionId' in event) {
                expect(event.executionId).toBe(targetExecutionId);
              }
            }

            // Property: Should receive exactly the number of target events emitted
            expect(receivedEvents.length).toBe(expectedCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("unfiltered subscription receives all events", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(executionIdArb, { minLength: 2, maxLength: 5 }),
          fc.integer({ min: 3, max: 10 }),
          async (executionIds, eventsPerExecution) => {
            const manager = new TestEventStreamManager();
            const receivedEvents: WorkflowEvent[] = [];

            // Subscribe without filter
            const subscription = manager.subscribe();
            const iterator = subscription[Symbol.asyncIterator]();

            // Emit events for each execution
            const totalEvents = executionIds.length * eventsPerExecution;
            for (const execId of executionIds) {
              for (let i = 0; i < eventsPerExecution; i++) {
                const event: NodeProgressEvent = {
                  type: 'node:progress',
                  timestamp: Date.now(),
                  executionId: execId,
                  nodeId: `node-${i}`,
                  workflowId: 'wf-test',
                  status: 'running',
                };
                manager.emit(event);
              }
            }

            // Collect all events
            for (let i = 0; i < totalEvents; i++) {
              const result = await Promise.race([
                iterator.next(),
                new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
                  setTimeout(() => resolve({ value: undefined, done: true }), 100)
                ),
              ]);

              if (result.done) break;
              receivedEvents.push(result.value);
            }

            // Cleanup
            await iterator.return?.();

            // Property: Should receive all emitted events
            expect(receivedEvents.length).toBe(totalEvents);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("filter excludes all non-matching events", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          fc.array(executionIdArb, { minLength: 3, maxLength: 10 }),
          async (targetExecutionId, otherExecutionIds) => {
            // Ensure target is not in the other IDs
            const filteredOtherIds = otherExecutionIds.filter(id => id !== targetExecutionId);
            fc.pre(filteredOtherIds.length > 0);

            const manager = new TestEventStreamManager();
            const receivedEvents: WorkflowEvent[] = [];

            // Subscribe with filter
            const subscription = manager.subscribe(targetExecutionId);
            const iterator = subscription[Symbol.asyncIterator]();

            // Emit only non-matching events
            for (const execId of filteredOtherIds) {
              const event: NodeProgressEvent = {
                type: 'node:progress',
                timestamp: Date.now(),
                executionId: execId,
                nodeId: 'node-test',
                workflowId: 'wf-test',
                status: 'completed',
              };
              manager.emit(event);
            }

            // Try to receive events (should timeout since none match)
            const result = await Promise.race([
              iterator.next(),
              new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
                setTimeout(() => resolve({ value: undefined, done: true }), 10)
              ),
            ]);

            // Cleanup
            await iterator.return?.();

            // Property: Should not receive any events (timeout should occur)
            expect(result.done).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
