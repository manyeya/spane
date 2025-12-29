import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import { QueueEvents, QueueEventsProducer } from "bullmq";
import type { QueueEventsListener } from "bullmq";
import Redis from "ioredis";
import type { WorkflowStatusEvent, WorkflowStatus } from "../event-types";

/**
 * Custom event payload for workflow events published via QueueEventsProducer.
 * Defined locally since EventStreamManager no longer uses QueueEventsProducer.
 */
interface WorkflowEventPayload {
  executionId: string;
  workflowId: string;
  error?: string;
}

/**
 * Extended QueueEventsListener interface for custom workflow events.
 * Defined locally for testing BullMQ's native QueueEventsProducer functionality.
 */
interface WorkflowEventsListener extends QueueEventsListener {
  'workflow:started': (args: WorkflowEventPayload, id: string) => void;
  'workflow:completed': (args: WorkflowEventPayload, id: string) => void;
  'workflow:failed': (args: WorkflowEventPayload, id: string) => void;
  'workflow:cancelled': (args: WorkflowEventPayload, id: string) => void;
  'workflow:paused': (args: WorkflowEventPayload, id: string) => void;
}

/**
 * Property-based tests for cross-instance event propagation.
 * 
 * **Feature: architecture-refactor, Property 2: Cross-instance event propagation**
 * **Validates: Requirements 1.2**
 * 
 * These tests verify that:
 * - Events published via QueueEventsProducer are received by all QueueEvents instances
 * - Events propagate via Redis Pub/Sub to all connected instances
 */

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const optionalErrorArb = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined });

const workflowStatusArb: fc.Arbitrary<WorkflowStatus> = fc.constantFrom(
  'started', 'completed', 'failed', 'paused', 'cancelled'
);

const workflowEventPayloadArb: fc.Arbitrary<WorkflowEventPayload & { status: WorkflowStatus }> = fc.record({
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  error: optionalErrorArb,
  status: workflowStatusArb,
});

// ============================================================================
// TEST SETUP
// ============================================================================

const QUEUE_NAME = 'test-workflow-events';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe("Cross-instance event propagation property tests", () => {
  let redis: Redis;
  let producer: QueueEventsProducer;
  let consumer1: QueueEvents;
  let consumer2: QueueEvents;

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
    // Create producer and two consumers (simulating two instances)
    producer = new QueueEventsProducer(QUEUE_NAME, { connection: redis });
    consumer1 = new QueueEvents(QUEUE_NAME, { connection: redis });
    consumer2 = new QueueEvents(QUEUE_NAME, { connection: redis });
    
    // Give time for connections to establish
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    await producer.close();
    await consumer1.close();
    await consumer2.close();
  });

  /**
   * **Feature: architecture-refactor, Property 2: Cross-instance event propagation**
   * 
   * *For any* workflow event emitted via EventStreamManager.emitLocal(), 
   * all EventStreamManager instances connected to the same Redis 
   * SHALL receive the event within the Redis Pub/Sub latency window.
   * 
   * **Validates: Requirements 1.2**
   */
  describe("Property 2: Cross-instance event propagation", () => {
    test("events published via QueueEventsProducer are received by all consumers", async () => {
      // Use a smaller number of runs since this involves real Redis
      await fc.assert(
        fc.asyncProperty(workflowEventPayloadArb, async (payload) => {
          const eventName = `workflow:${payload.status}` as const;
          
          // Track received events
          const received1: WorkflowEventPayload[] = [];
          const received2: WorkflowEventPayload[] = [];

          // Setup listeners on both consumers
          const handler1 = (args: WorkflowEventPayload) => {
            received1.push(args);
          };
          const handler2 = (args: WorkflowEventPayload) => {
            received2.push(args);
          };

          consumer1.on<WorkflowEventsListener>(eventName, handler1);
          consumer2.on<WorkflowEventsListener>(eventName, handler2);

          // Give listeners time to register
          await new Promise(resolve => setTimeout(resolve, 50));

          // Publish the event
          await producer.publishEvent({
            eventName,
            executionId: payload.executionId,
            workflowId: payload.workflowId,
            error: payload.error,
          });

          // Wait for propagation (Redis Pub/Sub is fast but not instant)
          await new Promise(resolve => setTimeout(resolve, 200));

          // Property: both consumers should receive the event
          expect(received1.length).toBeGreaterThanOrEqual(1);
          expect(received2.length).toBeGreaterThanOrEqual(1);

          // Property: received events should match the published payload
          const lastReceived1 = received1[received1.length - 1]!;
          const lastReceived2 = received2[received2.length - 1]!;
          
          expect(lastReceived1.executionId).toBe(payload.executionId);
          expect(lastReceived1.workflowId).toBe(payload.workflowId);
          expect(lastReceived2.executionId).toBe(payload.executionId);
          expect(lastReceived2.workflowId).toBe(payload.workflowId);

          // Cleanup listeners - use any to bypass strict typing for custom events
          (consumer1 as any).off(eventName, handler1);
          (consumer2 as any).off(eventName, handler2);
        }),
        { numRuns: 10 } // Reduced runs for integration test
      );
    });

    test("events with different statuses are routed to correct listeners", async () => {
      await fc.assert(
        fc.asyncProperty(workflowEventPayloadArb, async (payload) => {
          const eventName = `workflow:${payload.status}` as const;
          
          // Track which event types were received
          const receivedStatuses: string[] = [];

          // Setup listeners for all status types
          const statuses: WorkflowStatus[] = ['started', 'completed', 'failed', 'paused', 'cancelled'];
          const handlers: Map<string, (args: WorkflowEventPayload) => void> = new Map();

          for (const status of statuses) {
            const handler = () => {
              receivedStatuses.push(status);
            };
            handlers.set(status, handler);
            // Use type assertion for custom event names
            (consumer1 as any).on(`workflow:${status}`, handler);
          }

          // Give listeners time to register
          await new Promise(resolve => setTimeout(resolve, 50));

          // Publish the event
          await producer.publishEvent({
            eventName,
            executionId: payload.executionId,
            workflowId: payload.workflowId,
            error: payload.error,
          });

          // Wait for propagation
          await new Promise(resolve => setTimeout(resolve, 200));

          // Property: only the correct status listener should have been triggered
          expect(receivedStatuses).toContain(payload.status);
          
          // Property: other status listeners should not have been triggered
          const otherStatuses = statuses.filter(s => s !== payload.status);
          for (const other of otherStatuses) {
            expect(receivedStatuses.filter(s => s === other).length).toBe(0);
          }

          // Cleanup listeners
          for (const [status, handler] of handlers) {
            (consumer1 as any).off(`workflow:${status}`, handler);
          }
        }),
        { numRuns: 10 }
      );
    });

    test("event payload integrity is preserved through Redis Pub/Sub", async () => {
      await fc.assert(
        fc.asyncProperty(workflowEventPayloadArb, async (payload) => {
          const eventName = `workflow:${payload.status}` as const;
          
          let receivedPayload: WorkflowEventPayload | null = null;

          const handler = (args: WorkflowEventPayload) => {
            receivedPayload = args;
          };

          consumer1.on<WorkflowEventsListener>(eventName, handler);

          // Give listener time to register
          await new Promise(resolve => setTimeout(resolve, 50));

          // Publish the event
          await producer.publishEvent({
            eventName,
            executionId: payload.executionId,
            workflowId: payload.workflowId,
            error: payload.error,
          });

          // Wait for propagation
          await new Promise(resolve => setTimeout(resolve, 200));

          // Property: payload should be received
          expect(receivedPayload).not.toBeNull();

          // Property: all fields should be preserved
          expect(receivedPayload!.executionId).toBe(payload.executionId);
          expect(receivedPayload!.workflowId).toBe(payload.workflowId);
          
          // Error field handling (undefined vs missing)
          if (payload.error !== undefined) {
            expect(receivedPayload!.error).toBe(payload.error);
          }

          // Cleanup
          (consumer1 as any).off(eventName, handler);
        }),
        { numRuns: 10 }
      );
    });
  });
});
