/**
 * Execution Handler
 * 
 * Handles regular node execution:
 * - Executor lookup and invocation
 * - Execution context building
 * - Error handling with continueOnFail support
 */

import type { Job } from 'bullmq';
import type { DelayedError, RateLimitError } from 'bullmq';
import type {
    NodeDefinition,
    ExecutionResult,
    ExecutionContext,
    ExecutionState
} from '../../types';
import type { NodeJobData } from '../types';
import type { IExecutionStateStore } from '../../types';
import type { NodeRegistry } from '../registry';
import type { QueueManager } from '../queue-manager';
import type { EngineConfig } from '../config';
import { WorkflowEventEmitter } from '../event-emitter';
import { logger } from '../../utils/logger';
import { createContinueOnFailResult } from '../node-utils';

export interface ExecutionHandlerDeps {
    registry: NodeRegistry;
    stateStore: IExecutionStateStore;
    queueManager: QueueManager;
    engineConfig?: EngineConfig;
    checkAndEnqueueChildren: (
        executionId: string,
        workflowId: string,
        node: NodeDefinition,
        nextNodes?: string[],
        job?: Job
    ) => Promise<void>;
    checkWorkflowCompletion: (
        executionId: string,
        workflowId: string,
        job?: Job
    ) => Promise<void>;
    handleWorkflowError: (
        executionId: string,
        workflowId: string,
        error: any,
        job?: Job
    ) => Promise<void>;
}

/**
 * Execute a regular node (not delay, not sub-workflow).
 */
export async function executeRegularNode(
    data: NodeJobData,
    job: Job,
    node: NodeDefinition,
    executionState: ExecutionState | null,
    deps: ExecutionHandlerDeps
): Promise<ExecutionResult> {
    const { executionId, workflowId, nodeId, inputData } = data;
    const logContext = { executionId, workflowId, nodeId, jobId: job.id };

    // Get executor for this node type
    const executor = deps.registry.get(node.type);
    if (!executor) {
        throw new Error(`No executor registered for node type: ${node.type}`);
    }

    // Build input data from parent results
    const previousResults = await deps.stateStore.getNodeResults(executionId, node.inputs);
    const nodeInputData = buildNodeInputData(inputData, node.inputs, previousResults);

    // Build execution context
    const context: ExecutionContext = {
        workflowId,
        executionId,
        nodeId,
        inputData: nodeInputData,
        nodeConfig: node.config,
        previousResults,
        allNodeResults: executionState?.nodeResults,
        parentExecutionId: executionState?.parentExecutionId,
        depth: executionState?.depth || 0,
        rateLimit: deps.engineConfig?.useNativeRateLimiting
            ? async (duration: number) => {
                await deps.queueManager.rateLimit(duration);
                logger.info({ ...logContext, duration }, `🚦 Rate limit requested by node for ${duration}ms`);
                // Return a RateLimitError - caller must throw it
                const { RateLimitError } = await import('bullmq');
                return new RateLimitError();
            }
            : undefined,
    };

    // Execute the node
    logger.info(logContext, `▶️ Executing node ${nodeId} (${node.type})`);
    await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);

    try {
        const result = await executor.execute(context);

        await deps.stateStore.updateNodeResult(executionId, nodeId, result);

        if (!result.success) {
            logger.error({ ...logContext, error: result.error }, `❌ Node ${nodeId} returned failure result: ${result.error}`);
            await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, result.error || 'Node execution failed');
            await deps.handleWorkflowError(executionId, workflowId, new Error(result.error || 'Node execution failed'), job);
            return result;
        }

        // Emit 'completed' event on successful execution
        await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, result.data);

        if (node.outputs.length > 0) {
            logger.info(logContext, `📤 Node ${nodeId} completed successfully, checking ${node.outputs.length} children`);
            await deps.checkAndEnqueueChildren(executionId, workflowId, node, result.nextNodes, job);
        }

        await deps.checkWorkflowCompletion(executionId, workflowId, job);

        return result;
    } catch (error) {
        return handleExecutionError(error, data, job, node, deps);
    }
}

/**
 * Build input data for a node based on parent results.
 */
function buildNodeInputData(
    inputData: any,
    parentIds: string[],
    previousResults: Record<string, ExecutionResult>
): any {
    if (parentIds.length === 0) {
        return inputData;
    }

    if (parentIds.length === 1) {
        const parentId = parentIds[0];
        if (parentId) {
            const parentResult = previousResults[parentId];
            if (parentResult?.success && parentResult.data !== undefined) {
                return parentResult.data;
            }
        }
        return inputData;
    }

    // Multiple parents: merge data into object keyed by parent ID
    const mergedData: Record<string, any> = {};
    for (const parentId of parentIds) {
        const parentResult = previousResults[parentId];
        if (parentResult?.success && parentResult.data !== undefined) {
            mergedData[parentId] = parentResult.data;
        }
    }
    return mergedData;
}

/**
 * Handle execution errors, including continueOnFail logic.
 */
async function handleExecutionError(
    error: unknown,
    data: NodeJobData,
    job: Job,
    node: NodeDefinition,
    deps: ExecutionHandlerDeps
): Promise<ExecutionResult> {
    const { executionId, workflowId, nodeId } = data;
    const logContext = { executionId, workflowId, nodeId, jobId: job.id };
    const errorMessage = error instanceof Error ? error.message : String(error);
    const maxAttempts = job.opts.attempts || 1;
    const currentAttempt = job.attemptsMade;

    // Check if continueOnFail is enabled and we've exhausted retries
    if (node.config.retryPolicy?.continueOnFail && currentAttempt >= maxAttempts) {
        logger.warn({ ...logContext, error: errorMessage }, `⚠️ Node ${nodeId} failed but 'continueOnFail' is enabled. Marking as success.`);

        const safeResult = createContinueOnFailResult(errorMessage);

        await deps.stateStore.updateNodeResult(executionId, nodeId, safeResult);
        await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, safeResult.data);

        if (node.outputs.length > 0) {
            await deps.checkAndEnqueueChildren(executionId, workflowId, node, safeResult.nextNodes, job);
        }

        await deps.checkWorkflowCompletion(executionId, workflowId, job);

        return safeResult;
    }

    logger.error({ ...logContext, error }, `❌ Node ${nodeId} execution failed`);
    await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, errorMessage);

    throw error;
}
