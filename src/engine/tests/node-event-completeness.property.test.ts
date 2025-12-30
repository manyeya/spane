import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { WorkflowEventEmitter } from "../event-emitter";
import {
  type NodeProgressEvent,
  type NodeStatus,
  isValidWorkflowEvent,
  isNodeProgressEvent,
} from "../event-types";

/**
 * Property-based tests for node event completeness.
 * 
 * **Feature: realtime-events, Property 1: Node event completeness**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 * 
 * These tests verify that:
 * - For any node state change (running, completed, failed, skipped), the emitted
 *   event SHALL contain executionId, nodeId, workflowId, status, and timestamp
 *   fields with non-null values.
 */

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

// Common field arbitraries
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,10}$/);

// Status arbitraries
const nodeStatusArb: fc.Arbitrary<NodeStatus> = fc.constantFrom(
  'running', 'completed', 'failed', 'skipped'
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

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Node event completeness property tests", () => {
  /**
   * **Feature: realtime-events, Property 1: Node event completeness**
   * 
   * *For any* node state change (running, completed, failed, skipped), the emitted
   * event SHALL contain executionId, nodeId, workflowId, status, and timestamp
   * fields with non-null values.
   * 
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   */
  describe("Property 1: Node event completeness", () => {
    test("createNodeProgressEvent produces events with all required fields", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          nodeStatusArb,
          optionalDataArb,
          optionalErrorArb,
          optionalProgressArb,
          async (executionId, nodeId, workflowId, status, data, error, progress) => {
            const event = WorkflowEventEmitter.createNodeProgressEvent({
              executionId,
              nodeId,
              workflowId,
              status,
              data,
              error,
              progress,
            });

            // Property: All required fields must be present and non-null
            expect(event.executionId).not.toBeNull();
            expect(event.executionId).not.toBeUndefined();
            expect(typeof event.executionId).toBe('string');
            expect(event.executionId.length).toBeGreaterThan(0);

            expect(event.nodeId).not.toBeNull();
            expect(event.nodeId).not.toBeUndefined();
            expect(typeof event.nodeId).toBe('string');
            expect(event.nodeId.length).toBeGreaterThan(0);

            expect(event.workflowId).not.toBeNull();
            expect(event.workflowId).not.toBeUndefined();
            expect(typeof event.workflowId).toBe('string');
            expect(event.workflowId.length).toBeGreaterThan(0);

            expect(event.status).not.toBeNull();
            expect(event.status).not.toBeUndefined();
            expect(['running', 'completed', 'failed', 'skipped']).toContain(event.status);

            expect(event.timestamp).not.toBeNull();
            expect(event.timestamp).not.toBeUndefined();
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);

            // Property: Event must be a valid WorkflowEvent
            expect(isValidWorkflowEvent(event)).toBe(true);
            expect(isNodeProgressEvent(event)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'running' events have all required fields (Requirement 1.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          async (executionId, nodeId, workflowId) => {
            const event = WorkflowEventEmitter.createNodeProgressEvent({
              executionId,
              nodeId,
              workflowId,
              status: 'running',
            });

            // Property: Running event must have all required fields
            expect(event.type).toBe('node:progress');
            expect(event.executionId).toBe(executionId);
            expect(event.nodeId).toBe(nodeId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('running');
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'completed' events have all required fields including output data (Requirement 1.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          optionalDataArb,
          async (executionId, nodeId, workflowId, data) => {
            const event = WorkflowEventEmitter.createNodeProgressEvent({
              executionId,
              nodeId,
              workflowId,
              status: 'completed',
              data,
            });

            // Property: Completed event must have all required fields
            expect(event.type).toBe('node:progress');
            expect(event.executionId).toBe(executionId);
            expect(event.nodeId).toBe(nodeId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('completed');
            expect(typeof event.timestamp).toBe('number');
            expect(event.timestamp).toBeGreaterThan(0);
            
            // Data should be preserved if provided
            expect(event.data).toEqual(data);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("'failed' events have all required fields including error message (Requirement 1.3)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          fc.string({ minLength: 1, maxLength: 200 }),
          async (executionId, nodeId, workflowId, error) => {
            const event = WorkflowEventEmitter.createNodeProgressEvent({
              executionId,
              nodeId,
              workflowId,
              status: 'failed',
              error,
            });

            // Property: Failed event must have all required fields
            expect(event.type).toBe('node:progress');
            expect(event.executionId).toBe(executionId);
            expect(event.nodeId).toBe(nodeId);
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

    test("'skipped' events have all required fields (Requirement 1.4)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          async (executionId, nodeId, workflowId) => {
            const event = WorkflowEventEmitter.createNodeProgressEvent({
              executionId,
              nodeId,
              workflowId,
              status: 'skipped',
            });

            // Property: Skipped event must have all required fields
            expect(event.type).toBe('node:progress');
            expect(event.executionId).toBe(executionId);
            expect(event.nodeId).toBe(nodeId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe('skipped');
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
          nodeIdArb,
          workflowIdArb,
          nodeStatusArb,
          async (executionId, nodeId, workflowId, status) => {
            const event = WorkflowEventEmitter.createNodeProgressEvent({
              executionId,
              nodeId,
              workflowId,
              status,
            });

            // Property: Input values must be preserved exactly
            expect(event.executionId).toBe(executionId);
            expect(event.nodeId).toBe(nodeId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe(status);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
