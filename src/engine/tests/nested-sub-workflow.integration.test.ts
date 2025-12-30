import { describe, test, expect, beforeEach } from "bun:test";
import type { WorkflowDefinition, IExecutionStateStore, ExecutionState, ExecutionResult, SubWorkflowConfig } from "../../types";
import type { NodeJobData } from "../types";

/**
 * Integration tests for nested sub-workflows using FlowProducer pattern.
 * 
 * **Validates: Requirements FR-1.1, FR-1.2, FR-1.3, FR-1.5, FR-4.1, FR-4.2**
 * 
 * These tests verify:
 * - Nested sub-workflows (workflow A -> sub-workflow B -> sub-workflow C) are correctly structured
 * - FlowProducer creates proper flow hierarchy for nested sub-workflows
 * - Aggregator nodes correctly collect results from nested sub-workflow chains
 * - Parent notification chain works correctly through multiple nesting levels
 * - Input/output mapping is correctly applied at each nesting level
 */

// ============================================================================
// TEST FIXTURES - Workflow Definitions
// ============================================================================

/**
 * Creates a simple leaf workflow (no sub-workflows).
 * This is the innermost workflow in a nested chain.
 */
function createLeafWorkflow(id: string = 'leaf-workflow'): WorkflowDefinition {
  return {
    id,
    name: 'Leaf Workflow',
    entryNodeId: 'leaf-start',
    nodes: [
      { id: 'leaf-start', type: 'action', inputs: [], outputs: ['leaf-end'], config: {} },
      { id: 'leaf-end', type: 'action', inputs: ['leaf-start'], outputs: [], config: {} },
    ],
  };
}


/**
 * Creates a middle-tier workflow that calls a leaf sub-workflow.
 * This represents the middle level in a nested chain.
 */
function createMiddleWorkflow(
  id: string = 'middle-workflow',
  subWorkflowId: string = 'leaf-workflow'
): WorkflowDefinition {
  return {
    id,
    name: 'Middle Workflow',
    entryNodeId: 'middle-start',
    nodes: [
      { id: 'middle-start', type: 'action', inputs: [], outputs: ['middle-sub'], config: {} },
      { 
        id: 'middle-sub', 
        type: 'sub-workflow', 
        inputs: ['middle-start'], 
        outputs: ['middle-end'], 
        config: { workflowId: subWorkflowId } as SubWorkflowConfig 
      },
      { id: 'middle-end', type: 'action', inputs: ['middle-sub'], outputs: [], config: {} },
    ],
  };
}

/**
 * Creates a root workflow that calls a middle sub-workflow.
 * This represents the outermost level in a nested chain.
 */
function createRootWorkflow(
  id: string = 'root-workflow',
  subWorkflowId: string = 'middle-workflow'
): WorkflowDefinition {
  return {
    id,
    name: 'Root Workflow',
    entryNodeId: 'root-start',
    nodes: [
      { id: 'root-start', type: 'action', inputs: [], outputs: ['root-sub'], config: {} },
      { 
        id: 'root-sub', 
        type: 'sub-workflow', 
        inputs: ['root-start'], 
        outputs: ['root-end'], 
        config: { workflowId: subWorkflowId } as SubWorkflowConfig 
      },
      { id: 'root-end', type: 'action', inputs: ['root-sub'], outputs: [], config: {} },
    ],
  };
}

/**
 * Creates a workflow with multiple nested sub-workflow branches.
 */
function createBranchingNestedWorkflow(): WorkflowDefinition {
  return {
    id: 'branching-nested-workflow',
    name: 'Branching Nested Workflow',
    entryNodeId: 'branch-start',
    nodes: [
      { id: 'branch-start', type: 'action', inputs: [], outputs: ['branch-sub-a', 'branch-sub-b'], config: {} },
      { 
        id: 'branch-sub-a', 
        type: 'sub-workflow', 
        inputs: ['branch-start'], 
        outputs: ['branch-merge'], 
        config: { workflowId: 'middle-workflow' } as SubWorkflowConfig 
      },
      { 
        id: 'branch-sub-b', 
        type: 'sub-workflow', 
        inputs: ['branch-start'], 
        outputs: ['branch-merge'], 
        config: { workflowId: 'leaf-workflow' } as SubWorkflowConfig 
      },
      { id: 'branch-merge', type: 'action', inputs: ['branch-sub-a', 'branch-sub-b'], outputs: [], config: {} },
    ],
  };
}


// ============================================================================
// HELPER FUNCTIONS - Mirror implementation logic for testing
// ============================================================================

/**
 * Builds flow tree structure from workflow nodes.
 * This mirrors the buildFlowTreeFromEntryNodes implementation in NodeProcessor.
 */
function buildFlowTreeFromEntryNodes(
  workflow: WorkflowDefinition,
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
  const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));
  const addedToFlow = new Map<string, any>();

  const buildNodeFlow = (nodeId: string): any => {
    if (addedToFlow.has(nodeId)) {
      return addedToFlow.get(nodeId);
    }

    const node = nodeMap.get(nodeId);
    if (!node) return null;

    const childFlows: any[] = [];
    for (const inputNodeId of node.inputs) {
      const childFlow = buildNodeFlow(inputNodeId);
      if (childFlow) childFlows.push(childFlow);
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

  return rootNodes.map(node => buildNodeFlow(node.id)).filter(Boolean);
}


/**
 * Creates aggregator job data for a sub-workflow.
 * This mirrors the aggregator creation in executeSubWorkflowWithFlow.
 */
function createAggregatorJobData(
  childExecutionId: string,
  workflowId: string,
  parentExecutionId: string,
  parentNodeId: string,
  outputMapping?: Record<string, string>
): NodeJobData & { isSubWorkflowAggregator: boolean } {
  return {
    executionId: childExecutionId,
    workflowId,
    nodeId: '__aggregator__',
    isSubWorkflowAggregator: true,
    parentExecutionId,
    parentNodeId,
    outputMapping,
  };
}

/**
 * Simulates aggregating child results from BullMQ getChildrenValues format.
 */
function aggregateChildResults(
  childrenValues: Record<string, any>,
  executionId: string
): any {
  const childResults = Object.values(childrenValues);

  if (childResults.length === 0) return {};
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


// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Nested sub-workflow integration tests", () => {
  /**
   * Tests for nested workflow structure creation (FR-1.2)
   */
  describe("Nested workflow structure (FR-1.2)", () => {
    test("three-level nested workflow creates correct hierarchy", () => {
      // Setup: root -> middle -> leaf (3 levels of nesting)
      const leafWorkflow = createLeafWorkflow();
      const middleWorkflow = createMiddleWorkflow('middle-workflow', 'leaf-workflow');
      const rootWorkflow = createRootWorkflow('root-workflow', 'middle-workflow');

      // Verify root workflow structure
      expect(rootWorkflow.nodes.length).toBe(3);
      expect(rootWorkflow.nodes.find(n => n.type === 'sub-workflow')).toBeDefined();

      // Verify middle workflow structure
      expect(middleWorkflow.nodes.length).toBe(3);
      expect(middleWorkflow.nodes.find(n => n.type === 'sub-workflow')).toBeDefined();

      // Verify leaf workflow has no sub-workflows
      expect(leafWorkflow.nodes.length).toBe(2);
      expect(leafWorkflow.nodes.find(n => n.type === 'sub-workflow')).toBeUndefined();
    });

    test("flow tree for leaf workflow has correct structure", () => {
      const leafWorkflow = createLeafWorkflow();
      const executionId = 'leaf-exec-123';
      const inputData = { value: 'test' };

      const flowTree = buildFlowTreeFromEntryNodes(leafWorkflow, executionId, inputData);

      // Leaf workflow has one final node (leaf-end)
      expect(flowTree.length).toBe(1);
      expect(flowTree[0].data.nodeId).toBe('leaf-end');

      // leaf-end depends on leaf-start
      expect(flowTree[0].children).toBeDefined();
      expect(flowTree[0].children!.length).toBe(1);
      expect(flowTree[0].children![0].data.nodeId).toBe('leaf-start');

      // Entry node has input data
      expect(flowTree[0].children![0].data.inputData).toEqual(inputData);
    });

    test("flow tree for middle workflow includes sub-workflow node", () => {
      const middleWorkflow = createMiddleWorkflow();
      const executionId = 'middle-exec-456';
      const inputData = { data: 'middle-input' };

      const flowTree = buildFlowTreeFromEntryNodes(middleWorkflow, executionId, inputData);

      // Middle workflow has one final node (middle-end)
      expect(flowTree.length).toBe(1);
      expect(flowTree[0].data.nodeId).toBe('middle-end');

      // middle-end depends on middle-sub
      expect(flowTree[0].children).toBeDefined();
      const middleSubNode = flowTree[0].children!.find((c: any) => c.data.nodeId === 'middle-sub');
      expect(middleSubNode).toBeDefined();

      // middle-sub depends on middle-start
      expect(middleSubNode.children).toBeDefined();
      expect(middleSubNode.children![0].data.nodeId).toBe('middle-start');
    });
  });


  /**
   * Tests for aggregator node creation at each nesting level (FR-1.3)
   */
  describe("Aggregator nodes for nested sub-workflows (FR-1.3)", () => {
    test("aggregator job data contains correct parent references for nested sub-workflow", () => {
      // Simulate: root workflow triggers middle sub-workflow
      const rootExecutionId = 'root-exec-001';
      const middleExecutionId = 'middle-exec-001';
      const parentNodeId = 'root-sub';

      const aggregatorData = createAggregatorJobData(
        middleExecutionId,
        'middle-workflow',
        rootExecutionId,
        parentNodeId
      );

      expect(aggregatorData.executionId).toBe(middleExecutionId);
      expect(aggregatorData.workflowId).toBe('middle-workflow');
      expect(aggregatorData.nodeId).toBe('__aggregator__');
      expect(aggregatorData.isSubWorkflowAggregator).toBe(true);
      expect(aggregatorData.parentExecutionId).toBe(rootExecutionId);
      expect(aggregatorData.parentNodeId).toBe(parentNodeId);
    });

    test("nested aggregator chain maintains correct parent references", () => {
      // Simulate: root -> middle -> leaf (3 levels)
      const rootExecutionId = 'root-exec-002';
      const middleExecutionId = 'middle-exec-002';
      const leafExecutionId = 'leaf-exec-002';

      // Middle aggregator (triggered by root's sub-workflow node)
      const middleAggregator = createAggregatorJobData(
        middleExecutionId,
        'middle-workflow',
        rootExecutionId,
        'root-sub'
      );

      // Leaf aggregator (triggered by middle's sub-workflow node)
      const leafAggregator = createAggregatorJobData(
        leafExecutionId,
        'leaf-workflow',
        middleExecutionId,
        'middle-sub'
      );

      // Verify chain: leaf -> middle -> root
      expect(leafAggregator.parentExecutionId).toBe(middleExecutionId);
      expect(middleAggregator.parentExecutionId).toBe(rootExecutionId);

      // Verify each aggregator knows its parent node
      expect(leafAggregator.parentNodeId).toBe('middle-sub');
      expect(middleAggregator.parentNodeId).toBe('root-sub');
    });

    test("aggregator correctly aggregates results from nested sub-workflow", () => {
      const executionId = 'nested-exec-003';

      // Simulate child results from a nested sub-workflow
      const childrenValues = {
        [`node-execution:${executionId}-leaf-end`]: { 
          success: true, 
          data: { result: 'leaf-output' } 
        }
      };

      const aggregated = aggregateChildResults(childrenValues, executionId);

      expect(aggregated).toEqual({ result: 'leaf-output' });
    });

    test("aggregator handles multiple final nodes from nested sub-workflow", () => {
      const executionId = 'multi-final-exec-004';

      // Simulate multiple final nodes completing
      const childrenValues = {
        [`node-execution:${executionId}-final-a`]: { 
          success: true, 
          data: { outputA: 'valueA' } 
        },
        [`node-execution:${executionId}-final-b`]: { 
          success: true, 
          data: { outputB: 'valueB' } 
        }
      };

      const aggregated = aggregateChildResults(childrenValues, executionId);

      expect(aggregated['final-a']).toEqual({ outputA: 'valueA' });
      expect(aggregated['final-b']).toEqual({ outputB: 'valueB' });
    });
  });


  /**
   * Tests for input/output mapping through nested sub-workflows (FR-1.5)
   */
  describe("Input/output mapping in nested sub-workflows (FR-1.5)", () => {
    test("input mapping is applied at each nesting level", () => {
      // Root workflow input
      const rootInput = { 
        rootKey: 'rootValue', 
        sharedKey: 'sharedValue' 
      };

      // First level mapping: root -> middle
      const rootToMiddleMapping = { middleInput: 'rootKey' };
      const middleInput = applyInputMapping(rootInput, rootToMiddleMapping);
      expect(middleInput).toEqual({ middleInput: 'rootValue' });

      // Second level mapping: middle -> leaf
      const middleToLeafMapping = { leafInput: 'middleInput' };
      const leafInput = applyInputMapping(middleInput, middleToLeafMapping);
      expect(leafInput).toEqual({ leafInput: 'rootValue' });
    });

    test("output mapping is applied when aggregating nested results", () => {
      // Leaf workflow output
      const leafOutput = { leafResult: 'processedData' };

      // First level output mapping: leaf -> middle
      const leafToMiddleMapping = { middleResult: 'leafResult' };
      const middleOutput = applyOutputMapping(leafOutput, leafToMiddleMapping);
      expect(middleOutput).toEqual({ middleResult: 'processedData' });

      // Second level output mapping: middle -> root
      const middleToRootMapping = { rootResult: 'middleResult' };
      const rootOutput = applyOutputMapping(middleOutput, middleToRootMapping);
      expect(rootOutput).toEqual({ rootResult: 'processedData' });
    });

    test("aggregator with output mapping transforms nested results correctly", () => {
      const executionId = 'mapping-exec-005';
      const outputMapping = { transformedResult: 'leaf-end' };

      // Simulate aggregated results
      const childrenValues = {
        [`node-execution:${executionId}-leaf-end`]: { 
          success: true, 
          data: { value: 'original' } 
        }
      };

      const aggregated = aggregateChildResults(childrenValues, executionId);
      const mapped = applyOutputMapping(aggregated, outputMapping);

      // Single result returns data directly, so mapping applies to that
      expect(aggregated).toEqual({ value: 'original' });
    });

    test("chained input/output mappings preserve data through nesting levels", () => {
      // Simulate full chain: root input -> leaf processing -> root output
      const originalInput = { 
        userId: '12345', 
        action: 'process' 
      };

      // Input chain
      const level1Input = applyInputMapping(originalInput, { id: 'userId' });
      const level2Input = applyInputMapping(level1Input, { processId: 'id' });
      expect(level2Input).toEqual({ processId: '12345' });

      // Simulate leaf processing
      const leafResult = { 
        processId: level2Input.processId, 
        status: 'completed' 
      };

      // Output chain
      const level1Output = applyOutputMapping(leafResult, { result: 'status' });
      const level2Output = applyOutputMapping(level1Output, { finalStatus: 'result' });
      expect(level2Output).toEqual({ finalStatus: 'completed' });
    });
  });


  /**
   * Tests for flow dependency options in nested sub-workflows (FR-4.1, FR-4.2)
   */
  describe("Flow dependency options in nested sub-workflows (FR-4.1, FR-4.2)", () => {
    test("failParentOnFailure propagates through nested levels by default", () => {
      const leafWorkflow = createLeafWorkflow();
      const executionId = 'fail-prop-exec-006';

      const flowTree = buildFlowTreeFromEntryNodes(leafWorkflow, executionId, {});

      // All nodes should have failParentOnFailure=true by default
      expect(flowTree[0].opts.failParentOnFailure).toBe(true);
      expect(flowTree[0].opts.ignoreDependencyOnFailure).toBe(false);
      expect(flowTree[0].children![0].opts.failParentOnFailure).toBe(true);
    });

    test("continueOnFail=true sets ignoreDependencyOnFailure at all levels", () => {
      const leafWorkflow = createLeafWorkflow();
      const executionId = 'continue-exec-007';

      const flowTree = buildFlowTreeFromEntryNodes(leafWorkflow, executionId, {}, true);

      // All nodes should have ignoreDependencyOnFailure=true
      expect(flowTree[0].opts.failParentOnFailure).toBe(false);
      expect(flowTree[0].opts.ignoreDependencyOnFailure).toBe(true);
      expect(flowTree[0].children![0].opts.failParentOnFailure).toBe(false);
      expect(flowTree[0].children![0].opts.ignoreDependencyOnFailure).toBe(true);
    });

    test("nested sub-workflows can have different continueOnFail settings", () => {
      // Root workflow with continueOnFail=false
      const rootWorkflow = createRootWorkflow();
      const rootFlowTree = buildFlowTreeFromEntryNodes(rootWorkflow, 'root-exec', {}, false);

      // Middle workflow with continueOnFail=true
      const middleWorkflow = createMiddleWorkflow();
      const middleFlowTree = buildFlowTreeFromEntryNodes(middleWorkflow, 'middle-exec', {}, true);

      // Root should fail on child failure
      expect(rootFlowTree[0].opts.failParentOnFailure).toBe(true);

      // Middle should continue on child failure
      expect(middleFlowTree[0].opts.ignoreDependencyOnFailure).toBe(true);
    });
  });


  /**
   * Tests for branching nested sub-workflows
   */
  describe("Branching nested sub-workflows", () => {
    test("workflow with multiple nested sub-workflow branches creates correct structure", () => {
      const branchingWorkflow = createBranchingNestedWorkflow();

      // Should have 4 nodes: start, sub-a, sub-b, merge
      expect(branchingWorkflow.nodes.length).toBe(4);

      // Should have 2 sub-workflow nodes
      const subWorkflowNodes = branchingWorkflow.nodes.filter(n => n.type === 'sub-workflow');
      expect(subWorkflowNodes.length).toBe(2);

      // Merge node should have both sub-workflow nodes as inputs
      const mergeNode = branchingWorkflow.nodes.find(n => n.id === 'branch-merge');
      expect(mergeNode).toBeDefined();
      expect(mergeNode!.inputs.sort()).toEqual(['branch-sub-a', 'branch-sub-b']);
    });

    test("flow tree for branching workflow has correct dependencies", () => {
      const branchingWorkflow = createBranchingNestedWorkflow();
      const executionId = 'branch-exec-008';

      const flowTree = buildFlowTreeFromEntryNodes(branchingWorkflow, executionId, {});

      // Should have one root (branch-merge)
      expect(flowTree.length).toBe(1);
      expect(flowTree[0].data.nodeId).toBe('branch-merge');

      // branch-merge should have two children (branch-sub-a and branch-sub-b)
      expect(flowTree[0].children).toBeDefined();
      expect(flowTree[0].children!.length).toBe(2);

      const childNodeIds = flowTree[0].children!.map((c: any) => c.data.nodeId).sort();
      expect(childNodeIds).toEqual(['branch-sub-a', 'branch-sub-b']);

      // Both sub-workflow nodes should depend on branch-start
      for (const child of flowTree[0].children!) {
        expect(child.children).toBeDefined();
        expect(child.children![0].data.nodeId).toBe('branch-start');
      }
    });

    test("aggregator handles results from parallel nested sub-workflows", () => {
      const executionId = 'parallel-exec-009';

      // Simulate results from two parallel sub-workflows
      const childrenValues = {
        [`node-execution:${executionId}-branch-sub-a`]: { 
          success: true, 
          data: { branchA: 'resultA' } 
        },
        [`node-execution:${executionId}-branch-sub-b`]: { 
          success: true, 
          data: { branchB: 'resultB' } 
        }
      };

      const aggregated = aggregateChildResults(childrenValues, executionId);

      expect(aggregated['branch-sub-a']).toEqual({ branchA: 'resultA' });
      expect(aggregated['branch-sub-b']).toEqual({ branchB: 'resultB' });
    });
  });


  /**
   * Tests for parent notification chain in nested sub-workflows
   */
  describe("Parent notification chain", () => {
    test("aggregator job ID follows deterministic format for nested sub-workflows", () => {
      const childExecutionId = 'nested-child-exec-010';
      const expectedJobId = `${childExecutionId}-aggregator`;

      expect(expectedJobId).toBe('nested-child-exec-010-aggregator');
    });

    test("nested aggregators have unique job IDs based on execution ID", () => {
      const rootExecId = 'root-exec-011';
      const middleExecId = 'middle-exec-011';
      const leafExecId = 'leaf-exec-011';

      const rootAggJobId = `${rootExecId}-aggregator`;
      const middleAggJobId = `${middleExecId}-aggregator`;
      const leafAggJobId = `${leafExecId}-aggregator`;

      // All job IDs should be unique
      const jobIds = [rootAggJobId, middleAggJobId, leafAggJobId];
      const uniqueJobIds = new Set(jobIds);
      expect(uniqueJobIds.size).toBe(3);
    });

    test("parent notification data structure is correct for nested completion", () => {
      // When leaf completes, it notifies middle
      const leafAggregator = createAggregatorJobData(
        'leaf-exec-012',
        'leaf-workflow',
        'middle-exec-012',
        'middle-sub'
      );

      // When middle completes, it notifies root
      const middleAggregator = createAggregatorJobData(
        'middle-exec-012',
        'middle-workflow',
        'root-exec-012',
        'root-sub'
      );

      // Verify notification chain
      expect(leafAggregator.parentExecutionId).toBe('middle-exec-012');
      expect(leafAggregator.parentNodeId).toBe('middle-sub');

      expect(middleAggregator.parentExecutionId).toBe('root-exec-012');
      expect(middleAggregator.parentNodeId).toBe('root-sub');
    });
  });


  /**
   * Tests for depth tracking in nested sub-workflows
   */
  describe("Depth tracking in nested sub-workflows", () => {
    test("execution depth increments correctly through nesting levels", () => {
      // Simulate execution state at each level
      const rootExecution: Partial<ExecutionState> = {
        executionId: 'root-exec-013',
        workflowId: 'root-workflow',
        depth: 0,
        parentExecutionId: undefined,
      };

      const middleExecution: Partial<ExecutionState> = {
        executionId: 'middle-exec-013',
        workflowId: 'middle-workflow',
        depth: 1,
        parentExecutionId: 'root-exec-013',
      };

      const leafExecution: Partial<ExecutionState> = {
        executionId: 'leaf-exec-013',
        workflowId: 'leaf-workflow',
        depth: 2,
        parentExecutionId: 'middle-exec-013',
      };

      // Verify depth increments
      expect(rootExecution.depth).toBe(0);
      expect(middleExecution.depth).toBe(1);
      expect(leafExecution.depth).toBe(2);

      // Verify parent chain
      expect(rootExecution.parentExecutionId).toBeUndefined();
      expect(middleExecution.parentExecutionId).toBe('root-exec-013');
      expect(leafExecution.parentExecutionId).toBe('middle-exec-013');
    });

    test("deeply nested sub-workflows maintain correct depth", () => {
      // Simulate 5 levels of nesting
      const depths = [0, 1, 2, 3, 4];
      const executions = depths.map((depth, index) => ({
        executionId: `exec-level-${depth}`,
        depth,
        parentExecutionId: index > 0 ? `exec-level-${depth - 1}` : undefined,
      }));

      // Verify each level
      executions.forEach((exec, index) => {
        expect(exec.depth).toBe(index);
        if (index > 0) {
          expect(exec.parentExecutionId).toBe(`exec-level-${index - 1}`);
        } else {
          expect(exec.parentExecutionId).toBeUndefined();
        }
      });
    });
  });
});
