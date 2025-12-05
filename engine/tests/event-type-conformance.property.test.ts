import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import {
  type NodeProgressEvent,
  type WorkflowStatusEvent,
  type ExecutionStateEvent,
  type ErrorEvent,
  type WorkflowEvent,
  type NodeStatus,
  type WorkflowStatus,
  isValidWorkflowEvent,
  isNodeProgressEvent,
  isWorkflowStatusEvent,
  isExecutionStateEvent,
  isErrorEvent,
} from "../event-types";

/**
 * Property-based tests for event type conformance.
 * 
 * **Feature: realtime-events, Property 5: Event type conformance**
 * **Validates: Requirements 5.3**
 * 
 * These tests verify that:
 * - All emitted events conform to one of the defined TypeScript interfaces
 * - The isValidWorkflowEvent validator correctly identifies valid events
 * - Type guards correctly discriminate between event types
 */

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

// Common field arbitraries
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,10}$/);
const timestampArb = fc.integer({ min: 1700000000000, max: 2000000000000 });
const isoDateArb = fc.integer({ min: 1704067200000, max: 1893456000000 })
  .map(ts => new Date(ts).toISOString());

// Status arbitraries
const nodeStatusArb: fc.Arbitrary<NodeStatus> = fc.constantFrom(
  'running', 'completed', 'failed', 'skipped'
);
const workflowStatusArb: fc.Arbitrary<WorkflowStatus> = fc.constantFrom(
  'started', 'completed', 'failed', 'paused', 'cancelled'
);

// Optional data arbitraries
const optionalDataArb = fc.option(
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.dictionary(fc.string(), fc.string())
  ),
  { nil: undefined }
);
const optionalErrorArb = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined });
const optionalProgressArb = fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined });
const optionalCodeArb = fc.option(fc.stringMatching(/^[A-Z_]{3,20}$/), { nil: undefined });

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

// ExecutionStateEvent arbitrary
const executionStateEventArb: fc.Arbitrary<ExecutionStateEvent> = fc.record({
  type: fc.constant('execution:state' as const),
  timestamp: timestampArb,
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  status: fc.string({ minLength: 1, maxLength: 20 }),
  nodeResults: fc.dictionary(nodeIdArb, optionalDataArb),
  startedAt: isoDateArb,
  completedAt: fc.option(isoDateArb, { nil: undefined }),
});

// ErrorEvent arbitrary
const errorEventArb: fc.Arbitrary<ErrorEvent> = fc.record({
  type: fc.constant('error' as const),
  message: fc.string({ minLength: 1, maxLength: 500 }),
  code: optionalCodeArb,
});

// Union of all valid events
const workflowEventArb: fc.Arbitrary<WorkflowEvent> = fc.oneof(
  nodeProgressEventArb,
  workflowStatusEventArb,
  executionStateEventArb,
  errorEventArb
);

// Invalid event arbitraries (for negative testing)
const invalidEventArb = fc.oneof(
  // Missing type field
  fc.record({
    timestamp: timestampArb,
    executionId: executionIdArb,
  }),
  // Invalid type value
  fc.record({
    type: fc.constantFrom('invalid', 'unknown', 'node', 'workflow'),
    timestamp: timestampArb,
    executionId: executionIdArb,
  }),
  // node:progress with invalid status
  fc.record({
    type: fc.constant('node:progress'),
    timestamp: timestampArb,
    executionId: executionIdArb,
    nodeId: nodeIdArb,
    workflowId: workflowIdArb,
    status: fc.constantFrom('pending', 'queued', 'unknown'),
  }),
  // workflow:status with invalid status
  fc.record({
    type: fc.constant('workflow:status'),
    timestamp: timestampArb,
    executionId: executionIdArb,
    workflowId: workflowIdArb,
    status: fc.constantFrom('pending', 'queued', 'unknown'),
  }),
  // Primitives
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
);

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Event type conformance property tests", () => {
  /**
   * **Feature: realtime-events, Property 5: Event type conformance**
   * 
   * *For any* emitted event, the payload SHALL conform to one of the defined
   * TypeScript interfaces (NodeProgressEvent, WorkflowStatusEvent, 
   * ExecutionStateEvent, ErrorEvent).
   * 
   * **Validates: Requirements 5.3**
   */
  describe("Property 5: Event type conformance", () => {
    test("all valid WorkflowEvents pass validation", async () => {
      await fc.assert(
        fc.asyncProperty(workflowEventArb, async (event) => {
          // Property: every generated valid event should pass validation
          expect(isValidWorkflowEvent(event)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test("NodeProgressEvent has all required fields", async () => {
      await fc.assert(
        fc.asyncProperty(nodeProgressEventArb, async (event) => {
          // Property: NodeProgressEvent must have all required fields
          expect(event.type).toBe('node:progress');
          expect(typeof event.timestamp).toBe('number');
          expect(typeof event.executionId).toBe('string');
          expect(typeof event.nodeId).toBe('string');
          expect(typeof event.workflowId).toBe('string');
          expect(['running', 'completed', 'failed', 'skipped']).toContain(event.status);
          
          // Validate with type guard
          expect(isNodeProgressEvent(event)).toBe(true);
          expect(isWorkflowStatusEvent(event)).toBe(false);
          expect(isExecutionStateEvent(event)).toBe(false);
          expect(isErrorEvent(event)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test("WorkflowStatusEvent has all required fields", async () => {
      await fc.assert(
        fc.asyncProperty(workflowStatusEventArb, async (event) => {
          // Property: WorkflowStatusEvent must have all required fields
          expect(event.type).toBe('workflow:status');
          expect(typeof event.timestamp).toBe('number');
          expect(typeof event.executionId).toBe('string');
          expect(typeof event.workflowId).toBe('string');
          expect(['started', 'completed', 'failed', 'paused', 'cancelled']).toContain(event.status);
          
          // Validate with type guard
          expect(isWorkflowStatusEvent(event)).toBe(true);
          expect(isNodeProgressEvent(event)).toBe(false);
          expect(isExecutionStateEvent(event)).toBe(false);
          expect(isErrorEvent(event)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test("ExecutionStateEvent has all required fields", async () => {
      await fc.assert(
        fc.asyncProperty(executionStateEventArb, async (event) => {
          // Property: ExecutionStateEvent must have all required fields
          expect(event.type).toBe('execution:state');
          expect(typeof event.timestamp).toBe('number');
          expect(typeof event.executionId).toBe('string');
          expect(typeof event.workflowId).toBe('string');
          expect(typeof event.status).toBe('string');
          expect(typeof event.nodeResults).toBe('object');
          expect(event.nodeResults).not.toBeNull();
          expect(typeof event.startedAt).toBe('string');
          
          // Validate with type guard
          expect(isExecutionStateEvent(event)).toBe(true);
          expect(isNodeProgressEvent(event)).toBe(false);
          expect(isWorkflowStatusEvent(event)).toBe(false);
          expect(isErrorEvent(event)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test("ErrorEvent has all required fields", async () => {
      await fc.assert(
        fc.asyncProperty(errorEventArb, async (event) => {
          // Property: ErrorEvent must have all required fields
          expect(event.type).toBe('error');
          expect(typeof event.message).toBe('string');
          
          // Validate with type guard
          expect(isErrorEvent(event)).toBe(true);
          expect(isNodeProgressEvent(event)).toBe(false);
          expect(isWorkflowStatusEvent(event)).toBe(false);
          expect(isExecutionStateEvent(event)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test("invalid events fail validation", async () => {
      await fc.assert(
        fc.asyncProperty(invalidEventArb, async (invalidEvent) => {
          // Property: invalid events should not pass validation
          expect(isValidWorkflowEvent(invalidEvent)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test("type guards are mutually exclusive for valid events", async () => {
      await fc.assert(
        fc.asyncProperty(workflowEventArb, async (event) => {
          // Property: exactly one type guard should return true
          const guards = [
            isNodeProgressEvent(event),
            isWorkflowStatusEvent(event),
            isExecutionStateEvent(event),
            isErrorEvent(event),
          ];
          
          const trueCount = guards.filter(Boolean).length;
          expect(trueCount).toBe(1);
        }),
        { numRuns: 100 }
      );
    });
  });
});
