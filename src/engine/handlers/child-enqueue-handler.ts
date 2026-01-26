/**
 * Child Enqueue Handler
 * 
 * Handles child node enqueueing, skip propagation, and workflow completion:
 * - Check and enqueue ready children after parent completes
 * - Skip nodes not selected by conditional branching
 * - Detect and handle workflow completion with distributed locking
 */

import type { Job } from 'bullmq';
import type { NodeDefinition, ExecutionResult, WorkflowDefinition } from '../../types';
import type { NodeJobData } from '../types';
import type { IExecutionStateStore } from '../../types';
import type { QueueManager } from '../queue-manager';
import { DistributedLock } from '../../utils/distributed-lock';
import { WorkflowEventEmitter } from '../event-emitter';
import { logger } from '../../utils/logger';
import { generateNodeJobId, extractRetryConfig } from '../node-utils';

export interface ChildEnqueueHandlerDeps {
    stateStore: IExecutionStateStore;
    queueManager: QueueManager;
    distributedLock: DistributedLock;
    getWorkflowWithLazyLoad: (workflowId: string) => Promise<WorkflowDefinition | null>;
}

/**
 * Check and enqueue children of a completed node.
 * 
 * For each child:
 * - If excluded by conditional branching (nextNodes), mark as skipped
 * - If all parents completed/skipped, enqueue the child
 * - Otherwise, wait for other parents
 */
export async function checkAndEnqueueChildren(
    executionId: string,
    workflowId: string,
    node: NodeDefinition,
    nextNodes: string[] | undefined,
    job: Job | undefined,
    deps: ChildEnqueueHandlerDeps
): Promise<void> {
    const workflow = await deps.getWorkflowWithLazyLoad(workflowId);
    if (!workflow) return;

    for (const childNodeId of node.outputs) {
        // Check if this child should be skipped based on conditional branching
        const shouldRun = !nextNodes || nextNodes.includes(childNodeId);

        if (!shouldRun) {
            logger.info({ executionId, workflowId, childNodeId }, `🚫 Node ${childNodeId} excluded by conditional branching. Marking as skipped.`);
            await skipNode(executionId, workflowId, childNodeId, job, deps);
            continue;
        }

        const childNode = workflow.nodes.find(n => n.id === childNodeId);
        if (!childNode) continue;

        // Check if all parents of this child have completed
        const parentIds = childNode.inputs;
        const parentResults = await deps.stateStore.getNodeResults(executionId, parentIds);

        const allParentsCompleted = parentIds.every(pid => {
            const res = parentResults[pid];
            return res && (res.success || res.skipped);
        });

        if (allParentsCompleted) {
            logger.info({ executionId, workflowId, childNodeId }, `✅ All parents of ${childNodeId} resolved, enqueueing`);
            await enqueueNode(executionId, workflowId, childNodeId, {}, deps);
        } else {
            logger.info({ executionId, workflowId, childNodeId }, `⏳ Child node ${childNodeId} waiting for other parents`);
        }
    }
}

/**
 * Mark a node as skipped and propagate to its children.
 */
export async function skipNode(
    executionId: string,
    workflowId: string,
    nodeId: string,
    job: Job | undefined,
    deps: ChildEnqueueHandlerDeps
): Promise<void> {
    // Mark as skipped in state store
    await deps.stateStore.updateNodeResult(executionId, nodeId, {
        success: true,
        skipped: true,
        data: null
    });

    // Emit 'skipped' event if job is available
    if (job) {
        await WorkflowEventEmitter.emitNodeSkipped(job, nodeId, workflowId, executionId);
    }

    // Propagate skip to children
    const workflow = await deps.getWorkflowWithLazyLoad(workflowId);
    const node = workflow?.nodes.find(n => n.id === nodeId);
    if (node) {
        // Recursively check children - skipped node doesn't choose paths
        await checkAndEnqueueChildren(executionId, workflowId, node, undefined, job, deps);
    }
}

/**
 * Enqueue a node for execution with retry configuration.
 */
export async function enqueueNode(
    executionId: string,
    workflowId: string,
    nodeId: string,
    options: {
        delay?: number;
        delayStep?: 'initial' | 'resumed';
        delayStartTime?: number;
    },
    deps: ChildEnqueueHandlerDeps
): Promise<void> {
    const jobData: NodeJobData = {
        executionId,
        workflowId,
        nodeId,
        inputData: {}, // Input data is fetched during execution now
        delayStep: options.delayStep,
        delayStartTime: options.delayStartTime,
    };

    // Generate deterministic job ID
    const jobId = generateNodeJobId(executionId, nodeId, options.delayStep);

    // Fetch node configuration for retry policy
    const workflow = await deps.getWorkflowWithLazyLoad(workflowId);
    const node = workflow?.nodes.find(n => n.id === nodeId);

    // Extract retry configuration
    const retryConfig = extractRetryConfig(node?.config?.retryPolicy);

    await deps.queueManager.nodeQueue.add('process-node', jobData, {
        jobId,
        delay: options.delay,
        attempts: retryConfig.attempts,
        backoff: retryConfig.backoff,
    });
}

/**
 * Check if the workflow has completed (all nodes processed).
 * Uses distributed locking to prevent race conditions.
 */
export async function checkWorkflowCompletion(
    executionId: string,
    workflowId: string,
    job: Job | undefined,
    deps: ChildEnqueueHandlerDeps
): Promise<void> {
    const workflow = await deps.getWorkflowWithLazyLoad(workflowId);
    if (!workflow) return;

    // Check if already failed/cancelled
    const currentExecution = await deps.stateStore.getExecution(executionId);
    if (currentExecution?.status === 'failed' || currentExecution?.status === 'cancelled') {
        return;
    }

    // Use distributed lock to prevent race condition
    const lockKey = `completion:${executionId}`;
    const lockToken = await deps.distributedLock.acquire(lockKey, 5000);

    if (!lockToken) {
        logger.info({ executionId, workflowId }, `⏳ Skipping completion check for ${executionId} - another process is handling it`);
        return;
    }

    try {
        const totalNodes = workflow.nodes.length;
        const pendingCount = await deps.stateStore.getPendingNodeCount(executionId, totalNodes);

        if (pendingCount === 0) {
            await deps.stateStore.setExecutionStatus(executionId, 'completed');
            logger.info({ executionId, workflowId }, `🎉 Workflow ${executionId} completed successfully`);

            // Emit 'completed' workflow event
            if (job) {
                await WorkflowEventEmitter.emitWorkflowStatus(job, {
                    executionId,
                    workflowId,
                    status: 'completed',
                });
            }
        }
    } finally {
        await deps.distributedLock.release(lockKey, lockToken);
    }
}

/**
 * Handle workflow error and update status.
 */
export async function handleWorkflowError(
    executionId: string,
    workflowId: string,
    error: any,
    job: Job | undefined,
    deps: Pick<ChildEnqueueHandlerDeps, 'stateStore'>
): Promise<void> {
    await deps.stateStore.setExecutionStatus(executionId, 'failed');

    // Emit 'failed' workflow event
    if (job) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await WorkflowEventEmitter.emitWorkflowStatus(job, {
            executionId,
            workflowId,
            status: 'failed',
            error: errorMessage,
        });
    }
}
