/**
 * Delay Handler
 * 
 * Handles delay node processing using a 2-phase state machine:
 * 1. Initial phase: Emit events, schedule delayed job
 * 2. Resumed phase: After delay, complete the node and enqueue children
 */

import type { Job } from 'bullmq';
import type { NodeDefinition, ExecutionResult, ExecutionState, DelayNodeConfig } from '../../types';
import type { NodeJobData } from '../types';
import type { IExecutionStateStore } from '../../types';
import { WorkflowEventEmitter } from '../event-emitter';
import { logger } from '../../utils/logger';
import {
    resolveDuration as resolveDelayDuration,
    validateDuration,
} from '../node-utils';

export interface DelayHandlerDeps {
    stateStore: IExecutionStateStore;
    enqueueNode: (
        executionId: string,
        workflowId: string,
        nodeId: string,
        options?: {
            delay?: number;
            delayStep?: 'initial' | 'resumed';
            delayStartTime?: number;
        }
    ) => Promise<void>;
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
}

/**
 * Process a delay node - pauses workflow execution for a configured duration.
 * 
 * Uses BullMQ's delayed queue mechanism to efficiently hold jobs without
 * consuming worker resources during the wait period.
 */
export async function processDelayNode(
    data: NodeJobData,
    job: Job,
    node: NodeDefinition,
    executionState: ExecutionState | null,
    deps: DelayHandlerDeps
): Promise<ExecutionResult> {
    const { executionId, workflowId, nodeId } = data;
    const config = node.config as DelayNodeConfig;

    // Resolve duration from config
    const duration = resolveDelayDuration(config);

    // Validate duration
    const validation = validateDuration(duration);
    if (!validation.valid) {
        const error = validation.error!;
        logger.error({ executionId, nodeId, duration }, `❌ ${error}`);
        await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, error);
        return { success: false, error };
    }

    // Log warning if duration exceeds 24 hours
    if (validation.warning) {
        logger.warn({ executionId, nodeId, duration }, `⚠️ Delay node ${nodeId}: ${validation.warning}`);
    }

    // At this point, validation passed so duration is guaranteed to be a non-null positive number
    const validDuration = duration!;

    // Determine current step
    const currentStep = data.delayStep || 'initial';

    if (currentStep === 'initial') {
        return handleInitialStep(data, job, node, validDuration, deps);
    }

    if (currentStep === 'resumed') {
        return handleResumedStep(data, job, node, deps);
    }

    // Invalid step
    return {
        success: false,
        error: 'Invalid delay node execution step'
    };
}

/**
 * Handle the initial delay step: emit events and schedule delayed job
 */
async function handleInitialStep(
    data: NodeJobData,
    job: Job,
    node: NodeDefinition,
    duration: number,
    deps: DelayHandlerDeps
): Promise<ExecutionResult> {
    const { executionId, workflowId, nodeId } = data;

    logger.info({ executionId, nodeId, duration }, `⏳ Delay node ${nodeId} starting with duration ${duration}ms`);

    // Emit node:started event
    await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);

    // Emit node:delayed event with expected resume time
    const resumeTime = Date.now() + duration;
    await WorkflowEventEmitter.emitNodeDelayed(job, nodeId, workflowId, executionId, resumeTime);

    // Enqueue the resumed job with delay
    await deps.enqueueNode(executionId, workflowId, nodeId, {
        delay: duration,
        delayStep: 'resumed',
        delayStartTime: Date.now(),
    });

    logger.info({ executionId, nodeId, resumeTime }, `💾 Delay node ${nodeId} moved to delayed queue, will resume at ${new Date(resumeTime).toISOString()}`);

    // Return success - this job completes, the delayed job will handle completion
    return {
        success: true,
        data: {
            delayed: true,
            expectedResumeTime: resumeTime,
            duration,
        }
    };
}

/**
 * Handle the resumed delay step: complete the node and enqueue children
 */
async function handleResumedStep(
    data: NodeJobData,
    job: Job,
    node: NodeDefinition,
    deps: DelayHandlerDeps
): Promise<ExecutionResult> {
    const { executionId, workflowId, nodeId } = data;

    logger.info({ executionId, nodeId }, `▶️ Delay node ${nodeId} resuming after delay`);

    // Re-check workflow status before completing
    const currentExecution = await deps.stateStore.getExecution(executionId);
    if (currentExecution?.status === 'cancelled') {
        logger.info({ executionId, nodeId }, `🚫 Workflow ${executionId} was cancelled during delay. Skipping node ${nodeId}.`);
        return { success: false, error: 'Workflow execution cancelled' };
    }

    // Gather input data from parent nodes (same logic as regular nodes)
    let outputData: any = data.inputData;

    if (node.inputs.length > 0) {
        const previousResults = await deps.stateStore.getNodeResults(executionId, node.inputs);

        if (node.inputs.length === 1) {
            // Single parent: Pass data directly
            const parentId = node.inputs[0];
            if (parentId) {
                const parentResult = previousResults[parentId];
                if (parentResult?.success && parentResult.data !== undefined) {
                    outputData = parentResult.data;
                }
            }
        } else {
            // Multiple parents: Merge data into an object keyed by parent node ID
            const mergedData: Record<string, any> = {};
            for (const parentId of node.inputs) {
                const parentResult = previousResults[parentId];
                if (parentResult?.success && parentResult.data !== undefined) {
                    mergedData[parentId] = parentResult.data;
                }
            }
            outputData = mergedData;
        }
    }

    // Save result
    const result: ExecutionResult = {
        success: true,
        data: outputData,
    };
    await deps.stateStore.updateNodeResult(executionId, nodeId, result);

    // Emit node:completed event
    await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, outputData);

    logger.info({ executionId, nodeId }, `✅ Delay node ${nodeId} completed successfully`);

    // Enqueue downstream nodes
    if (node.outputs.length > 0) {
        logger.info({ executionId, nodeId }, `📤 Delay node ${nodeId} completed, checking ${node.outputs.length} children`);
        await deps.checkAndEnqueueChildren(executionId, workflowId, node, undefined, job);
    }

    // Check if workflow is complete
    await deps.checkWorkflowCompletion(executionId, workflowId, job);

    return result;
}
