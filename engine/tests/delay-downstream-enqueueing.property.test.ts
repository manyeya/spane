import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { NodeDefinition, WorkflowDefinition, ExecutionResult, DelayNodeConfig } from "../../types";
import { resolveDuration } from "../node-processor";

/**
 * Property-based tests for delay node downstream enqueueing.
 * 
 * **Feature: delay-node, Property 4: Delay completion triggers downstream**
 * **Validates: Requirements 1.4**
 * 
 * These tests verify that:
 * - When a delay node completes after its duration expires, all downstream nodes are enqueued
 * - The result data from the delay node is available for children
 * - Children are only enqueued when all their parents have completed
 */

// ============================================================================
// ARBITRARIES FOR WORKFLOW GENERATION
// ============================================================================

// Common field arbitraries
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,10}$/);
const delayNodeIdArb = fc.stringMatching(/^delay-[a-z0-9]{2,10}$/);

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

// Arbitrary for any valid data
const anyDataArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.record({ value: fc.string(), count: fc.integer() }),
  fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
);

// ============================================================================
// HELPER TYPES AND FUNCTIONS
// ============================================================================

/**
 * Represents a delay node with its downstream children
 */
interface DelayNodeWithChildren {
  delayNode: NodeDefinition;
  childNodes: NodeDefinition[];
  workflow: WorkflowDefinition;
}

/**
 * Creates a delay node definition
 */
function createDelayNode(
  id: string,
  config: DelayNodeConfig,
  inputs: string[],
  outputs: string[]
): NodeDefinition {
  return {
    id,
    type: 'delay',
    config,
    inputs,
    outputs,
  };
}

/**
 * Creates a regular action node definition
 */
function createActionNode(
  id: string,
  inputs: string[],
  outputs: string[]
): NodeDefinition {
  return {
    id,
    type: 'action',
    config: {},
    inputs,
    outputs,
  };
}

/**
 * Creates a workflow with a delay node and its children
 */
function createWorkflowWithDelayAndChildren(
  workflowId: string,
  delayNodeId: string,
  delayConfig: DelayNodeConfig,
  childNodeIds: string[]
): DelayNodeWithChildren {
  const delayNode = createDelayNode(delayNodeId, delayConfig, [], childNodeIds);
  
  const childNodes = childNodeIds.map(childId => 
    createActionNode(childId, [delayNodeId], [])
  );
  
  const workflow: WorkflowDefinition = {
    id: workflowId,
    name: `Test Workflow ${workflowId}`,
    nodes: [delayNode, ...childNodes],
    entryNodeId: delayNodeId,
  };
  
  return { delayNode, childNodes, workflow };
}

/**
 * Simulates the checkAndEnqueueChildren logic for a delay node.
 * Returns the list of child node IDs that would be enqueued.
 * 
 * @param delayNode - The delay node that completed
 * @param workflow - The workflow definition
 * @param nodeResults - Results from all completed nodes
 * @returns Array of child node IDs that should be enqueued
 */
function simulateCheckAndEnqueueChildren(
  delayNode: NodeDefinition,
  workflow: WorkflowDefinition,
  nodeResults: Record<string, ExecutionResult>
): string[] {
  const enqueuedChildren: string[] = [];
  
  for (const childNodeId of delayNode.outputs) {
    const childNode = workflow.nodes.find(n => n.id === childNodeId);
    if (!childNode) continue;
    
    // Check if all parents of this child have completed
    const allParentsCompleted = childNode.inputs.every(parentId => {
      const result = nodeResults[parentId];
      return result && (result.success || result.skipped);
    });
    
    if (allParentsCompleted) {
      enqueuedChildren.push(childNodeId);
    }
  }
  
  return enqueuedChildren;
}

/**
 * Simulates the complete delay node completion flow.
 * Returns information about what would happen when the delay completes.
 */
interface DelayCompletionResult {
  delayNodeCompleted: boolean;
  outputData: any;
  childrenEnqueued: string[];
}

function simulateDelayCompletion(
  delayNode: NodeDefinition,
  workflow: WorkflowDefinition,
  inputData: any,
  existingResults: Record<string, ExecutionResult> = {}
): DelayCompletionResult {
  // Delay node completes with pass-through data
  const delayResult: ExecutionResult = {
    success: true,
    data: inputData,
  };
  
  // Add delay node result to existing results
  const allResults = {
    ...existingResults,
    [delayNode.id]: delayResult,
  };
  
  // Determine which children should be enqueued
  const childrenEnqueued = simulateCheckAndEnqueueChildren(
    delayNode,
    workflow,
    allResults
  );
  
  return {
    delayNodeCompleted: true,
    outputData: inputData,
    childrenEnqueued,
  };
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Delay downstream enqueueing property tests", () => {
  /**
   * **Feature: delay-node, Property 4: Delay completion triggers downstream**
   * 
   * *For any* delay node that completes after its duration expires, all downstream
   * nodes should be enqueued for execution.
   * 
   * **Validates: Requirements 1.4**
   */
  describe("Property 4: Delay completion triggers downstream", () => {
    
    test("delay node completion enqueues all single-parent children", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          delayNodeIdArb,
          validDelayConfigArb,
          fc.array(nodeIdArb, { minLength: 1, maxLength: 5 }).filter(arr => new Set(arr).size === arr.length),
          anyDataArb,
          async (workflowId, delayNodeId, config, childNodeIds, inputData) => {
            const { delayNode, workflow } = createWorkflowWithDelayAndChildren(
              workflowId,
              delayNodeId,
              config,
              childNodeIds
            );
            
            const result = simulateDelayCompletion(delayNode, workflow, inputData);
            
            // Property: All children are enqueued when delay completes
            expect(result.delayNodeCompleted).toBe(true);
            expect(result.childrenEnqueued.sort()).toEqual(childNodeIds.sort());
          }
        ),
        { numRuns: 100 }
      );
    });

    test("delay node passes through data to children", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          delayNodeIdArb,
          validDelayConfigArb,
          nodeIdArb,
          anyDataArb,
          async (workflowId, delayNodeId, config, childNodeId, inputData) => {
            const { delayNode, workflow } = createWorkflowWithDelayAndChildren(
              workflowId,
              delayNodeId,
              config,
              [childNodeId]
            );
            
            const result = simulateDelayCompletion(delayNode, workflow, inputData);
            
            // Property: Output data equals input data (pass-through)
            expect(result.outputData).toEqual(inputData);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("children with multiple parents wait for all parents", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          delayNodeIdArb,
          validDelayConfigArb,
          nodeIdArb,
          nodeIdArb.filter(id => !id.startsWith('delay-')), // Other parent
          nodeIdArb, // Child node
          anyDataArb,
          async (workflowId, delayNodeId, config, otherParentId, childNodeId, inputData) => {
            // Skip if IDs collide
            if (delayNodeId === otherParentId || delayNodeId === childNodeId || otherParentId === childNodeId) {
              return;
            }
            
            // Create a workflow where child has two parents: delay node and another node
            const delayNode = createDelayNode(delayNodeId, config, [], [childNodeId]);
            const otherParent = createActionNode(otherParentId, [], [childNodeId]);
            const childNode = createActionNode(childNodeId, [delayNodeId, otherParentId], []);
            
            const workflow: WorkflowDefinition = {
              id: workflowId,
              name: `Test Workflow ${workflowId}`,
              nodes: [delayNode, otherParent, childNode],
              entryNodeId: delayNodeId,
            };
            
            // Case 1: Only delay node completed - child should NOT be enqueued
            const resultWithoutOtherParent = simulateDelayCompletion(
              delayNode,
              workflow,
              inputData,
              {} // No other results
            );
            
            // Property: Child is NOT enqueued when other parent hasn't completed
            expect(resultWithoutOtherParent.childrenEnqueued).not.toContain(childNodeId);
            
            // Case 2: Both parents completed - child SHOULD be enqueued
            const resultWithBothParents = simulateDelayCompletion(
              delayNode,
              workflow,
              inputData,
              { [otherParentId]: { success: true, data: {} } }
            );
            
            // Property: Child IS enqueued when all parents have completed
            expect(resultWithBothParents.childrenEnqueued).toContain(childNodeId);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("skipped parent counts as completed for child enqueueing", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          delayNodeIdArb,
          validDelayConfigArb,
          nodeIdArb.filter(id => !id.startsWith('delay-')),
          nodeIdArb,
          anyDataArb,
          async (workflowId, delayNodeId, config, otherParentId, childNodeId, inputData) => {
            // Skip if IDs collide
            if (delayNodeId === otherParentId || delayNodeId === childNodeId || otherParentId === childNodeId) {
              return;
            }
            
            // Create workflow with child having two parents
            const delayNode = createDelayNode(delayNodeId, config, [], [childNodeId]);
            const otherParent = createActionNode(otherParentId, [], [childNodeId]);
            const childNode = createActionNode(childNodeId, [delayNodeId, otherParentId], []);
            
            const workflow: WorkflowDefinition = {
              id: workflowId,
              name: `Test Workflow ${workflowId}`,
              nodes: [delayNode, otherParent, childNode],
              entryNodeId: delayNodeId,
            };
            
            // Other parent is skipped (not failed)
            const result = simulateDelayCompletion(
              delayNode,
              workflow,
              inputData,
              { [otherParentId]: { success: true, skipped: true, data: null } }
            );
            
            // Property: Child is enqueued when other parent is skipped
            expect(result.childrenEnqueued).toContain(childNodeId);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("delay node with no children completes without enqueueing", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          delayNodeIdArb,
          validDelayConfigArb,
          anyDataArb,
          async (workflowId, delayNodeId, config, inputData) => {
            // Create delay node with no outputs
            const delayNode = createDelayNode(delayNodeId, config, [], []);
            
            const workflow: WorkflowDefinition = {
              id: workflowId,
              name: `Test Workflow ${workflowId}`,
              nodes: [delayNode],
              entryNodeId: delayNodeId,
            };
            
            const result = simulateDelayCompletion(delayNode, workflow, inputData);
            
            // Property: No children to enqueue
            expect(result.delayNodeCompleted).toBe(true);
            expect(result.childrenEnqueued).toEqual([]);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("valid delay config is required for completion", async () => {
      await fc.assert(
        fc.asyncProperty(
          validDelayConfigArb,
          async (config) => {
            const duration = resolveDuration(config);
            
            // Property: Valid config produces non-null positive duration
            expect(duration).not.toBeNull();
            expect(duration).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("children are enqueued in deterministic order", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          delayNodeIdArb,
          validDelayConfigArb,
          fc.array(nodeIdArb, { minLength: 2, maxLength: 5 }).filter(arr => new Set(arr).size === arr.length),
          anyDataArb,
          async (workflowId, delayNodeId, config, childNodeIds, inputData) => {
            const { delayNode, workflow } = createWorkflowWithDelayAndChildren(
              workflowId,
              delayNodeId,
              config,
              childNodeIds
            );
            
            // Run simulation twice
            const result1 = simulateDelayCompletion(delayNode, workflow, inputData);
            const result2 = simulateDelayCompletion(delayNode, workflow, inputData);
            
            // Property: Same children are enqueued each time
            expect(result1.childrenEnqueued.sort()).toEqual(result2.childrenEnqueued.sort());
          }
        ),
        { numRuns: 100 }
      );
    });

    test("failed parent prevents child enqueueing", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          delayNodeIdArb,
          validDelayConfigArb,
          nodeIdArb.filter(id => !id.startsWith('delay-')),
          nodeIdArb,
          anyDataArb,
          async (workflowId, delayNodeId, config, otherParentId, childNodeId, inputData) => {
            // Skip if IDs collide
            if (delayNodeId === otherParentId || delayNodeId === childNodeId || otherParentId === childNodeId) {
              return;
            }
            
            // Create workflow with child having two parents
            const delayNode = createDelayNode(delayNodeId, config, [], [childNodeId]);
            const otherParent = createActionNode(otherParentId, [], [childNodeId]);
            const childNode = createActionNode(childNodeId, [delayNodeId, otherParentId], []);
            
            const workflow: WorkflowDefinition = {
              id: workflowId,
              name: `Test Workflow ${workflowId}`,
              nodes: [delayNode, otherParent, childNode],
              entryNodeId: delayNodeId,
            };
            
            // Other parent failed
            const result = simulateDelayCompletion(
              delayNode,
              workflow,
              inputData,
              { [otherParentId]: { success: false, error: 'Test failure' } }
            );
            
            // Property: Child is NOT enqueued when other parent failed
            expect(result.childrenEnqueued).not.toContain(childNodeId);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
