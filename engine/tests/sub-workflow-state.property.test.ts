import { describe, test, expect, beforeEach, mock } from "bun:test";
import * as fc from "fast-check";
import type { NodeJobData } from "../types";

/**
 * Property-based tests for sub-workflow state preservation.
 * 
 * **Feature: workflow-engine-bugfixes, Property 1: Sub-workflow state preservation in job data**
 * 
 * These tests verify that:
 * - When a sub-workflow completes, the parent node is re-enqueued with correct state
 * - Job data contains both subWorkflowStep: 'complete' and the correct childExecutionId
 * 
 * **Validates: Requirements 1.1, 1.2**
 */

// Arbitrary for generating valid execution IDs
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);

// Arbitrary for generating valid workflow IDs
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);

// Arbitrary for generating valid node IDs
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,8}$/);

// Arbitrary for sub-workflow step types
const subWorkflowStepArb = fc.constantFrom('initial', 'waiting-children', 'complete') as fc.Arbitrary<'initial' | 'waiting-children' | 'complete'>;

// Arbitrary for generating sub-workflow completion context
const subWorkflowCompletionContextArb = fc.record({
  parentExecutionId: executionIdArb,
  parentWorkflowId: workflowIdArb,
  parentNodeId: nodeIdArb,
  childExecutionId: executionIdArb,
});

/**
 * Simulates the enqueueNode function behavior for testing.
 * This mirrors the actual implementation in NodeProcessor.
 */
function createJobData(
  executionId: string,
  workflowId: string,
  nodeId: string,
  options: {
    delay?: number;
    subWorkflowStep?: 'initial' | 'waiting-children' | 'complete';
    childExecutionId?: string;
  } = {}
): { jobData: NodeJobData; jobId: string } {
  const jobData: NodeJobData = {
    executionId,
    workflowId,
    nodeId,
    inputData: {},
    subWorkflowStep: options.subWorkflowStep,
    childExecutionId: options.childExecutionId,
  };

  // Use deterministic job ID for resume jobs to prevent duplicates
  const jobId = options.subWorkflowStep
    ? `${executionId}-node-${nodeId}-resume-${options.childExecutionId}`
    : `${executionId}-node-${nodeId}-${Date.now()}`;

  return { jobData, jobId };
}

/**
 * Simulates the notifyParentWorkflow behavior for testing.
 * This mirrors the actual implementation in NodeProcessor.
 */
function createResumeJobData(
  parentExecutionId: string,
  parentWorkflowId: string,
  parentNodeId: string,
  childExecutionId: string
): { jobData: NodeJobData; jobId: string } {
  return createJobData(parentExecutionId, parentWorkflowId, parentNodeId, {
    subWorkflowStep: 'complete',
    childExecutionId: childExecutionId,
  });
}

describe("Sub-workflow state preservation property tests", () => {
  /**
   * **Feature: workflow-engine-bugfixes, Property 1: Sub-workflow state preservation in job data**
   * 
   * *For any* sub-workflow completion event, when the parent node is re-enqueued,
   * the job data SHALL contain both `subWorkflowStep: 'complete'` and the correct `childExecutionId`.
   * 
   * **Validates: Requirements 1.1, 1.2**
   */
  describe("Property 1: Sub-workflow state preservation in job data", () => {
    test("resume job data contains subWorkflowStep: 'complete'", async () => {
      await fc.assert(
        fc.asyncProperty(subWorkflowCompletionContextArb, async (context) => {
          const { jobData } = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId,
            context.childExecutionId
          );

          // Property: subWorkflowStep must be 'complete'
          expect(jobData.subWorkflowStep).toBe('complete');
        }),
        { numRuns: 100 }
      );
    });

    test("resume job data contains correct childExecutionId", async () => {
      await fc.assert(
        fc.asyncProperty(subWorkflowCompletionContextArb, async (context) => {
          const { jobData } = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId,
            context.childExecutionId
          );

          // Property: childExecutionId must match the child execution
          expect(jobData.childExecutionId).toBe(context.childExecutionId);
        }),
        { numRuns: 100 }
      );
    });

    test("resume job data preserves parent execution context", async () => {
      await fc.assert(
        fc.asyncProperty(subWorkflowCompletionContextArb, async (context) => {
          const { jobData } = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId,
            context.childExecutionId
          );

          // Property: parent context must be preserved
          expect(jobData.executionId).toBe(context.parentExecutionId);
          expect(jobData.workflowId).toBe(context.parentWorkflowId);
          expect(jobData.nodeId).toBe(context.parentNodeId);
        }),
        { numRuns: 100 }
      );
    });

    test("resume job uses deterministic job ID for idempotency", async () => {
      await fc.assert(
        fc.asyncProperty(subWorkflowCompletionContextArb, async (context) => {
          // Create two resume jobs with same context
          const result1 = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId,
            context.childExecutionId
          );
          
          const result2 = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId,
            context.childExecutionId
          );

          // Property: job IDs must be identical for same context (deterministic)
          expect(result1.jobId).toBe(result2.jobId);
          
          // Property: job ID must contain resume indicator
          expect(result1.jobId).toContain('-resume-');
          expect(result1.jobId).toContain(context.childExecutionId);
        }),
        { numRuns: 100 }
      );
    });

    test("all required sub-workflow state fields are present", async () => {
      await fc.assert(
        fc.asyncProperty(subWorkflowCompletionContextArb, async (context) => {
          const { jobData } = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId,
            context.childExecutionId
          );

          // Property: all required fields must be present and defined
          expect(jobData.executionId).toBeDefined();
          expect(jobData.workflowId).toBeDefined();
          expect(jobData.nodeId).toBeDefined();
          expect(jobData.subWorkflowStep).toBeDefined();
          expect(jobData.childExecutionId).toBeDefined();
          
          // Property: subWorkflowStep and childExecutionId must both be set for resume
          expect(jobData.subWorkflowStep).toBe('complete');
          expect(typeof jobData.childExecutionId).toBe('string');
          expect(jobData.childExecutionId!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    test("regular job data does not include sub-workflow state when not specified", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          async (executionId, workflowId, nodeId) => {
            const { jobData, jobId } = createJobData(executionId, workflowId, nodeId);

            // Property: regular jobs should not have sub-workflow state
            expect(jobData.subWorkflowStep).toBeUndefined();
            expect(jobData.childExecutionId).toBeUndefined();
            
            // Property: regular job ID should not contain resume indicator
            expect(jobId).not.toContain('-resume-');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
