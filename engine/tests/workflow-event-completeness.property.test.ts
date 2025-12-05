import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { WorkflowEventEmitter } from "../event-emitter";
import {
  type WorkflowStatusEvent,
  type WorkflowStatus,
  isValidWorkflowEvent,
  isWorkflowStatusEvent,
} from "../event-types";

/**
 * Property-based tests for workflow event completeness.
 * 
 * **Feature: realtime-events, Property 2: Workflow event completeness**
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
 * 
 * These tests verify that:
 * - For any workflow status change (started, completed, failed, paused, cancelled),
 *   the emitted event SHALL contain executionId, workflowId, status, and timestamp
 *   fields with non-null values.
 */

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

// Common field arbitraries
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);

// Status arbitraries
const workflowStatusArb: fc.Arbitrary<WorkflowStatus> = fc.constantFrom(
  'started', 'completed', 'failed', 'paused', 'cancelled'
);

// Optional error arbitrary
const optionalErrorArb = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined });

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Workflow event completeness property tests", () => {
  /**
   * **Feature: realtime-events, Property 2: Workflow event completeness**
   * 
   * *For any* workflow status change (started, completed, failed, paused, cancelled),
   * the emitted event SHALL contain executionId, workflowId, status, and timestamp
   * fields with non-null values.
   * 
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
   */
  describe("Property 2: Workflow event completeness", () => {
    test("createWorkflowStatusEvent produces events with all required fields", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          workflowStatusArb,
          optionalErrorArb,
          async (executionId, workflowId, status, error) => {
            const event = WorkflowEventEmitter.createWorkflowStatusEvent({
              executionId,
              workflowId,
              status,
              error,
            });

            // Property: All required fields must be present and non-null
            expect(event.executionId).not.toBeNull();
            expect(event.executionId).not.toBeUndefined();
            expect(typeof event.executionId).toBe('string');
            expect(event.executionId.length).toBeGreaterThan(0);

            expect(event.workflowId).not.toBeNull();
            expect(event.workflowId).not.toBeUndefined();
            expect(typeof event.workflowId).toBe('string');
            expect(event.workflowId.length).toBeGreaterThan(0);

            expect(event.status).not.toBeNull();
            expect(event.status).not.toBeUndefined();
            expect(['started', 'completed', 'failed', 'paused', 'cancelled']).toContain(event.status);

            expect(event.timestamp).not.toBeNull();
            expect(event.timestamp).not.toBeUndefined();
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);

            // Property: Event must be a valid WorkflowEvent
            expect(isValidWorkflowEvent(event)).toBe(true);
            expect(isWorkflowStatusEvent(event)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'started' events have all required fields (Requirement 4.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          async (executionId, workflowId) => {
            const event = WorkflowEventEmitter.createWorkflowStatusEvent({
              executionId,
              workflowId,
              status: 'started',
            });

            // Property: Started event must have all required fields
            expect(event.type).toBe('workflow:status');
            expect(event.executionId).toBe(executionId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('started');
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'completed' events have all required fields (Requirement 4.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          async (executionId, workflowId) => {
            const event = WorkflowEventEmitter.createWorkflowStatusEvent({
              executionId,
              workflowId,
              status: 'completed',
            });

            // Property: Completed event must have all required fields
            expect(event.type).toBe('workflow:status');
            expect(event.executionId).toBe(executionId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('completed');
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'failed' events have all required fields including error details (Requirement 4.3)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          fc.string({ minLength: 1, maxLength: 200 }),
          async (executionId, workflowId, error) => {
            const event = WorkflowEventEmitter.createWorkflowStatusEvent({
              executionId,
              workflowId,
              status: 'failed',
              error,
            });

            // Property: Failed event must have all required fields
            expect(event.type).toBe('workflow:status');
            expect(event.executionId).toBe(executionId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('failed');
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);
            
            // Error should be preserved
            expect(event.error).toBe(error);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'paused' events have all required fields (Requirement 4.4)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          async (executionId, workflowId) => {
            const event = WorkflowEventEmitter.createWorkflowStatusEvent({
              executionId,
              workflowId,
              status: 'paused',
            });

            // Property: Paused event must have all required fields
            expect(event.type).toBe('workflow:status');
            expect(event.executionId).toBe(executionId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('paused');
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'cancelled' events have all required fields (Requirement 4.5)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          async (executionId, workflowId) => {
            const event = WorkflowEventEmitter.createWorkflowStatusEvent({
              executionId,
              workflowId,
              status: 'cancelled',
            });

            // Property: Cancelled event must have all required fields
            expect(event.type).toBe('workflow:status');
            expect(event.executionId).toBe(executionId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('cancelled');
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("event fields preserve input values exactly", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          workflowStatusArb,
          optionalErrorArb,
          async (executionId, workflowId, status, error) => {
            const event = WorkflowEventEmitter.createWorkflowStatusEvent({
              executionId,
              workflowId,
              status,
              error,
            });

            // Property: Input values must be preserved exactly
            expect(event.executionId).toBe(executionId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe(status);
            expect(event.error).toBe(error);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
