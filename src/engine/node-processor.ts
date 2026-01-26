/**
 * Node Processor
 * 
 * Thin orchestrator that delegates to focused handler modules.
 * Routes node processing to the appropriate handler based on node type.
 */

import { Job, DelayedError } from 'bullmq';
import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import { NodeRegistry } from './registry';
import type { IExecutionStateStore, WorkflowDefinition, ExecutionResult, SubWorkflowConfig, NodeDefinition } from '../types';
import type { NodeJobData } from './types';
import { QueueManager } from './queue-manager';
import { DistributedLock } from '../utils/distributed-lock';
import { WorkflowEventEmitter } from './event-emitter';
import { logger } from '../utils/logger';
import type { EngineConfig } from './config';

// Import handlers
import { processDelayNode } from './handlers/delay-handler';
import {
    processAggregatorNode,
    executeSubWorkflowWithFlow
} from './handlers/subworkflow-handler';
import {
    checkAndEnqueueChildren as childEnqueueCheckAndEnqueue,
    skipNode as childEnqueueSkipNode,
    enqueueNode as childEnqueueEnqueueNode,
    checkWorkflowCompletion as childEnqueueCheckWorkflowCompletion,
    handleWorkflowError as childEnqueueHandleWorkflowError,
} from './handlers/child-enqueue-handler';
import { executeRegularNode } from './handlers/execution-handler';

// Import node utilities for backward compatibility export
import { resolveDuration as resolveDelayDuration } from './node-utils';

// Re-export utilities for backward compatibility
export { resolveDelayDuration as resolveDuration };

export type EnqueueWorkflowFn = (
    workflowId: string,
    initialData?: any,
    parentExecutionId?: string,
    depth?: number
) => Promise<string>;

// Cache interface that works with both Map and LRUCache
type WorkflowCache = Map<string, WorkflowDefinition> | LRUCache<string, WorkflowDefinition>;

/**
 * NodeProcessor - Orchestrates node execution by delegating to specialized handlers.
 * 
 * This class is now a thin coordinator that:
 * 1. Routes jobs to the correct handler based on node type
 * 2. Manages shared dependencies (state store, queue manager, etc.)
 * 3. Provides workflow lookup with lazy loading
 */
export class NodeProcessor {
    private distributedLock: DistributedLock;

    constructor(
        private registry: NodeRegistry,
        private stateStore: IExecutionStateStore,
        private redisConnection: Redis,
        private queueManager: QueueManager,
        private workflows: WorkflowCache,
        private enqueueWorkflow: EnqueueWorkflowFn,
        private engineConfig?: EngineConfig
    ) {
        this.distributedLock = new DistributedLock(redisConnection);
    }

    /**
     * Get workflow with lazy loading from database if not in cache
     */
    private async getWorkflowWithLazyLoad(workflowId: string): Promise<WorkflowDefinition | null> {
        let workflow = this.workflows.get(workflowId);

        if (!workflow) {
            const dbWorkflow = await this.stateStore.getWorkflow(workflowId);
            if (dbWorkflow) {
                this.workflows.set(workflowId, dbWorkflow);
                workflow = dbWorkflow;
            }
        }

        return workflow || null;
    }

    /**
     * Process a single node job - main entry point.
     * Routes to the appropriate handler based on node type.
     */
    async processNodeJob(data: NodeJobData, job: Job): Promise<ExecutionResult> {
        const { executionId, workflowId, nodeId, inputData } = data;
        const logContext = { executionId, workflowId, nodeId, jobId: job.id };
        logger.info(logContext, `🔧 Processing node job`);

        // Handle virtual root node (for workflows with multiple entry points)
        if (nodeId === '__root__') {
            return { success: true, data: { message: 'Virtual root node' } };
        }

        // Handle sub-workflow aggregator node (FlowProducer pattern)
        if (nodeId === '__aggregator__' && (data as any).isSubWorkflowAggregator) {
            return processAggregatorNode(data, job, {
                stateStore: this.stateStore,
                queueManager: this.queueManager,
                getWorkflowWithLazyLoad: this.getWorkflowWithLazyLoad.bind(this),
                enqueueNode: this.enqueueNode.bind(this),
            });
        }

        // Lazy load workflow from database if not in cache
        const workflow = await this.getWorkflowWithLazyLoad(workflowId);

        if (!workflow) {
            logger.error({ ...logContext, availableWorkflows: Array.from(this.workflows.keys()) }, `❌ Workflow ${workflowId} not found in NodeProcessor.`);
            throw new Error(`Workflow ${workflowId} not found`);
        }

        const node = workflow.nodes.find(n => n.id === nodeId);

        if (!node) {
            logger.error(logContext, `❌ Node ${nodeId} not found in workflow ${workflowId}`);
            throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`);
        }

        // Route to appropriate handler based on node type
        return this.routeNodeExecution(data, job, node, workflow);
    }

    /**
     * Route node execution to the appropriate handler.
     */
    private async routeNodeExecution(
        data: NodeJobData,
        job: Job,
        node: NodeDefinition,
        workflow: WorkflowDefinition
    ): Promise<ExecutionResult> {
        const { executionId, workflowId, nodeId } = data;

        // --- IDEMPOTENCY CHECK ---
        const existingResults = await this.stateStore.getNodeResults(executionId, [nodeId]);
        const existingResult = existingResults[nodeId];
        if (existingResult && (existingResult.success || existingResult.skipped)) {
            logger.info({ executionId, workflowId, nodeId }, `- Idempotency check: Node ${nodeId} already processed. Skipping.`);
            return existingResult;
        }

        // --- EXECUTION STATE ---
        const executionState = await this.stateStore.getExecution(executionId);

        if (executionState?.status === 'cancelled') {
            logger.info({ executionId, nodeId }, `🚫 Execution ${executionId} is cancelled. Skipping node ${nodeId}.`);
            return { success: false, error: 'Workflow execution cancelled' };
        }

        if (executionState?.status === 'paused') {
            logger.info({ executionId, nodeId }, `⏸️ Execution ${executionId} is paused. Moving to delayed queue.`);
            await job.moveToDelayed(Date.now() + 5000, job.token);
            throw new DelayedError();
        }

        // --- SUB-WORKFLOW NODE ---
        if (node.type === 'sub-workflow') {
            return this.processSubWorkflowNode(data, job, node, executionState);
        }

        // --- DELAY NODE ---
        if (node.type === 'delay') {
            return processDelayNode(data, job, node, executionState, {
                stateStore: this.stateStore,
                enqueueNode: this.enqueueNode.bind(this),
                checkAndEnqueueChildren: this.checkAndEnqueueChildren.bind(this),
                checkWorkflowCompletion: this.checkWorkflowCompletion.bind(this),
            });
        }

        // --- REGULAR NODE ---
        return executeRegularNode(data, job, node, executionState, {
            registry: this.registry,
            stateStore: this.stateStore,
            queueManager: this.queueManager,
            engineConfig: this.engineConfig,
            checkAndEnqueueChildren: this.checkAndEnqueueChildren.bind(this),
            checkWorkflowCompletion: this.checkWorkflowCompletion.bind(this),
            handleWorkflowError: this.handleWorkflowError.bind(this),
        });
    }

    /**
     * Process a sub-workflow node.
     */
    private async processSubWorkflowNode(
        data: NodeJobData,
        job: Job,
        node: NodeDefinition,
        executionState: any
    ): Promise<ExecutionResult> {
        const { executionId, workflowId, nodeId, inputData } = data;
        const previousResults = executionState?.nodeResults || {};
        const config = node.config as SubWorkflowConfig;

        if (!config.workflowId) {
            return {
                success: false,
                error: 'Sub-workflow node missing workflowId in config'
            };
        }

        // Process input data for sub-workflow
        let processedInputData: any = inputData;

        if (node.inputs.length === 1) {
            const parentId = node.inputs[0];
            if (parentId) {
                const parentResult = previousResults[parentId];
                if (parentResult?.success && parentResult.data !== undefined) {
                    processedInputData = parentResult.data;
                } else {
                    processedInputData = undefined;
                }
            }
        } else if (node.inputs.length > 1) {
            const mergedData: Record<string, any> = {};
            for (const parentId of node.inputs) {
                const parentResult = previousResults[parentId];
                if (parentResult?.success && parentResult.data !== undefined) {
                    mergedData[parentId] = parentResult.data;
                }
            }
            processedInputData = mergedData;
        }

        logger.info({ executionId, nodeId }, `🔀 Executing sub-workflow ${config.workflowId} via FlowProducer`);
        await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);

        const result = await executeSubWorkflowWithFlow(
            executionId,
            nodeId,
            config,
            processedInputData,
            executionState?.depth || 0,
            job,
            {
                stateStore: this.stateStore,
                queueManager: this.queueManager,
                getWorkflowWithLazyLoad: this.getWorkflowWithLazyLoad.bind(this),
                enqueueNode: this.enqueueNode.bind(this),
            }
        );

        await this.stateStore.updateNodeResult(executionId, nodeId, result);

        if (result.success) {
            await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, result.data);
        } else {
            await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, result.error || 'Sub-workflow failed');
        }

        return result;
    }

    // ========================================================================
    // DELEGATED METHODS - These wrap handler functions with bound dependencies
    // ========================================================================

    private async checkAndEnqueueChildren(
        executionId: string,
        workflowId: string,
        node: NodeDefinition,
        nextNodes?: string[],
        job?: Job
    ): Promise<void> {
        return childEnqueueCheckAndEnqueue(executionId, workflowId, node, nextNodes, job, {
            stateStore: this.stateStore,
            queueManager: this.queueManager,
            distributedLock: this.distributedLock,
            getWorkflowWithLazyLoad: this.getWorkflowWithLazyLoad.bind(this),
        });
    }

    private async enqueueNode(
        executionId: string,
        workflowId: string,
        nodeId: string,
        options: {
            delay?: number;
            delayStep?: 'initial' | 'resumed';
            delayStartTime?: number;
        } = {}
    ): Promise<void> {
        return childEnqueueEnqueueNode(executionId, workflowId, nodeId, options, {
            stateStore: this.stateStore,
            queueManager: this.queueManager,
            distributedLock: this.distributedLock,
            getWorkflowWithLazyLoad: this.getWorkflowWithLazyLoad.bind(this),
        });
    }

    private async checkWorkflowCompletion(
        executionId: string,
        workflowId: string,
        job?: Job
    ): Promise<void> {
        return childEnqueueCheckWorkflowCompletion(executionId, workflowId, job, {
            stateStore: this.stateStore,
            queueManager: this.queueManager,
            distributedLock: this.distributedLock,
            getWorkflowWithLazyLoad: this.getWorkflowWithLazyLoad.bind(this),
        });
    }

    async handleWorkflowError(
        executionId: string,
        workflowId: string,
        error: any,
        job?: Job
    ): Promise<void> {
        return childEnqueueHandleWorkflowError(executionId, workflowId, error, job, {
            stateStore: this.stateStore,
        });
    }
}
