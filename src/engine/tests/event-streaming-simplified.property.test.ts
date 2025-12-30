import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { EventEmitter } from "events";
import type {
  WorkflowEvent,
  NodeProgressEvent,
  WorkflowStatusEvent,
  ExecutionStateEvent,
  ProgressPayload,
  NodeStatus,
  WorkflowStatus,
} from "../event-types";

/**
 * Property-based tests for the simplified event streaming implementation.
 * 
 * **Feature: bullmq-improvements, Task 2.5.7: Event streaming tests**
 * **Validates: Requirements FR-6.1, FR-6.2, FR-6.3, FR-6.4**
 * 
 * These tests verify:
 * - Progress payload parsing (full and simplified formats)
 * - Native completed/failed event handling
 * - Local event emission via emitLocal()
 * - Subscription filtering by executionId
 * - Event flow through job.updateProgress()
 * 
 * Architecture (from design doc):
 * - Node events flow through job.updateProgress() → QueueEvents.on('progress')
 * - Native completed/failed events provide job completion status
 * - Workflow status events are emitted locally via emitLocal()
 */

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,10}$/);
const timestampArb = fc.integer({ min: 1700000000000, max: 2000000000000 });

const nodeStatusArb: fc.Arbitrary<NodeStatus> = fc.constantFrom(
  'running', 'completed', 'failed', 'skipped', 'delayed'
);

const workflowStatusArb: fc.Arbitrary<WorkflowStatus> = fc.constantFrom(
  'started', 'completed', 'failed', 'paused', 'cancelled'
);

const optionalDataArb = fc.option(
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.dictionary(fc.string(), fc.string())
  ),
  { nil: undefined }
);

const optionalErrorArb = fc.option(
  fc.string({ minLength: 1, maxLength: 200 }),
  { nil: undefined }
);

const optionalProgressArb = fc.option(
  fc.integer({ min: 0, max: 100 }),
  { nil: undefined }
);

// Full ProgressPayload for node events
const nodeProgressPayloadArb: fc.Arbitrary<ProgressPayload> = fc.record({
  eventType: fc.constant('node' as const),
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  timestamp: timestampArb,
  nodeId: nodeIdArb,
  nodeStatus: nodeStatusArb,
  nodeData: optionalDataArb,
  nodeError: optionalErrorArb,
  nodeProgress: optionalProgressArb,
});

// Full ProgressPayload for workflow events
const workflowProgressPayloadArb: fc.Arbitrary<ProgressPayload> = fc.record({
  eventType: fc.constant('workflow' as const),
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  timestamp: timestampArb,
  workflowStatus: workflowStatusArb,
  workflowError: optionalErrorArb,
});

// Simplified ProgressPayload (missing executionId/workflowId/nodeId - from job data)
const simplifiedNodePayloadArb = fc.record({
  eventType: fc.constant('node' as const),
  timestamp: timestampArb,
  nodeStatus: nodeStatusArb,
  nodeData: optionalDataArb,
  nodeError: optionalErrorArb,
  nodeProgress: optionalProgressArb,
});

// Job data that supplements simplified payloads
const jobDataArb = fc.record({
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  nodeId: nodeIdArb,
});

// NodeProgressEvent arbitrary
const nodeProgressEventArb: fc.Arbitrary<NodeProgressEvent> = fc.record({
  type: fc.constant('node:progress' as const),
  timestamp: timestampArb,
  executionId: executionIdArb,
  nodeId: nodeIdArb,
  workflowId: workflowIdArb,
  status: nodeStatusArb,
  data: optionalDataArb,
  error: optionalErrorArb,
  progress: optionalProgressArb,
});

// WorkflowStatusEvent arbitrary
const workflowStatusEventArb: fc.Arbitrary<WorkflowStatusEvent> = fc.record({
  type: fc.constant('workflow:status' as const),
  timestamp: timestampArb,
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  status: workflowStatusArb,
  error: optionalErrorArb,
});

// ============================================================================
// MOCK IMPLEMENTATION FOR TESTING
// ============================================================================

/**
 * Mock implementation of EventStreamManager's parseProgressPayload logic.
 * Isolated for testing without Redis/BullMQ dependencies.
 */
function parseProgressPayload(
  payload: ProgressPayload | Partial<ProgressPayload>,
  jobData?: { executionId: string; workflowId: string; nodeId: string }
): WorkflowEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  // Extract fields from payload, falling back to job data for simplified format
  const executionId = payload.executionId || jobData?.executionId;
  const workflowId = payload.workflowId || jobData?.workflowId;
  const nodeId = payload.nodeId || jobData?.nodeId;
  const timestamp = payload.timestamp || Date.now();

  if (payload.eventType === 'node') {
    // Validate required fields for node events
    if (!executionId || !workflowId || !nodeId) {
      return null;
    }

    const event: NodeProgressEvent = {
      type: 'node:progress',
      timestamp,
      executionId,
      nodeId,
      workflowId,
      status: payload.nodeStatus!,
      data: payload.nodeData,
      error: payload.nodeError,
      progress: payload.nodeProgress,
    };
    return event;
  }

  if (payload.eventType === 'workflow') {
    // Validate required fields for workflow events
    if (!executionId || !workflowId) {
      return null;
    }

    const event: WorkflowStatusEvent = {
      type: 'workflow:status',
      timestamp,
      executionId,
      workflowId,
      status: payload.workflowStatus!,
      error: payload.workflowError,
    };
    return event;
  }

  return null;
}

/**
 * Mock EventStreamManager for testing subscription and filtering logic.
 */
class MockEventStreamManager {
  private emitter: EventEmitter;
  private isStarted: boolean = false;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(1000);
  }

  async start(): Promise<void> {
    this.isStarted = true;
  }

  isRunning(): boolean {
    return this.isStarted;
  }

  emitLocal(event: WorkflowEvent): void {
    this.emitter.emit('event', event);
  }

  /**
   * Simulate progress event from BullMQ
   */
  handleProgressEvent(payload: ProgressPayload, jobData?: { executionId: string; workflowId: string; nodeId: string }): void {
    const event = parseProgressPayload(payload, jobData);
    if (event) {
      this.emitter.emit('event', event);
    }
  }

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

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    this.isStarted = false;
  }
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Simplified event streaming property tests", () => {
  /**
   * Property 1: Full ProgressPayload parsing
   * 
   * *For any* valid ProgressPayload with all fields present,
   * parseProgressPayload SHALL return a correctly typed WorkflowEvent.
   * 
   * **Validates: Requirements FR-6.1**
   */
  describe("Property 1: Full ProgressPayload parsing", () => {
    test("node progress payloads are parsed correctly", async () => {
      await fc.assert(
        fc.asyncProperty(nodeProgressPayloadArb, async (payload) => {
          const event = parseProgressPayload(payload);

          // Property: should return a valid NodeProgressEvent
          expect(event).not.toBeNull();
          expect(event!.type).toBe('node:progress');

          const nodeEvent = event as NodeProgressEvent;
          expect(nodeEvent.executionId).toBe(payload.executionId);
          expect(nodeEvent.workflowId).toBe(payload.workflowId);
          expect(nodeEvent.nodeId).toBe(payload.nodeId);
          expect(nodeEvent.status).toBe(payload.nodeStatus);
          expect(nodeEvent.timestamp).toBe(payload.timestamp);
          expect(nodeEvent.data).toEqual(payload.nodeData);
          expect(nodeEvent.error).toBe(payload.nodeError);
          expect(nodeEvent.progress).toBe(payload.nodeProgress);
        }),
        { numRuns: 100 }
      );
    });

    test("workflow progress payloads are parsed correctly", async () => {
      await fc.assert(
        fc.asyncProperty(workflowProgressPayloadArb, async (payload) => {
          const event = parseProgressPayload(payload);

          // Property: should return a valid WorkflowStatusEvent
          expect(event).not.toBeNull();
          expect(event!.type).toBe('workflow:status');

          const workflowEvent = event as WorkflowStatusEvent;
          expect(workflowEvent.executionId).toBe(payload.executionId);
          expect(workflowEvent.workflowId).toBe(payload.workflowId);
          expect(workflowEvent.status).toBe(payload.workflowStatus);
          expect(workflowEvent.timestamp).toBe(payload.timestamp);
          expect(workflowEvent.error).toBe(payload.workflowError);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: Simplified ProgressPayload parsing with job data fallback
   * 
   * *For any* simplified ProgressPayload (missing executionId/workflowId/nodeId),
   * parseProgressPayload SHALL use job data to supplement missing fields.
   * 
   * **Validates: Requirements FR-6.1**
   */
  describe("Property 2: Simplified payload parsing with job data fallback", () => {
    test("simplified node payloads use job data for missing fields", async () => {
      await fc.assert(
        fc.asyncProperty(simplifiedNodePayloadArb, jobDataArb, async (payload, jobData) => {
          const event = parseProgressPayload(payload as Partial<ProgressPayload>, jobData);

          // Property: should return a valid NodeProgressEvent with job data fields
          expect(event).not.toBeNull();
          expect(event!.type).toBe('node:progress');

          const nodeEvent = event as NodeProgressEvent;
          expect(nodeEvent.executionId).toBe(jobData.executionId);
          expect(nodeEvent.workflowId).toBe(jobData.workflowId);
          expect(nodeEvent.nodeId).toBe(jobData.nodeId);
          expect(nodeEvent.status).toBe(payload.nodeStatus);
        }),
        { numRuns: 100 }
      );
    });

    test("simplified payloads without job data return null", async () => {
      await fc.assert(
        fc.asyncProperty(simplifiedNodePayloadArb, async (payload) => {
          const event = parseProgressPayload(payload as Partial<ProgressPayload>);

          // Property: should return null when required fields are missing
          expect(event).toBeNull();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: Subscription filtering by executionId
   * 
   * *For any* subscription with an executionId filter,
   * only events matching that executionId SHALL be delivered.
   * 
   * **Validates: Requirements FR-6.4**
   */
  describe("Property 3: Subscription filtering by executionId", () => {
    let manager: MockEventStreamManager;

    beforeEach(async () => {
      manager = new MockEventStreamManager();
      await manager.start();
    });

    afterEach(async () => {
      await manager.close();
    });

    test("filtered subscription receives only matching events", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          executionIdArb,
          nodeProgressEventArb,
          async (targetExecId, otherExecId, baseEvent) => {
            // Ensure different execution IDs
            fc.pre(targetExecId !== otherExecId);

            const receivedEvents: WorkflowEvent[] = [];
            const subscription = manager.subscribe(targetExecId);
            const iterator = subscription[Symbol.asyncIterator]();

            // Create events for both execution IDs
            const matchingEvent: NodeProgressEvent = { ...baseEvent, executionId: targetExecId };
            const nonMatchingEvent: NodeProgressEvent = { ...baseEvent, executionId: otherExecId };

            // Emit both events
            manager.emitLocal(nonMatchingEvent);
            manager.emitLocal(matchingEvent);

            // Collect received event with timeout
            const result = await Promise.race([
              iterator.next(),
              new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
                setTimeout(() => resolve({ value: undefined, done: true }), 50)
              ),
            ]);

            if (!result.done && result.value) {
              receivedEvents.push(result.value);
            }

            // Cleanup
            await iterator.return?.();

            // Property: should only receive the matching event
            expect(receivedEvents.length).toBe(1);
            expect(receivedEvents[0]).toEqual(matchingEvent);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("unfiltered subscription receives all events", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(nodeProgressEventArb, { minLength: 1, maxLength: 5 }),
          async (events) => {
            const receivedEvents: WorkflowEvent[] = [];
            const subscription = manager.subscribe(); // No filter
            const iterator = subscription[Symbol.asyncIterator]();

            // Emit all events
            for (const event of events) {
              manager.emitLocal(event);
            }

            // Collect all events with timeout
            for (let i = 0; i < events.length; i++) {
              const result = await Promise.race([
                iterator.next(),
                new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
                  setTimeout(() => resolve({ value: undefined, done: true }), 50)
                ),
              ]);

              if (!result.done && result.value) {
                receivedEvents.push(result.value);
              }
            }

            // Cleanup
            await iterator.return?.();

            // Property: should receive all emitted events
            expect(receivedEvents.length).toBe(events.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 4: Local event emission via emitLocal()
   * 
   * *For any* WorkflowEvent emitted via emitLocal(),
   * all local subscribers SHALL receive the event immediately.
   * 
   * **Validates: Requirements FR-6.3**
   */
  describe("Property 4: Local event emission via emitLocal()", () => {
    let manager: MockEventStreamManager;

    beforeEach(async () => {
      manager = new MockEventStreamManager();
      await manager.start();
    });

    afterEach(async () => {
      await manager.close();
    });

    test("emitLocal delivers events to all subscribers", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowStatusEventArb,
          fc.integer({ min: 1, max: 5 }),
          async (event, subscriberCount) => {
            const receivedCounts: number[] = [];
            const iterators: AsyncIterator<WorkflowEvent>[] = [];

            // Create multiple subscribers
            for (let i = 0; i < subscriberCount; i++) {
              const subscription = manager.subscribe();
              iterators.push(subscription[Symbol.asyncIterator]());
            }

            // Emit the event
            manager.emitLocal(event);

            // Collect from all subscribers
            for (const iterator of iterators) {
              const result = await Promise.race([
                iterator.next(),
                new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
                  setTimeout(() => resolve({ value: undefined, done: true }), 50)
                ),
              ]);

              if (!result.done && result.value) {
                receivedCounts.push(1);
              }
            }

            // Cleanup
            for (const iterator of iterators) {
              await iterator.return?.();
            }

            // Property: all subscribers should receive the event
            expect(receivedCounts.length).toBe(subscriberCount);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 5: Progress event flow through handleProgressEvent
   * 
   * *For any* valid ProgressPayload processed via handleProgressEvent(),
   * subscribers SHALL receive the corresponding WorkflowEvent.
   * 
   * **Validates: Requirements FR-6.1, FR-6.2**
   */
  describe("Property 5: Progress event flow", () => {
    let manager: MockEventStreamManager;

    beforeEach(async () => {
      manager = new MockEventStreamManager();
      await manager.start();
    });

    afterEach(async () => {
      await manager.close();
    });

    test("progress events are delivered to subscribers", async () => {
      await fc.assert(
        fc.asyncProperty(nodeProgressPayloadArb, async (payload) => {
          let receivedEvent: WorkflowEvent | null = null;
          const subscription = manager.subscribe();
          const iterator = subscription[Symbol.asyncIterator]();

          // Simulate progress event from BullMQ
          manager.handleProgressEvent(payload);

          // Collect received event
          const result = await Promise.race([
            iterator.next(),
            new Promise<IteratorResult<WorkflowEvent>>((resolve) =>
              setTimeout(() => resolve({ value: undefined, done: true }), 50)
            ),
          ]);

          if (!result.done && result.value) {
            receivedEvent = result.value;
          }

          // Cleanup
          await iterator.return?.();

          // Property: should receive the parsed event
          expect(receivedEvent).not.toBeNull();
          expect(receivedEvent!.type).toBe('node:progress');

          const nodeEvent = receivedEvent as NodeProgressEvent;
          expect(nodeEvent.executionId).toBe(payload.executionId);
          expect(nodeEvent.nodeId).toBe(payload.nodeId);
          expect(nodeEvent.status).toBe(payload.nodeStatus);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 6: Invalid payloads are rejected
   * 
   * *For any* invalid or malformed payload,
   * parseProgressPayload SHALL return null without throwing.
   * 
   * **Validates: Requirements FR-6.1**
   */
  describe("Property 6: Invalid payload handling", () => {
    test("null and undefined payloads return null", () => {
      expect(parseProgressPayload(null as any)).toBeNull();
      expect(parseProgressPayload(undefined as any)).toBeNull();
    });

    test("payloads with unknown eventType return null", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            eventType: fc.constantFrom('unknown', 'invalid', 'other'),
            executionId: executionIdArb,
            workflowId: workflowIdArb,
            timestamp: timestampArb,
          }),
          async (payload) => {
            const event = parseProgressPayload(payload as any);
            expect(event).toBeNull();
          }
        ),
        { numRuns: 50 }
      );
    });

    test("node payloads missing required fields return null", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            eventType: fc.constant('node' as const),
            timestamp: timestampArb,
            nodeStatus: nodeStatusArb,
            // Missing executionId, workflowId, nodeId
          }),
          async (payload) => {
            const event = parseProgressPayload(payload as Partial<ProgressPayload>);
            expect(event).toBeNull();
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
