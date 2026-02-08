/**
 * Sub-Workflow Handler
 * 
 * Handles sub-workflow execution using BullMQ FlowProducer pattern:
 * - Aggregator node processing (collect child results)
 * - Sub-workflow creation via FlowProducer
 * - DAG-to-flow tree conversion
 */

import type { Job } from 'bullmq';
import type {
    NodeDefinition,
    ExecutionResult,
    WorkflowDefinition,
    SubWorkflowConfig
} from '../../types';
import type { NodeJobData } from '../types';
import type { IExecutionStateStore } from '../../types';
import type { QueueManager } from '../queue-manager';
import { WorkflowEventEmitter } from '../event-emitter';
import { logger } from '../../utils/logger';
import {
    applyInputMapping,
    applyOutputMapping,
    aggregateChildResults,
} from '../node-utils';

export interface SubworkflowHandlerDeps {
    stateStore: IExecutionStateStore;
    queueManager: QueueManager;
    getWorkflowWithLazyLoad: (workflowId: string) => Promise<WorkflowDefinition | null>;
    enqueueNode: (
        executionId: string,
        workflowId: string,
        nodeId: string,
        options?: { delay?: number; delayStep?: 'initial' | 'resumed'; delayStartTime?: number }
    ) => Promise<void>;
}

/**
 * Process a sub-workflow aggregator node (FlowProducer pattern).
 * 
 * This node is automatically created by executeSubWorkflowWithFlow() and serves as
 * the parent job in a BullMQ flow. It waits for all child jobs (sub-workflow nodes)
 * to complete, then aggregates their results using getChildrenValues().
 */
export async function processAggregatorNode(
    data: NodeJobData,
    job: Job,
    deps: SubworkflowHandlerDeps
): Promise<ExecutionResult> {
    const { executionId, workflowId, parentExecutionId, parentNodeId, outputMapping } = data;
    const logContext = { executionId, workflowId, nodeId: '__aggregator__', jobId: job.id };

    logger.info(logContext, `🔄 Processing sub-workflow aggregator node`);

    try {
        // Get results from all child jobs using BullMQ's native method
        const childrenValues = await job.getChildrenValues();

        logger.info(
            { ...logContext, childCount: Object.keys(childrenValues).length },
            `📊 Aggregator collected ${Object.keys(childrenValues).length} child results`
        );

        // Aggregate child results
        const aggregatedResult = aggregateChildResults(childrenValues, executionId);

        // Apply output mapping
        const mappedOutput = applyOutputMapping(aggregatedResult, outputMapping);

        // Mark sub-workflow execution as completed
        await deps.stateStore.setExecutionStatus(executionId, 'completed');

        logger.info(logContext, `✅ Sub-workflow aggregator completed successfully`);

        // Notify parent workflow if this is a nested sub-workflow
        if (parentExecutionId && parentNodeId) {
            logger.info(
                { ...logContext, parentExecutionId, parentNodeId },
                `🔔 Notifying parent workflow of sub-workflow completion`
            );

            // Get parent workflow ID from parent execution
            const parentExecution = await deps.stateStore.getExecution(parentExecutionId);
            const parentWorkflowId = parentExecution?.workflowId || 'unknown';

            // Store the successful result in parent execution state before re-enqueuing.
            // This ensures the parent sees the actual sub-workflow output (not just the initial flowJobId).
            // The parent node's idempotency check will return this stored result.
            await deps.stateStore.updateNodeResult(parentExecutionId, parentNodeId, {
                success: true,
                data: mappedOutput,
            });

            // Re-enqueue the parent node to continue processing
            await deps.enqueueNode(parentExecutionId, parentWorkflowId, parentNodeId);
        }

        return {
            success: true,
            data: mappedOutput
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ ...logContext, error: errorMessage }, `❌ Sub-workflow aggregator failed`);

        // Mark sub-workflow execution as failed
        await deps.stateStore.setExecutionStatus(executionId, 'failed');

        // Store the error result in parent execution state so the parent workflow
        // can see the sub-workflow failure and continue or fail accordingly
        if (parentExecutionId && parentNodeId) {
            const parentExecution = await deps.stateStore.getExecution(parentExecutionId);
            const parentWorkflowId = parentExecution?.workflowId || 'unknown';

            // Store the sub-workflow failure result in the parent's node results
            // This preserves error context and enables proper continueOnFail handling
            await deps.stateStore.updateNodeResult(parentExecutionId, parentNodeId, {
                success: false,
                error: `Sub-workflow aggregation failed: ${errorMessage}`,
            });

            // Re-enqueue the parent node to continue processing
            // The parent will see the failed result in its node results
            await deps.enqueueNode(parentExecutionId, parentWorkflowId, parentNodeId);
        }

        return {
            success: false,
            error: `Sub-workflow aggregation failed: ${errorMessage}`
        };
    }
}

/**
 * Execute a sub-workflow using BullMQ FlowProducer.
 * 
 * Creates a flow with the sub-workflow's entry nodes as children
 * and an aggregator node as the parent. BullMQ handles the dependency management
 * and the aggregator collects results via getChildrenValues().
 */
export async function executeSubWorkflowWithFlow(
    parentExecutionId: string,
    parentNodeId: string,
    config: SubWorkflowConfig,
    inputData: any,
    depth: number,
    job: Job,
    deps: SubworkflowHandlerDeps
): Promise<ExecutionResult> {
    const { workflowId, inputMapping, outputMapping } = config;

    // Validate sub-workflow exists
    const subWorkflow = await deps.getWorkflowWithLazyLoad(workflowId);
    if (!subWorkflow) {
        return {
            success: false,
            error: `Sub-workflow '${workflowId}' not found`
        };
    }

    try {
        // Apply input mapping
        const mappedInput = applyInputMapping(inputData, inputMapping);

        // Create child execution in state store
        const childExecutionId = await deps.stateStore.createExecution(
            workflowId,
            parentExecutionId,
            depth + 1,
            mappedInput
        );

        // Store parent node info in execution metadata
        const parentExecution = await deps.stateStore.getExecution(parentExecutionId);
        const metadata = {
            parentNodeId,
            parentWorkflowId: parentExecution?.workflowId || 'unknown'
        };
        await deps.stateStore.updateExecutionMetadata(childExecutionId, metadata);

        // Find entry nodes (nodes with no inputs)
        const entryNodes = subWorkflow.nodes.filter(n => n.inputs.length === 0);

        if (entryNodes.length === 0) {
            return {
                success: false,
                error: `Sub-workflow '${workflowId}' has no entry nodes`
            };
        }

        logger.info(
            { parentExecutionId, childExecutionId, workflowId, entryNodeCount: entryNodes.length },
            `🔀 Creating FlowProducer flow for sub-workflow ${workflowId}`
        );

        // Build the flow tree recursively from entry nodes
        const childFlows = buildFlowTreeFromEntryNodes(
            subWorkflow,
            entryNodes,
            childExecutionId,
            mappedInput,
            config.continueOnFail
        );

        // Build flow with aggregator as parent
        const flow = await deps.queueManager.flowProducer.add({
            name: 'sub-workflow-aggregator',
            queueName: 'node-execution',
            data: {
                executionId: childExecutionId,
                workflowId: workflowId,
                nodeId: '__aggregator__',
                isSubWorkflowAggregator: true,
                parentExecutionId,
                parentNodeId,
                outputMapping,
            } as NodeJobData & { isSubWorkflowAggregator: boolean; outputMapping?: Record<string, string> },
            opts: {
                jobId: `${childExecutionId}-aggregator`,
            },
            children: childFlows,
        });

        logger.info(
            { childExecutionId, flowJobId: flow.job.id, workflowId, totalNodes: subWorkflow.nodes.length },
            `✅ FlowProducer flow created for sub-workflow ${workflowId}`
        );

        // Return immediately - the aggregator job will handle result collection
        return {
            success: true,
            data: {
                flowJobId: flow.job.id,
                childExecutionId,
                message: 'Sub-workflow started via FlowProducer'
            }
        };
    } catch (error) {
        logger.error(
            { parentExecutionId, workflowId, error },
            `❌ Failed to create FlowProducer flow for sub-workflow ${workflowId}`
        );
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Build a flow tree structure from entry nodes, recursively including all downstream nodes.
 * 
 * Creates a hierarchical flow structure that mirrors the sub-workflow's DAG:
 * - Each node becomes a flow job
 * - In BullMQ FlowProducer, children are dependencies that must complete BEFORE the parent
 * - Final nodes become direct children of the aggregator
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
    // Build a map of node ID to node definition for quick lookup
    const nodeMap = new Map<string, NodeDefinition>();
    for (const node of workflow.nodes) {
        nodeMap.set(node.id, node);
    }

    // Track which nodes have been added to the flow to avoid duplicates
    const addedToFlow = new Map<string, any>();

    // Recursive function to build flow tree for a node and its predecessors
    const buildNodeFlow = (node: NodeDefinition): {
        name: string;
        queueName: string;
        data: NodeJobData;
        opts: { jobId: string; failParentOnFailure?: boolean; ignoreDependencyOnFailure?: boolean };
        children?: any[];
    } => {
        // Check if already built (for DAG with shared nodes)
        if (addedToFlow.has(node.id)) {
            return addedToFlow.get(node.id);
        }

        // Build children flows (predecessor nodes - they must run first)
        const childFlows: any[] = [];
        for (const inputNodeId of node.inputs) {
            const inputNode = nodeMap.get(inputNodeId);
            if (inputNode) {
                childFlows.push(buildNodeFlow(inputNode));
            }
        }

        // Determine if this is an entry node (no inputs)
        const isEntryNode = node.inputs.length === 0;

        // Configure flow dependency options based on continueOnFail setting
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

        // Cache the built node
        addedToFlow.set(node.id, flowNode);

        return flowNode;
    };

    // Find final nodes (nodes with no outputs) - these are direct children of the aggregator
    const finalNodes = workflow.nodes.filter(n => n.outputs.length === 0);

    // If no final nodes found, use all nodes (shouldn't happen in valid workflows)
    const rootNodes = finalNodes.length > 0 ? finalNodes : workflow.nodes;

    // Build flow trees starting from each final node
    return rootNodes.map(node => buildNodeFlow(node));
}
