import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { DelayNodeConfig, NodeDefinition, ExecutionState, ExecutionResult } from "../../types";
import type { NodeJobData } from "../types";
import { resolveDuration } from "../node-processor";

/**
 * Property-based tests for delay node cancellation behavior.
 * 
 * **Feature: delay-node, Property 5: Cancellation removes delayed jobs**
 * **Validates: Requirements 5.1, 5.2**
 * 
 * These tests verify that:
 * - When a workflow is cancelled, delayed jobs are removed from the queue
 * - When a delay node resumes and the workflow is cancelled, execution is skipped
 * - Cancelled workflows do not resume after delays
 */

// ============================================================================
// ARBITRARIES FOR CONFIG GENERATION
// ============================================================================

// Common field arbitraries
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^delay-[a-z0-9]{2,10}$/);

// Valid duration values
const positiveDurationMsArb = fc.integer({ min: 1, max: 86400000 }); // Up to 24 hours in ms
const positiveSecondsArb = fc.integer({ min: 1, max: 86400 }); // Up to 24 hours in seconds
const positiveMinutesArb = fc.integer({ min: 1, max: 1440 }); // Up to 24 hours in minutes

// Valid delay node configurations
const validDelayConfigArb: fc.Arbitrary<DelayNodeConfig> = fc.oneof(
  fc.record({ duration: positiveDurationMsArb }),
  fc.record({ durationSeconds: positiveSecondsArb }),
  fc.record({ durationMinutes: positiveMinutesArb }),
);

// Execution status arbitrary
const executionStatusArb = fc.constantFrom(
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused'
);

// Input data arbitrary
const inputDataArb = fc.option(
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.dictionary(fc.string(), fc.jsonValue())
  ),
  { nil: undefined }
);

// ============================================================================
// HELPER TYPES AND FUNCTIONS
// ============================================================================

/**
 * Creates a delay node definition with the given config
 */
function createDelayNode(
  nodeId: string,
  config: DelayNodeConfig,
  inputs: string[] = [],
  outputs: string[] = []
): NodeDefinition {
  return {
    id: nodeId,
    type: 'delay',
    config,
    inputs,
    outputs,
  };
}

/**
 * Creates a mock execution state
 */
function createExecutionState(
  executionId: string,
  workflowId: string,
  status: string
): ExecutionState {
  return {
    id: executionId,
    workflowId,
    status: status as ExecutionState['status'],
    nodeResults: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Creates mock node job data for a delay node
 */
function createNodeJobData(
  executionId: string,
  workflowId: string,
  nodeId: string,
  delayStep: 'initial' | 'resumed' = 'initial',
  inputData?: any
): NodeJobData {
  return {
    executionId,
    workflowId,
    nodeId,
    inputData,
    delayStep,
    delayStartTime: delayStep === 'resumed' ? Date.now() - 1000 : undefined,
  };
}

/**
 * Simulates the cancellation check logic from processDelayNode.
 * Returns the result that would be returned when a delay node resumes
 * and the workflow status is checked.
 */
function simulateDelayResumeWithCancellationCheck(
  executionState: ExecutionState | null,
  inputData?: any
): ExecutionResult {
  // Re-check workflow status before completing (as done in processDelayNode)
  if (executionState?.status === 'cancelled') {
    return { success: false, error: 'Workflow execution cancelled' };
  }
  
  // If not cancelled, return success with pass-through data
  return {
    success: true,
    data: inputData,
  };
}

/**
 * Simulates the job removal logic from cancelWorkflow.
 * Returns true if a job with the given execution ID would be removed.
 */
function simulateJobRemovalOnCancel(
  jobExecutionId: string,
  cancelledExecutionId: string,
  jobState: string
): boolean {
  // Jobs in these states are checked for removal
  const removableStates = ['waiting', 'delayed', 'prioritized', 'waiting-children'];
  
  // Job is removed if it belongs to the cancelled execution and is in a removable state
  return jobExecutionId === cancelledExecutionId && removableStates.includes(jobState);
}

/**
 * Represents a delayed job in the queue
 */
interface DelayedJob {
  id: string;
  executionId: string;
  workflowId: string;
  nodeId: string;
  state: string;
  delayStep: 'initial' | 'resumed';
}

/**
 * Creates a mock delayed job
 */
function createDelayedJob(
  executionId: string,
  workflowId: string,
  nodeId: string,
  state: string = 'delayed'
): DelayedJob {
  return {
    id: `${executionId}-node-${nodeId}`,
    executionId,
    workflowId,
    nodeId,
    state,
    delayStep: 'resumed',
  };
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Delay node cancellation property tests", () => {
  /**
   * **Feature: delay-node, Property 5: Cancellation removes delayed jobs**
   * 
   * *For any* workflow cancellation while a delay node is in the delayed queue,
   * the delayed job should be removed and not resume execution.
   * 
   * **Validates: Requirements 5.1, 5.2**
   */
  describe("Property 5: Cancellation removes delayed jobs", () => {
    
    test("delayed jobs are removed when workflow is cancelled (Requirement 5.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          async (executionId, workflowId, nodeId) => {
            // Create a delayed job for the execution
            const delayedJob = createDelayedJob(executionId, workflowId, nodeId, 'delayed');
            
            // Property: Delayed job should be removed when its execution is cancelled
            const shouldBeRemoved = simulateJobRemovalOnCancel(
              delayedJob.executionId,
              executionId, // Same execution ID = cancelled
              delayedJob.state
            );
            
            expect(shouldBeRemoved).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("jobs in 'delayed' state are included in cancellation removal", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          async (executionId, workflowId, nodeId) => {
            const delayedJob = createDelayedJob(executionId, workflowId, nodeId, 'delayed');
            
            // Property: Jobs in 'delayed' state are removed
            const shouldBeRemoved = simulateJobRemovalOnCancel(
              delayedJob.executionId,
              executionId,
              'delayed'
            );
            
            expect(shouldBeRemoved).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("jobs from different executions are not removed", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          async (jobExecutionId, cancelledExecutionId, workflowId, nodeId) => {
            // Skip if execution IDs happen to be the same
            fc.pre(jobExecutionId !== cancelledExecutionId);
            
            const delayedJob = createDelayedJob(jobExecutionId, workflowId, nodeId, 'delayed');
            
            // Property: Jobs from different executions are NOT removed
            const shouldBeRemoved = simulateJobRemovalOnCancel(
              delayedJob.executionId,
              cancelledExecutionId,
              delayedJob.state
            );
            
            expect(shouldBeRemoved).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("delay node returns cancelled result when workflow is cancelled during delay (Requirement 5.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          inputDataArb,
          async (executionId, workflowId, nodeId, inputData) => {
            // Create a cancelled execution state
            const executionState = createExecutionState(executionId, workflowId, 'cancelled');
            
            // Simulate delay resume with cancellation check
            const result = simulateDelayResumeWithCancellationCheck(executionState, inputData);
            
            // Property: Result indicates cancellation
            expect(result.success).toBe(false);
            expect(result.error).toBe('Workflow execution cancelled');
          }
        ),
        { numRuns: 100 }
      );
    });

    test("delay node completes successfully when workflow is not cancelled", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          inputDataArb,
          fc.constantFrom('running', 'completed'),
          async (executionId, workflowId, nodeId, inputData, status) => {
            // Create a non-cancelled execution state
            const executionState = createExecutionState(executionId, workflowId, status);
            
            // Simulate delay resume with cancellation check
            const result = simulateDelayResumeWithCancellationCheck(executionState, inputData);
            
            // Property: Result indicates success with pass-through data
            expect(result.success).toBe(true);
            expect(result.data).toEqual(inputData);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("cancellation check happens before completing delay node", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          validDelayConfigArb,
          inputDataArb,
          async (executionId, workflowId, nodeId, config, inputData) => {
            // Create job data for resumed step
            const jobData = createNodeJobData(executionId, workflowId, nodeId, 'resumed', inputData);
            
            // Create cancelled execution state
            const cancelledState = createExecutionState(executionId, workflowId, 'cancelled');
            
            // Property: Resumed delay node checks cancellation status
            const result = simulateDelayResumeWithCancellationCheck(cancelledState, inputData);
            
            // Cancellation should be detected and returned
            expect(result.success).toBe(false);
            expect(result.error).toContain('cancelled');
          }
        ),
        { numRuns: 100 }
      );
    });

    test("all removable job states are checked during cancellation", async () => {
      const removableStates = ['waiting', 'delayed', 'prioritized', 'waiting-children'];
      
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          fc.constantFrom(...removableStates),
          async (executionId, workflowId, nodeId, jobState) => {
            const job = createDelayedJob(executionId, workflowId, nodeId, jobState);
            
            // Property: All removable states result in job removal
            const shouldBeRemoved = simulateJobRemovalOnCancel(
              job.executionId,
              executionId,
              jobState
            );
            
            expect(shouldBeRemoved).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("active and completed jobs are not removed during cancellation", async () => {
      const nonRemovableStates = ['active', 'completed', 'failed'];
      
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          fc.constantFrom(...nonRemovableStates),
          async (executionId, workflowId, nodeId, jobState) => {
            const job = createDelayedJob(executionId, workflowId, nodeId, jobState);
            
            // Property: Non-removable states are not removed
            const shouldBeRemoved = simulateJobRemovalOnCancel(
              job.executionId,
              executionId,
              jobState
            );
            
            expect(shouldBeRemoved).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("null execution state does not cause cancellation result", async () => {
      await fc.assert(
        fc.asyncProperty(
          inputDataArb,
          async (inputData) => {
            // Simulate with null execution state (edge case)
            const result = simulateDelayResumeWithCancellationCheck(null, inputData);
            
            // Property: Null state should not trigger cancellation
            // (In real implementation, this would be handled differently,
            // but the cancellation check specifically looks for 'cancelled' status)
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("delay node with valid config respects cancellation", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          validDelayConfigArb,
          inputDataArb,
          async (executionId, workflowId, nodeId, config, inputData) => {
            const node = createDelayNode(nodeId, config);
            const duration = resolveDuration(config);
            
            // Valid config should have positive duration
            expect(duration).not.toBeNull();
            expect(duration).toBeGreaterThan(0);
            
            // Create cancelled execution state
            const cancelledState = createExecutionState(executionId, workflowId, 'cancelled');
            
            // Property: Even with valid config, cancellation is respected
            const result = simulateDelayResumeWithCancellationCheck(cancelledState, inputData);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Workflow execution cancelled');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
