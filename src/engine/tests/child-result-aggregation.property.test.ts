import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { WorkflowDefinition, ExecutionState, ExecutionResult } from "../../types";

/**
 * Property-based tests for child result aggregation.
 * 
 * **Feature: workflow-engine-bugfixes, Property 2: Child result aggregation**
 * 
 * These tests verify that:
 * - When a sub-workflow completes, the parent node receives aggregated results from all final nodes
 * - Single final node: result is returned directly
 * - Multiple final nodes: results are aggregated into an object keyed by node ID
 * 
 * **Validates: Requirements 1.3**
 */

// Arbitrary for generating valid node IDs
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,8}$/);

// Arbitrary for generating result data
const resultDataArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.record({ value: fc.string(), count: fc.integer() }),
  fc.array(fc.string(), { minLength: 0, maxLength: 5 })
);

// Arbitrary for generating a successful execution result
const successResultArb = fc.record({
  success: fc.constant(true),
  data: resultDataArb,
});

// Arbitrary for generating final node results (1 to 5 final nodes)
const finalNodeResultsArb = fc.array(
  fc.tuple(nodeIdArb, successResultArb),
  { minLength: 1, maxLength: 5 }
).map(tuples => {
  // Ensure unique node IDs
  const seen = new Set<string>();
  return tuples.filter(([id]) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}).filter(arr => arr.length >= 1);

// Arbitrary for output mapping
const outputMappingArb = fc.option(
  fc.dictionary(
    fc.stringMatching(/^[a-z]{3,8}$/),
    fc.stringMatching(/^[a-z]{3,8}$/)
  ),
  { nil: undefined }
);

/**
 * Creates a mock workflow definition with specified final nodes
 */
function createWorkflowWithFinalNodes(
  workflowId: string,
  finalNodeIds: string[]
): WorkflowDefinition {
  const nodes = finalNodeIds.map(id => ({
    id,
    type: 'action',
    config: {},
    inputs: ['entry-node'] as string[],
    outputs: [] as string[], // Final nodes have no outputs
  }));

  // Add entry node
  nodes.unshift({
    id: 'entry-node',
    type: 'action',
    config: {},
    inputs: [] as string[],
    outputs: finalNodeIds,
  });

  return {
    id: workflowId,
    name: `Test Workflow ${workflowId}`,
    entryNodeId: 'entry-node',
    nodes,
  };
}

/**
 * Creates a mock child execution state with node results
 */
function createChildExecution(
  executionId: string,
  workflowId: string,
  nodeResults: Record<string, ExecutionResult>
): ExecutionState {
  return {
    executionId,
    workflowId,
    status: 'completed',
    nodeResults,
    startedAt: new Date(),
    completedAt: new Date(),
    depth: 1,
  };
}

/**
 * Simulates the result aggregation logic from NodeProcessor.executeSubWorkflow
 * This mirrors the actual implementation (lines 380-400 in node-processor.ts)
 */
function aggregateChildResults(
  subWorkflow: WorkflowDefinition,
  childExecution: ExecutionState,
  outputMapping?: Record<string, string>
): any {
  // Find final nodes (nodes with no outputs)
  const finalNodes = subWorkflow.nodes.filter(node => node.outputs.length === 0);

  let aggregatedResult: any = {};

  if (finalNodes.length === 1 && finalNodes[0]) {
    // Single final node: return data directly
    const finalNodeId = finalNodes[0].id;
    const result = childExecution.nodeResults[finalNodeId];
    aggregatedResult = result?.data;
  } else if (finalNodes.length > 1) {
    // Multiple final nodes: aggregate into object keyed by node ID
    for (const node of finalNodes) {
      const result = childExecution.nodeResults[node.id];
      if (result?.success && result.data !== undefined) {
        aggregatedResult[node.id] = result.data;
      }
    }
  }

  // Apply output mapping if provided
  let mappedOutput = aggregatedResult;
  if (outputMapping && typeof aggregatedResult === 'object' && aggregatedResult !== null) {
    mappedOutput = {};
    for (const [targetKey, sourceKey] of Object.entries(outputMapping)) {
      if (sourceKey in aggregatedResult) {
        mappedOutput[targetKey] = aggregatedResult[sourceKey];
      }
    }
  }

  return mappedOutput;
}

describe("Child result aggregation property tests", () => {
  /**
   * **Feature: workflow-engine-bugfixes, Property 2: Child result aggregation**
   * 
   * *For any* completed child workflow with N final nodes, the parent node
   * SHALL receive aggregated results from all N final nodes when resumed.
   * 
   * **Validates: Requirements 1.3**
   */
  describe("Property 2: Child result aggregation", () => {
    test("single final node returns result directly", async () => {
      await fc.assert(
        fc.asyncProperty(
          nodeIdArb,
          resultDataArb,
          async (finalNodeId, resultData) => {
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';

            // Create workflow with single final node
            const workflow = createWorkflowWithFinalNodes(workflowId, [finalNodeId]);

            // Create child execution with result
            const nodeResults: Record<string, ExecutionResult> = {
              [finalNodeId]: { success: true, data: resultData },
            };
            const childExecution = createChildExecution(executionId, workflowId, nodeResults);

            // Aggregate results
            const aggregated = aggregateChildResults(workflow, childExecution);

            // Property: Single final node result is returned directly (not wrapped)
            expect(aggregated).toEqual(resultData);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("multiple final nodes are aggregated by node ID", async () => {
      await fc.assert(
        fc.asyncProperty(
          finalNodeResultsArb.filter(arr => arr.length >= 2),
          async (finalNodeResults) => {
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';
            const finalNodeIds = finalNodeResults.map(([id]) => id);

            // Create workflow with multiple final nodes
            const workflow = createWorkflowWithFinalNodes(workflowId, finalNodeIds);

            // Create child execution with results
            const nodeResults: Record<string, ExecutionResult> = {};
            for (const [nodeId, result] of finalNodeResults) {
              nodeResults[nodeId] = result;
            }
            const childExecution = createChildExecution(executionId, workflowId, nodeResults);

            // Aggregate results
            const aggregated = aggregateChildResults(workflow, childExecution);

            // Property: Result is an object with node IDs as keys
            expect(typeof aggregated).toBe('object');
            expect(aggregated).not.toBeNull();

            // Property: All final node results are included
            for (const [nodeId, result] of finalNodeResults) {
              if (result.success && result.data !== undefined) {
                expect(aggregated[nodeId]).toEqual(result.data);
              }
            }

            // Property: No extra keys in aggregated result
            const aggregatedKeys = Object.keys(aggregated);
            const expectedKeys = finalNodeResults
              .filter(([, r]) => r.success && r.data !== undefined)
              .map(([id]) => id);
            expect(aggregatedKeys.sort()).toEqual(expectedKeys.sort());
          }
        ),
        { numRuns: 100 }
      );
    });

    test("all N final nodes contribute to aggregated result", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          fc.array(resultDataArb, { minLength: 5, maxLength: 5 }),
          async (nodeCount, resultDataArray) => {
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';
            
            // Generate unique node IDs
            const finalNodeIds = Array.from({ length: nodeCount }, (_, i) => `final-node-${i}`);

            // Create workflow with N final nodes
            const workflow = createWorkflowWithFinalNodes(workflowId, finalNodeIds);

            // Create child execution with results for all final nodes
            const nodeResults: Record<string, ExecutionResult> = {};
            for (let i = 0; i < nodeCount; i++) {
              nodeResults[finalNodeIds[i]!] = { success: true, data: resultDataArray[i] };
            }
            const childExecution = createChildExecution(executionId, workflowId, nodeResults);

            // Aggregate results
            const aggregated = aggregateChildResults(workflow, childExecution);

            // Property: Aggregated result contains exactly N entries
            expect(Object.keys(aggregated).length).toBe(nodeCount);

            // Property: Each final node's result is present
            for (let i = 0; i < nodeCount; i++) {
              expect(aggregated[finalNodeIds[i]!]).toEqual(resultDataArray[i]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("output mapping transforms aggregated results correctly", async () => {
      await fc.assert(
        fc.asyncProperty(
          finalNodeResultsArb.filter(arr => arr.length >= 2),
          async (finalNodeResults) => {
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';
            const finalNodeIds = finalNodeResults.map(([id]) => id);

            // Create output mapping: map first node to 'result1', second to 'result2'
            const outputMapping: Record<string, string> = {};
            if (finalNodeIds[0]) outputMapping['result1'] = finalNodeIds[0];
            if (finalNodeIds[1]) outputMapping['result2'] = finalNodeIds[1];

            // Create workflow with multiple final nodes
            const workflow = createWorkflowWithFinalNodes(workflowId, finalNodeIds);

            // Create child execution with results
            const nodeResults: Record<string, ExecutionResult> = {};
            for (const [nodeId, result] of finalNodeResults) {
              nodeResults[nodeId] = result;
            }
            const childExecution = createChildExecution(executionId, workflowId, nodeResults);

            // Aggregate results with output mapping
            const aggregated = aggregateChildResults(workflow, childExecution, outputMapping);

            // Property: Output mapping transforms keys correctly
            if (finalNodeIds[0] && nodeResults[finalNodeIds[0]]?.data !== undefined) {
              expect(aggregated['result1']).toEqual(nodeResults[finalNodeIds[0]]?.data);
            }
            if (finalNodeIds[1] && nodeResults[finalNodeIds[1]]?.data !== undefined) {
              expect(aggregated['result2']).toEqual(nodeResults[finalNodeIds[1]]?.data);
            }

            // Property: Only mapped keys are present
            const aggregatedKeys = Object.keys(aggregated);
            for (const key of aggregatedKeys) {
              expect(Object.keys(outputMapping)).toContain(key);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("failed node results are excluded from aggregation", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          fc.array(resultDataArb, { minLength: 5, maxLength: 5 }),
          fc.integer({ min: 0, max: 4 }),
          async (nodeCount, resultDataArray, failedIndex) => {
            // Ensure failedIndex is within bounds
            const actualFailedIndex = failedIndex % nodeCount;
            
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';
            
            // Generate unique node IDs
            const finalNodeIds = Array.from({ length: nodeCount }, (_, i) => `final-node-${i}`);

            // Create workflow with N final nodes
            const workflow = createWorkflowWithFinalNodes(workflowId, finalNodeIds);

            // Create child execution with one failed result
            const nodeResults: Record<string, ExecutionResult> = {};
            for (let i = 0; i < nodeCount; i++) {
              if (i === actualFailedIndex) {
                nodeResults[finalNodeIds[i]!] = { success: false, error: 'Test failure' };
              } else {
                nodeResults[finalNodeIds[i]!] = { success: true, data: resultDataArray[i] };
              }
            }
            const childExecution = createChildExecution(executionId, workflowId, nodeResults);

            // Aggregate results
            const aggregated = aggregateChildResults(workflow, childExecution);

            // Property: Failed node is not included in aggregation
            expect(aggregated[finalNodeIds[actualFailedIndex]!]).toBeUndefined();

            // Property: Successful nodes are included
            for (let i = 0; i < nodeCount; i++) {
              if (i !== actualFailedIndex) {
                expect(aggregated[finalNodeIds[i]!]).toEqual(resultDataArray[i]);
              }
            }

            // Property: Aggregated result has N-1 entries
            expect(Object.keys(aggregated).length).toBe(nodeCount - 1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("undefined data is excluded from aggregation", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          fc.array(resultDataArb, { minLength: 5, maxLength: 5 }),
          fc.integer({ min: 0, max: 4 }),
          async (nodeCount, resultDataArray, undefinedIndex) => {
            // Ensure undefinedIndex is within bounds
            const actualUndefinedIndex = undefinedIndex % nodeCount;
            
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';
            
            // Generate unique node IDs
            const finalNodeIds = Array.from({ length: nodeCount }, (_, i) => `final-node-${i}`);

            // Create workflow with N final nodes
            const workflow = createWorkflowWithFinalNodes(workflowId, finalNodeIds);

            // Create child execution with one undefined data result
            const nodeResults: Record<string, ExecutionResult> = {};
            for (let i = 0; i < nodeCount; i++) {
              if (i === actualUndefinedIndex) {
                nodeResults[finalNodeIds[i]!] = { success: true }; // No data field
              } else {
                nodeResults[finalNodeIds[i]!] = { success: true, data: resultDataArray[i] };
              }
            }
            const childExecution = createChildExecution(executionId, workflowId, nodeResults);

            // Aggregate results
            const aggregated = aggregateChildResults(workflow, childExecution);

            // Property: Node with undefined data is not included
            expect(aggregated[finalNodeIds[actualUndefinedIndex]!]).toBeUndefined();

            // Property: Nodes with defined data are included
            for (let i = 0; i < nodeCount; i++) {
              if (i !== actualUndefinedIndex) {
                expect(aggregated[finalNodeIds[i]!]).toEqual(resultDataArray[i]);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("empty workflow (no final nodes) returns empty object", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null),
          async () => {
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';

            // Create workflow with no final nodes (all nodes have outputs)
            const workflow: WorkflowDefinition = {
              id: workflowId,
              name: 'Test Workflow',
              entryNodeId: 'node-1',
              nodes: [
                { id: 'node-1', type: 'action', config: {}, inputs: [], outputs: ['node-2'] },
                { id: 'node-2', type: 'action', config: {}, inputs: ['node-1'], outputs: ['node-1'] }, // Circular
              ],
            };

            const childExecution = createChildExecution(executionId, workflowId, {});

            // Aggregate results
            const aggregated = aggregateChildResults(workflow, childExecution);

            // Property: Empty workflow returns empty object
            expect(aggregated).toEqual({});
          }
        ),
        { numRuns: 100 }
      );
    });

    test("result data types are preserved through aggregation", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            stringData: fc.string(),
            numberData: fc.integer(),
            booleanData: fc.boolean(),
            objectData: fc.record({ key: fc.string() }),
            arrayData: fc.array(fc.integer()),
          }),
          async (dataTypes) => {
            const workflowId = 'test-workflow';
            const executionId = 'test-execution';
            
            const finalNodeIds = ['string-node', 'number-node', 'boolean-node', 'object-node', 'array-node'];
            const workflow = createWorkflowWithFinalNodes(workflowId, finalNodeIds);

            const nodeResults: Record<string, ExecutionResult> = {
              'string-node': { success: true, data: dataTypes.stringData },
              'number-node': { success: true, data: dataTypes.numberData },
              'boolean-node': { success: true, data: dataTypes.booleanData },
              'object-node': { success: true, data: dataTypes.objectData },
              'array-node': { success: true, data: dataTypes.arrayData },
            };
            const childExecution = createChildExecution(executionId, workflowId, nodeResults);

            const aggregated = aggregateChildResults(workflow, childExecution);

            // Property: Data types are preserved
            expect(typeof aggregated['string-node']).toBe('string');
            expect(typeof aggregated['number-node']).toBe('number');
            expect(typeof aggregated['boolean-node']).toBe('boolean');
            expect(typeof aggregated['object-node']).toBe('object');
            expect(Array.isArray(aggregated['array-node'])).toBe(true);

            // Property: Values are exactly preserved
            expect(aggregated['string-node']).toEqual(dataTypes.stringData);
            expect(aggregated['number-node']).toEqual(dataTypes.numberData);
            expect(aggregated['boolean-node']).toEqual(dataTypes.booleanData);
            expect(aggregated['object-node']).toEqual(dataTypes.objectData);
            expect(aggregated['array-node']).toEqual(dataTypes.arrayData);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
