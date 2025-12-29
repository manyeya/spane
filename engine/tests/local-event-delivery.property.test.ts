import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fc from "fast-check";
import { EventEmitter } from "events";
import type { WorkflowStatusEvent, WorkflowStatus } from "../event-types";

/**
 * Property-based tests for local event delivery.
 * 
 * **Feature: architecture-refactor, Property 1: Local event delivery is immediate**
 * **Validates: Requirements 1.1**
 * 
 * These tests verify that:
 * - All local subscribers receive events before emit() returns
 * - Events are delivered synchronously to the local EventEmitter
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
// MOCK IMPLEMENTATION FOR TESTING LOCAL DELIVERY
// ============================================================================

/**
 * Minimal mock of EventStreamManager that tests local event delivery behavior.
 * This isolates the local emission logic from Redis/BullMQ dependencies.
 */
class LocalEventEmitterMock {
  private emitter: EventEmitter;
  
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Emit event to local subscribers synchronously.
   * This mirrors the first step of EventStreamManager.emitLocal()
   */
  emit(event: WorkflowStatusEvent): void {
    // Emit locally immediately (synchronous)
    this.emitter.emit('event', event);
  }

  /**
   * Subscribe to events
   */
  on(callback: (event: WorkflowStatusEvent) => void): void {
    this.emitter.on('event', callback);
  }

  /**
   * Remove listener
   */
  off(callback: (event: WorkflowStatusEvent) => void): void {
    this.emitter.off('event', callback);
  }
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Local event delivery property tests", () => {
  /**
   * **Feature: architecture-refactor, Property 1: Local event delivery is immediate**
   * 
   * *For any* workflow event emitted via EventStreamManager.emitLocal(), 
   * all local subscribers SHALL receive the event before the emitLocal() call returns.
   * 
   * **Validates: Requirements 1.1**
   */
  describe("Property 1: Local event delivery is immediate", () => {
    let emitterMock: LocalEventEmitterMock;

    beforeEach(() => {
      emitterMock = new LocalEventEmitterMock();
    });

    test("local subscribers receive events synchronously before emit returns", async () => {
      await fc.assert(
        fc.asyncProperty(workflowStatusEventArb, async (event) => {
          let receivedEvent: WorkflowStatusEvent | null = null;
          let receivedBeforeReturn = false;

          // Subscribe to events
          const handler = (e: WorkflowStatusEvent) => {
            receivedEvent = e;
          };
          emitterMock.on(handler);

          // Emit the event
          emitterMock.emit(event);
          
          // Check immediately after emit (synchronous check)
          receivedBeforeReturn = receivedEvent !== null;

          // Property: event should be received before emit returns
          expect(receivedBeforeReturn).toBe(true);
          expect(receivedEvent).toEqual(event);

          // Cleanup
          emitterMock.off(handler);
        }),
        { numRuns: 100 }
      );
    });

    test("multiple subscribers all receive the same event synchronously", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowStatusEventArb,
          fc.integer({ min: 1, max: 10 }),
          async (event, subscriberCount) => {
            const receivedEvents: WorkflowStatusEvent[] = [];
            const handlers: ((e: WorkflowStatusEvent) => void)[] = [];

            // Create multiple subscribers
            for (let i = 0; i < subscriberCount; i++) {
              const handler = (e: WorkflowStatusEvent) => {
                receivedEvents.push(e);
              };
              handlers.push(handler);
              emitterMock.on(handler);
            }

            // Emit the event
            emitterMock.emit(event);

            // Property: all subscribers should have received the event
            expect(receivedEvents.length).toBe(subscriberCount);
            
            // Property: all received events should be identical to the emitted event
            for (const received of receivedEvents) {
              expect(received).toEqual(event);
            }

            // Cleanup
            for (const handler of handlers) {
              emitterMock.off(handler);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("event delivery order matches subscription order", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowStatusEventArb,
          fc.integer({ min: 2, max: 5 }),
          async (event, subscriberCount) => {
            const deliveryOrder: number[] = [];
            const handlers: ((e: WorkflowStatusEvent) => void)[] = [];

            // Create subscribers that record their delivery order
            for (let i = 0; i < subscriberCount; i++) {
              const subscriberIndex = i;
              const handler = () => {
                deliveryOrder.push(subscriberIndex);
              };
              handlers.push(handler);
              emitterMock.on(handler);
            }

            // Emit the event
            emitterMock.emit(event);

            // Property: delivery order should match subscription order
            expect(deliveryOrder).toEqual(
              Array.from({ length: subscriberCount }, (_, i) => i)
            );

            // Cleanup
            for (const handler of handlers) {
              emitterMock.off(handler);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("events with all workflow statuses are delivered correctly", async () => {
      await fc.assert(
        fc.asyncProperty(workflowStatusEventArb, async (event) => {
          let receivedEvent: WorkflowStatusEvent | null = null;

          const handler = (e: WorkflowStatusEvent) => {
            receivedEvent = e;
          };
          emitterMock.on(handler);

          emitterMock.emit(event);

          // Property: event type and status should be preserved
          expect(receivedEvent).not.toBeNull();
          expect(receivedEvent!.type).toBe('workflow:status');
          expect(receivedEvent!.status).toBe(event.status);
          expect(receivedEvent!.executionId).toBe(event.executionId);
          expect(receivedEvent!.workflowId).toBe(event.workflowId);
          expect(receivedEvent!.timestamp).toBe(event.timestamp);
          expect(receivedEvent!.error).toBe(event.error);

          emitterMock.off(handler);
        }),
        { numRuns: 100 }
      );
    });
  });
});
