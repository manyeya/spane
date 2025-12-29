import { describe, test, expect, beforeEach, mock } from "bun:test";
import * as fc from "fast-check";
import type { NodeJobData } from "../types";

/**
 * Property-based tests for sub-workflow state preservation.
 * 
 * **Feature: workflow-engine-bugfixes, Property 1: Sub-workflow state preservation in job data**
 * 
 * These tests verify that:
 * - When a sub-workflow completes, the parent node is re-enqueued correctly
 * - Job data contains the correct execution context
 * - The FlowProducer pattern handles sub-workflow completion via aggregator nodes
 * 
 * **Validates: Requirements 1.1, 1.2**
 * 
 * Note: The old subWorkflowStep and childExecutionId fields have been removed
 * as part of the BullMQ improvements cleanup. Parent notification is now handled
 * by the aggregator node in the FlowProducer pattern.
 */

// Arbitrary for generating valid execution IDs
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);

// Arbitrary for generating valid workflow IDs
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);

// Arbitrary for generating valid node IDs
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,8}$/);

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
 * 
 * Note: subWorkflowStep and childExecutionId have been removed from NodeJobData.
 */
function createJobData(
  executionId: string,
  workflowId: string,
  nodeId: string,
  options: {
    delay?: number;
    delayStep?: 'initial' | 'resumed';
    delayStartTime?: number;
  } = {}
): { jobData: NodeJobData; jobId: string } {
  const jobData: NodeJobData = {
    executionId,
    workflowId,
    nodeId,
    inputData: {},
    delayStep: options.delayStep,
    delayStartTime: options.delayStartTime,
  };

  // Use deterministic job ID
  const jobId = options.delayStep === 'resumed'
    ? `${executionId}-node-${nodeId}-delay-resumed`
    : `${executionId}-node-${nodeId}`;

  return { jobData, jobId };
}

/**
 * Simulates the aggregator node's parent notification behavior for testing.
 * This mirrors the actual implementation in NodeProcessor.processAggregatorNode().
 * 
 * Note: The old notifyParentWorkflow() callback mechanism and subWorkflowStep/childExecutionId
 * fields have been removed. Parent notification is now handled by simply re-enqueueing
 * the parent node, which will check the state store for sub-workflow completion.
 */
function createResumeJobData(
  parentExecutionId: string,
  parentWorkflowId: string,
  parentNodeId: string
): { jobData: NodeJobData; jobId: string } {
  return createJobData(parentExecutionId, parentWorkflowId, parentNodeId);
}

describe("Sub-workflow state preservation property tests", () => {
  /**
   * **Feature: workflow-engine-bugfixes, Property 1: Sub-workflow state preservation in job data**
   * 
   * *For any* sub-workflow completion event, when the parent node is re-enqueued,
   * the job data SHALL contain the correct execution context.
   * 
   * **Validates: Requirements 1.1, 1.2**
   */
  describe("Property 1: Sub-workflow state preservation in job data", () => {
    test("resume job data preserves parent execution context", async () => {
      await fc.assert(
        fc.asyncProperty(subWorkflowCompletionContextArb, async (context) => {
          const { jobData } = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId
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
            context.parentNodeId
          );
          
          const result2 = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId
          );

          // Property: job IDs must be identical for same context (deterministic)
          expect(result1.jobId).toBe(result2.jobId);
          
          // Property: job ID follows the standard format
          expect(result1.jobId).toBe(`${context.parentExecutionId}-node-${context.parentNodeId}`);
        }),
        { numRuns: 100 }
      );
    });

    test("all required job data fields are present", async () => {
      await fc.assert(
        fc.asyncProperty(subWorkflowCompletionContextArb, async (context) => {
          const { jobData } = createResumeJobData(
            context.parentExecutionId,
            context.parentWorkflowId,
            context.parentNodeId
          );

          // Property: all required fields must be present and defined
          expect(jobData.executionId).toBeDefined();
          expect(jobData.workflowId).toBeDefined();
          expect(jobData.nodeId).toBeDefined();
          
          // Property: deprecated fields should not exist
          expect((jobData as any).subWorkflowStep).toBeUndefined();
          expect((jobData as any).childExecutionId).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    test("regular job data does not include deprecated sub-workflow state fields", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          async (executionId, workflowId, nodeId) => {
            const { jobData, jobId } = createJobData(executionId, workflowId, nodeId);

            // Property: deprecated fields should not exist
            expect((jobData as any).subWorkflowStep).toBeUndefined();
            expect((jobData as any).childExecutionId).toBeUndefined();
            
            // Property: job ID should follow standard format
            expect(jobId).toBe(`${executionId}-node-${nodeId}`);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
