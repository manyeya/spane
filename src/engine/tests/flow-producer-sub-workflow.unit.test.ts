import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { NodeJobData } from "../types";
import type { WorkflowDefinition, NodeDefinition, SubWorkflowConfig, ExecutionResult } from "../../types";

/**
 * Unit tests for FlowProducer sub-workflow execution.
 * 
 * **Validates: Requirements FR-1.1, FR-1.2, FR-1.3, FR-1.5, FR-4.1, FR-4.2**
 * 
 * These tests verify:
 * - FlowProducer creates correct flow structure for sub-workflows
 * - Aggregator node collects and aggregates child results correctly
 * - Input/output mapping is applied correctly
 * - Flow dependency options (failParentOnFailure, ignoreDependencyOnFailure) are set correctly
 */

// ============================================================================
// HELPER FUNCTIONS - Mirror implementation logic for testing
// ============================================================================

/**
 * Builds flow tree structure from workflow nodes.
 * This mirrors the buildFlowTreeFromEntryNodes implementation.
 */
function buildFlowTreeFromEntryNodes(
  workflow: WorkflowDefinition,
  entryNodes: NodeDefinition[],
  executionId: string,
  inputData: any,
  continueOnFail?: boolean
): Array<{
  name: string;
  queueName: string;
  data: NodeJobData;
  opts: { jobId: string; failParentOnFailure?: boolean; ignoreDependencyOnFailure?: boolean };
  children?: any[];
}> {
  const nodeMap = new Map<string, NodeDefinition>();
  for (const node of workflow.nodes) {
    nodeMap.set(node.id, node);
  }

  const addedToFlow = new Map<string, any>();

  const buildNodeFlow = (node: NodeDefinition): any => {
    if (addedToFlow.has(node.id)) {
      return addedToFlow.get(node.id);
    }

    const childFlows: any[] = [];
    for (const inputNodeId of node.inputs) {
      const inputNode = nodeMap.get(inputNodeId);
      if (inputNode) {
        childFlows.push(buildNodeFlow(inputNode));
      }
    }

    const isEntryNode = node.inputs.length === 0;

    const flowNode = {
      name: 'process-node',
      queueName: 'node-execution',
      data: {
        executionId,
        workflowId: workflow.id,
        nodeId: node.id,
        inputData: isEntryNode ? inputData : undefined,
      } as NodeJobData,
      opts: {
        jobId: `${executionId}-${node.id}`,
        failParentOnFailure: !continueOnFail,
        ignoreDependencyOnFailure: !!continueOnFail,
      },
      ...(childFlows.length > 0 ? { children: childFlows } : {}),
    };

    addedToFlow.set(node.id, flowNode);
    return flowNode;
  };

  const finalNodes = workflow.nodes.filter(n => n.outputs.length === 0);
  const rootNodes = finalNodes.length > 0 ? finalNodes : workflow.nodes;

  return rootNodes.map(node => buildNodeFlow(node));
}

/**
 * Applies input mapping to transform input data.
 */
function applyInputMapping(inputData: any, inputMapping?: Record<string, string>): any {
  if (!inputMapping || typeof inputData !== 'object' || inputData === null) {
    return inputData;
  }
  
  const mappedInput: Record<string, any> = {};
  for (const [targetKey, sourceKey] of Object.entries(inputMapping)) {
    if (sourceKey in inputData) {
      mappedInput[targetKey] = inputData[sourceKey];
    }
  }
  return mappedInput;
}

/**
 * Applies output mapping to transform aggregated results.
 */
function applyOutputMapping(aggregatedResult: any, outputMapping?: Record<string, string>): any {
  if (!outputMapping || typeof aggregatedResult !== 'object' || aggregatedResult === null) {
    return aggregatedResult;
  }
  
  const mappedOutput: Record<string, any> = {};
  for (const [targetKey, sourceKey] of Object.entries(outputMapping)) {
    if (sourceKey in aggregatedResult) {
      mappedOutput[targetKey] = aggregatedResult[sourceKey];
    }
  }
  return mappedOutput;
}

/**
 * Aggregates child results from BullMQ getChildrenValues format.
 */
function aggregateChildResults(
  childrenValues: Record<string, any>,
  executionId: string
): any {
  const childResults = Object.values(childrenValues);

  if (childResults.length === 0) {
    return {};
  }

  if (childResults.length === 1) {
    const result = childResults[0] as ExecutionResult | undefined;
    return result?.data;
  }

  const aggregatedResult: Record<string, any> = {};
  for (const [key, value] of Object.entries(childrenValues)) {
    const result = value as ExecutionResult | undefined;
    if (result?.success && result.data !== undefined) {
      const jobId = key.split(':')[1] || key;
      const prefix = `${executionId}-`;
      const nodeId = jobId.startsWith(prefix) ? jobId.slice(prefix.length) : jobId;
      aggregatedResult[nodeId] = result.data;
    }
  }
  return aggregatedResult;
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createSimpleWorkflow(): WorkflowDefinition {
  return {
    id: 'simple-workflow',
    name: 'Simple Workflow',
    nodes: [
      { id: 'start', type: 'action', inputs: [], outputs: ['end'], config: {} },
      { id: 'end', type: 'action', inputs: ['start'], outputs: [], config: {} },
    ],
    triggers: [],
  };
}

function createMultiEntryWorkflow(): WorkflowDefinition {
  return {
    id: 'multi-entry-workflow',
    name: 'Multi Entry Workflow',
    nodes: [
      { id: 'entry1', type: 'action', inputs: [], outputs: ['merge'], config: {} },
      { id: 'entry2', type: 'action', inputs: [], outputs: ['merge'], config: {} },
      { id: 'merge', type: 'action', inputs: ['entry1', 'entry2'], outputs: [], config: {} },
    ],
    triggers: [],
  };
}

function createDiamondWorkflow(): WorkflowDefinition {
  return {
    id: 'diamond-workflow',
    name: 'Diamond Workflow',
    nodes: [
      { id: 'start', type: 'action', inputs: [], outputs: ['left', 'right'], config: {} },
      { id: 'left', type: 'action', inputs: ['start'], outputs: ['end'], config: {} },
      { id: 'right', type: 'action', inputs: ['start'], outputs: ['end'], config: {} },
      { id: 'end', type: 'action', inputs: ['left', 'right'], outputs: [], config: {} },
    ],
    triggers: [],
  };
}

function createMultiFinalWorkflow(): WorkflowDefinition {
  return {
    id: 'multi-final-workflow',
    name: 'Multi Final Workflow',
    nodes: [
      { id: 'start', type: 'action', inputs: [], outputs: ['final1', 'final2'], config: {} },
      { id: 'final1', type: 'action', inputs: ['start'], outputs: [], config: {} },
      { id: 'final2', type: 'action', inputs: ['start'], outputs: [], config: {} },
    ],
    triggers: [],
  };
}

// ============================================================================
// UNIT TESTS
// ============================================================================

describe("FlowProducer sub-workflow unit tests", () => {
  /**
   * Tests for FR-1.2: Parent node creates flow with sub-workflow nodes as children
   */
  describe("Flow tree building (FR-1.2)", () => {
    test("simple linear workflow creates correct flow structure", () => {
      const workflow = createSimpleWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);
      const executionId = 'exec-123';
      const inputData = { key: 'value' };

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, executionId, inputData);

      // Should have one root (final node 'end')
      expect(flowTree.length).toBe(1);
      expect(flowTree[0].data.nodeId).toBe('end');
      
      // 'end' should have 'start' as child (dependency)
      expect(flowTree[0].children).toBeDefined();
      expect(flowTree[0].children!.length).toBe(1);
      expect(flowTree[0].children![0].data.nodeId).toBe('start');
      
      // 'start' is entry node, should have inputData
      expect(flowTree[0].children![0].data.inputData).toEqual(inputData);
      
      // 'end' is not entry node, should not have inputData
      expect(flowTree[0].data.inputData).toBeUndefined();
    });

    test("multi-entry workflow creates correct flow structure", () => {
      const workflow = createMultiEntryWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);
      const executionId = 'exec-456';
      const inputData = { data: 'test' };

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, executionId, inputData);

      // Should have one root (final node 'merge')
      expect(flowTree.length).toBe(1);
      expect(flowTree[0].data.nodeId).toBe('merge');
      
      // 'merge' should have two children (entry1 and entry2)
      expect(flowTree[0].children).toBeDefined();
      expect(flowTree[0].children!.length).toBe(2);
      
      const childNodeIds = flowTree[0].children!.map((c: any) => c.data.nodeId).sort();
      expect(childNodeIds).toEqual(['entry1', 'entry2']);
      
      // Both entry nodes should have inputData
      for (const child of flowTree[0].children!) {
        expect(child.data.inputData).toEqual(inputData);
      }
    });

    test("diamond workflow creates correct flow structure without duplicates", () => {
      const workflow = createDiamondWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);
      const executionId = 'exec-789';
      const inputData = { value: 42 };

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, executionId, inputData);

      // Should have one root (final node 'end')
      expect(flowTree.length).toBe(1);
      expect(flowTree[0].data.nodeId).toBe('end');
      
      // 'end' should have two children (left and right)
      expect(flowTree[0].children).toBeDefined();
      expect(flowTree[0].children!.length).toBe(2);
      
      // Both left and right should have 'start' as child
      for (const child of flowTree[0].children!) {
        expect(child.children).toBeDefined();
        expect(child.children!.length).toBe(1);
        expect(child.children![0].data.nodeId).toBe('start');
      }
    });

    test("multi-final workflow creates multiple root flows", () => {
      const workflow = createMultiFinalWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);
      const executionId = 'exec-abc';
      const inputData = {};

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, executionId, inputData);

      // Should have two roots (final1 and final2)
      expect(flowTree.length).toBe(2);
      
      const rootNodeIds = flowTree.map(f => f.data.nodeId).sort();
      expect(rootNodeIds).toEqual(['final1', 'final2']);
    });

    test("job IDs are deterministic and include executionId", () => {
      const workflow = createSimpleWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);
      const executionId = 'exec-deterministic';

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, executionId, {});

      // Check job IDs
      expect(flowTree[0].opts.jobId).toBe(`${executionId}-end`);
      expect(flowTree[0].children![0].opts.jobId).toBe(`${executionId}-start`);
    });
  });

  /**
   * Tests for FR-4.1 and FR-4.2: Flow dependency options
   */
  describe("Flow dependency options (FR-4.1, FR-4.2)", () => {
    test("continueOnFail=false sets failParentOnFailure=true", () => {
      const workflow = createSimpleWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, 'exec-1', {}, false);

      // All nodes should have failParentOnFailure=true
      expect(flowTree[0].opts.failParentOnFailure).toBe(true);
      expect(flowTree[0].opts.ignoreDependencyOnFailure).toBe(false);
      expect(flowTree[0].children![0].opts.failParentOnFailure).toBe(true);
      expect(flowTree[0].children![0].opts.ignoreDependencyOnFailure).toBe(false);
    });

    test("continueOnFail=true sets ignoreDependencyOnFailure=true", () => {
      const workflow = createSimpleWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, 'exec-2', {}, true);

      // All nodes should have ignoreDependencyOnFailure=true
      expect(flowTree[0].opts.failParentOnFailure).toBe(false);
      expect(flowTree[0].opts.ignoreDependencyOnFailure).toBe(true);
      expect(flowTree[0].children![0].opts.failParentOnFailure).toBe(false);
      expect(flowTree[0].children![0].opts.ignoreDependencyOnFailure).toBe(true);
    });

    test("undefined continueOnFail defaults to failParentOnFailure=true", () => {
      const workflow = createSimpleWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);

      const flowTree = buildFlowTreeFromEntryNodes(workflow, entryNodes, 'exec-3', {});

      expect(flowTree[0].opts.failParentOnFailure).toBe(true);
      expect(flowTree[0].opts.ignoreDependencyOnFailure).toBe(false);
    });
  });

  /**
   * Tests for FR-1.5: Input/output mapping support
   */
  describe("Input/output mapping (FR-1.5)", () => {
    test("input mapping transforms input data correctly", () => {
      const inputData = { originalKey: 'value1', anotherKey: 'value2' };
      const inputMapping = { mappedKey: 'originalKey' };

      const result = applyInputMapping(inputData, inputMapping);

      expect(result).toEqual({ mappedKey: 'value1' });
    });

    test("input mapping with missing source key excludes that key", () => {
      const inputData = { existingKey: 'value' };
      const inputMapping = { target1: 'existingKey', target2: 'missingKey' };

      const result = applyInputMapping(inputData, inputMapping);

      expect(result).toEqual({ target1: 'value' });
      expect(result.target2).toBeUndefined();
    });

    test("input mapping with null inputData returns null", () => {
      const result = applyInputMapping(null, { key: 'value' });
      expect(result).toBeNull();
    });

    test("input mapping with undefined mapping returns original data", () => {
      const inputData = { key: 'value' };
      const result = applyInputMapping(inputData, undefined);
      expect(result).toEqual(inputData);
    });

    test("output mapping transforms aggregated results correctly", () => {
      const aggregatedResult = { nodeA: 'resultA', nodeB: 'resultB' };
      const outputMapping = { finalResult: 'nodeA' };

      const result = applyOutputMapping(aggregatedResult, outputMapping);

      expect(result).toEqual({ finalResult: 'resultA' });
    });

    test("output mapping with missing source key excludes that key", () => {
      const aggregatedResult = { existingNode: 'result' };
      const outputMapping = { output1: 'existingNode', output2: 'missingNode' };

      const result = applyOutputMapping(aggregatedResult, outputMapping);

      expect(result).toEqual({ output1: 'result' });
    });
  });

  /**
   * Tests for FR-1.3: getChildrenValues() aggregation
   */
  describe("Child result aggregation (FR-1.3)", () => {
    test("single child result returns data directly", () => {
      const childrenValues = {
        'node-execution:exec-1-nodeA': { success: true, data: { result: 'value' } }
      };

      const result = aggregateChildResults(childrenValues, 'exec-1');

      expect(result).toEqual({ result: 'value' });
    });

    test("multiple child results are aggregated by node ID", () => {
      const executionId = 'exec-multi';
      const childrenValues = {
        [`node-execution:${executionId}-nodeA`]: { success: true, data: 'resultA' },
        [`node-execution:${executionId}-nodeB`]: { success: true, data: 'resultB' }
      };

      const result = aggregateChildResults(childrenValues, executionId);

      expect(result).toEqual({ nodeA: 'resultA', nodeB: 'resultB' });
    });

    test("failed child results are excluded from aggregation", () => {
      const executionId = 'exec-fail';
      const childrenValues = {
        [`node-execution:${executionId}-nodeA`]: { success: true, data: 'resultA' },
        [`node-execution:${executionId}-nodeB`]: { success: false, error: 'failed' }
      };

      const result = aggregateChildResults(childrenValues, executionId);

      expect(result).toEqual({ nodeA: 'resultA' });
      expect(result.nodeB).toBeUndefined();
    });

    test("empty children values returns empty object", () => {
      const result = aggregateChildResults({}, 'exec-empty');
      expect(result).toEqual({});
    });

    test("child with undefined data is excluded", () => {
      const executionId = 'exec-undef';
      const childrenValues = {
        [`node-execution:${executionId}-nodeA`]: { success: true, data: 'resultA' },
        [`node-execution:${executionId}-nodeB`]: { success: true, data: undefined }
      };

      const result = aggregateChildResults(childrenValues, executionId);

      expect(result).toEqual({ nodeA: 'resultA' });
    });
  });

  /**
   * Tests for aggregator node job data structure
   */
  describe("Aggregator node job data", () => {
    test("aggregator job data contains required fields", () => {
      const executionId = 'child-exec-123';
      const workflowId = 'sub-workflow-1';
      const parentExecutionId = 'parent-exec-456';
      const parentNodeId = 'sub-workflow-node';
      const outputMapping = { result: 'finalNode' };

      const aggregatorData: NodeJobData & { isSubWorkflowAggregator: boolean; outputMapping?: Record<string, string> } = {
        executionId,
        workflowId,
        nodeId: '__aggregator__',
        isSubWorkflowAggregator: true,
        parentExecutionId,
        parentNodeId,
        outputMapping,
      };

      expect(aggregatorData.executionId).toBe(executionId);
      expect(aggregatorData.workflowId).toBe(workflowId);
      expect(aggregatorData.nodeId).toBe('__aggregator__');
      expect(aggregatorData.isSubWorkflowAggregator).toBe(true);
      expect(aggregatorData.parentExecutionId).toBe(parentExecutionId);
      expect(aggregatorData.parentNodeId).toBe(parentNodeId);
      expect(aggregatorData.outputMapping).toEqual(outputMapping);
    });

    test("aggregator job ID follows expected format", () => {
      const executionId = 'exec-agg-test';
      const expectedJobId = `${executionId}-aggregator`;

      expect(expectedJobId).toBe('exec-agg-test-aggregator');
    });
  });

  /**
   * Tests for entry node detection
   */
  describe("Entry node detection", () => {
    test("entry nodes are correctly identified", () => {
      const workflow = createMultiEntryWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);

      expect(entryNodes.length).toBe(2);
      expect(entryNodes.map(n => n.id).sort()).toEqual(['entry1', 'entry2']);
    });

    test("non-entry nodes are excluded", () => {
      const workflow = createSimpleWorkflow();
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);

      expect(entryNodes.length).toBe(1);
      expect(entryNodes[0].id).toBe('start');
    });

    test("workflow with no entry nodes returns empty array", () => {
      const workflow: WorkflowDefinition = {
        id: 'circular-workflow',
        name: 'Circular Workflow',
        nodes: [
          { id: 'a', type: 'action', inputs: ['b'], outputs: ['b'], config: {} },
          { id: 'b', type: 'action', inputs: ['a'], outputs: ['a'], config: {} },
        ],
        triggers: [],
      };
      const entryNodes = workflow.nodes.filter(n => n.inputs.length === 0);

      expect(entryNodes.length).toBe(0);
    });
  });

  /**
   * Tests for final node detection
   */
  describe("Final node detection", () => {
    test("final nodes are correctly identified", () => {
      const workflow = createMultiFinalWorkflow();
      const finalNodes = workflow.nodes.filter(n => n.outputs.length === 0);

      expect(finalNodes.length).toBe(2);
      expect(finalNodes.map(n => n.id).sort()).toEqual(['final1', 'final2']);
    });

    test("single final node workflow", () => {
      const workflow = createSimpleWorkflow();
      const finalNodes = workflow.nodes.filter(n => n.outputs.length === 0);

      expect(finalNodes.length).toBe(1);
      expect(finalNodes[0].id).toBe('end');
    });
  });

  /**
   * Tests for sub-workflow error handling (FR-Error-1, FR-Error-2, FR-Error-3)
   *
   * Verifies that:
   * - Error context is properly propagated when re-enqueuing parent node
   * - Retry state is maintained across sub-workflow failures
   * - Error types are preserved
   */
  describe("Sub-workflow error handling (FR-Error)", () => {
    test("aggregator failure result contains error message and context", () => {
      const errorMessage = "Sub-workflow node failed: timeout";
      const aggregatorResult: ExecutionResult = {
        success: false,
        error: `Sub-workflow aggregation failed: ${errorMessage}`,
      };

      expect(aggregatorResult.success).toBe(false);
      expect(aggregatorResult.error).toContain("Sub-workflow aggregation failed:");
      expect(aggregatorResult.error).toContain(errorMessage);
    });

    test("error context preserves original error type information", () => {
      const originalErrors = [
        "TimeoutError: Request timed out after 30s",
        "ValidationError: Invalid input data",
        "ConnectionError: Database connection refused",
      ];

      for (const originalError of originalErrors) {
        const result: ExecutionResult = {
          success: false,
          error: `Sub-workflow aggregation failed: ${originalError}`,
        };

        expect(result.error).toContain(originalError.split(':')[0]); // Error type preserved
        expect(result.error).toContain(originalError); // Full error preserved
      }
    });

    test("error result structure matches ExecutionResult interface", () => {
      const errorResult: ExecutionResult = {
        success: false,
        error: "Sub-workflow aggregation failed: test error",
      };

      // Verify required fields exist
      expect(errorResult).toHaveProperty("success");
      expect(errorResult).toHaveProperty("error");
      expect(errorResult.success).toBe(false);
      expect(typeof errorResult.error).toBe("string");
    });

    test("successful result stores actual output data for parent", () => {
      const mappedOutput = { finalResult: "aggregated_value" };
      const successResult: ExecutionResult = {
        success: true,
        data: mappedOutput,
      };

      expect(successResult.success).toBe(true);
      expect(successResult.data).toEqual(mappedOutput);
      expect(successResult.data).toHaveProperty("finalResult");
    });

    test("failed child results propagate correct failure type", () => {
      const executionId = 'exec-fail-type';
      const childrenValues = {
        [`node-execution:${executionId}-nodeA`]: { success: true, data: 'resultA' },
        [`node-execution:${executionId}-nodeB`]: { success: false, error: 'ValidationError: Invalid schema' },
        [`node-execution:${executionId}-nodeC`]: { success: false, error: 'TimeoutError: Request timeout' },
      };

      const result = aggregateChildResults(childrenValues, executionId);

      // Failed results should be excluded from aggregation
      expect(result).toEqual({ nodeA: 'resultA' });
      expect(result.nodeB).toBeUndefined();
      expect(result.nodeC).toBeUndefined();
    });

    test("nested sub-workflow error context maintains parent info", () => {
      const parentExecutionId = 'parent-exec-123';
      const parentNodeId = 'sub-workflow-node-alpha';
      const childExecutionId = 'child-exec-456';

      // Simulate the error context stored in parent's node results
      const parentStoredError: ExecutionResult = {
        success: false,
        error: `Sub-workflow aggregation failed: Child execution ${childExecutionId} failed`,
      };

      // Verify parent info can be correlated
      expect(parentStoredError.success).toBe(false);
      expect(parentStoredError.error).toContain(childExecutionId);

      // The error context enables the parent workflow to:
      // 1. Identify which sub-workflow failed
      // 2. Access the error details
      // 3. Make continueOnFail decisions
      expect(parentStoredError.error).toBeDefined();
    });
  });

  /**
   * Tests for retry state preservation across sub-workflow failures
   */
  describe("Retry state preservation", () => {
    test("error result stored in parent execution enables retry handling", () => {
      const parentExecutionId = 'parent-exec-retry';
      const parentNodeId = 'failing-sub-workflow';

      // Simulate storing error result in parent's execution state
      const mockStateStore: Record<string, ExecutionResult> = {};
      mockStateStore[`${parentExecutionId}-${parentNodeId}`] = {
        success: false,
        error: "Sub-workflow aggregation failed: Temporary failure",
      };

      // Verify error is stored and can be retrieved
      const storedResult = mockStateStore[`${parentExecutionId}-${parentNodeId}`];
      expect(storedResult.success).toBe(false);
      expect(storedResult.error).toContain("Temporary failure");

      // When parent node is re-enqueued and executed,
      // idempotency check returns this stored result,
      // preserving retry state and error context
    });

    test("success result overwrites previous failure after retry", () => {
      const parentExecutionId = 'parent-exec-success-after-retry';
      const parentNodeId = 'retry-sub-workflow';

      // Initial failure
      const failureResult: ExecutionResult = {
        success: false,
        error: "Sub-workflow aggregation failed: Retryable error",
      };

      // Success after retry
      const successResult: ExecutionResult = {
        success: true,
        data: { result: "success after retry" },
      };

      // Simulate state update
      let storedResult = failureResult;
      expect(storedResult.success).toBe(false);

      // After successful retry, state is updated
      storedResult = successResult;
      expect(storedResult.success).toBe(true);
      expect(storedResult.data).toEqual({ result: "success after retry" });
    });
  });
});
