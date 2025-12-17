import { Job, DelayedError, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import { NodeRegistry } from './registry';
import type { IExecutionStateStore, WorkflowDefinition, ExecutionResult, DelayNodeConfig, NodeDefinition, ExecutionState } from '../types';
import type { NodeJobData } from './types';
import { QueueManager } from './queue-manager';
import { DistributedLock } from '../utils/distributed-lock';
import { WorkflowEventEmitter } from './event-emitter';
import { CircuitBreakerRegistry, CircuitBreakerError, type CircuitBreakerOptions } from '../utils/circuit-breaker';
import { logger } from '../utils/logger';

/**
 * Resolves the delay duration from a DelayNodeConfig.
 * 
 * Duration precedence (first found is used):
 * 1. duration (milliseconds) - highest priority
 * 2. durationSeconds (converted to milliseconds)
 * 3. durationMinutes (converted to milliseconds)
 * 
 * @param config - The delay node configuration
 * @returns The resolved duration in milliseconds, or null if no valid duration is configured
 */
export function resolveDuration(config: DelayNodeConfig | undefined): number | null {
    if (!config) {
        return null;
    }

    if (typeof config.duration === 'number') {
        return config.duration;
    }
    if (typeof config.durationSeconds === 'number') {
        return config.durationSeconds * 1000;
    }
    if (typeof config.durationMinutes === 'number') {
        return config.durationMinutes * 60000;
    }
    return null;
}

export type EnqueueWorkflowFn = (
    workflowId: string,
    initialData?: any,
    parentExecutionId?: string,
    depth?: number
) => Promise<string>;

// Cache interface that works with both Map and LRUCache
type WorkflowCache = Map<string, WorkflowDefinition> | LRUCache<string, WorkflowDefinition>;

// Default circuit breaker options
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,        // 1 minute
    monitoringPeriod: 120000  // 2 minutes
};

/**
 * Get circuit breaker options from node configuration or use defaults.
 * Node config can optionally include a `circuitBreaker` object with custom options.
 * Exported for testing.
 */
export function getCircuitBreakerOptions(nodeConfig: any): CircuitBreakerOptions {
    const config = nodeConfig || {};
    const cbConfig = config.circuitBreaker || {};

    return {
        failureThreshold: typeof cbConfig.failureThreshold === 'number'
            ? cbConfig.failureThreshold
            : DEFAULT_CIRCUIT_BREAKER_OPTIONS.failureThreshold,
        successThreshold: typeof cbConfig.successThreshold === 'number'
            ? cbConfig.successThreshold
            : DEFAULT_CIRCUIT_BREAKER_OPTIONS.successThreshold,
        timeout: typeof cbConfig.timeout === 'number'
            ? cbConfig.timeout
            : DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeout,
        monitoringPeriod: typeof cbConfig.monitoringPeriod === 'number'
            ? cbConfig.monitoringPeriod
            : DEFAULT_CIRCUIT_BREAKER_OPTIONS.monitoringPeriod,
    };
}

export class NodeProcessor {
    private distributedLock: DistributedLock;

    constructor(
        private registry: NodeRegistry,
        private stateStore: IExecutionStateStore,
        private redisConnection: Redis,
        private queueManager: QueueManager,
        private workflows: WorkflowCache,
        private enqueueWorkflow: EnqueueWorkflowFn,
        private circuitBreakerRegistry?: CircuitBreakerRegistry
    ) {
        this.distributedLock = new DistributedLock(redisConnection);
    }

    /**
     * Get workflow with lazy loading from database if not in cache
     */
    private async getWorkflowWithLazyLoad(workflowId: string): Promise<WorkflowDefinition | null> {
        // Check cache first
        let workflow = this.workflows.get(workflowId);

        // If not in cache, try to load from database
        if (!workflow) {
            const dbWorkflow = await this.stateStore.getWorkflow(workflowId);
            if (dbWorkflow) {
                // Cache it for future use
                this.workflows.set(workflowId, dbWorkflow);
                workflow = dbWorkflow;
            }
        }

        return workflow || null;
    }

    // Process a single node job
    async processNodeJob(data: NodeJobData, job: Job): Promise<ExecutionResult> {
        const { executionId, workflowId, nodeId, inputData } = data;
        const logContext = { executionId, workflowId, nodeId, jobId: job.id };
        logger.info(logContext, `🔧 Processing node job`);

        // Handle virtual root node (for workflows with multiple entry points)
        if (nodeId === '__root__') {
            return { success: true, data: { message: 'Virtual root node' } };
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
            throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`); // Keep throw for logical correctness
        }

        // Special handling for sub-workflow node type (before regular execution checks)
        if (node.type === 'sub-workflow') {
            // Gather results from upstream nodes
            const execution = await this.stateStore.getExecution(executionId);
            const previousResults = execution?.nodeResults || {};

            const config = node.config as { workflowId: string; inputMapping?: Record<string, string>; outputMapping?: Record<string, string> };

            if (!config.workflowId) {
                return {
                    success: false,
                    error: 'Sub-workflow node missing workflowId in config'
                };
            }

            // Process input data for sub-workflow (same logic as regular nodes)
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

            // Determine execution step based on job data
            const currentStep = data.subWorkflowStep || 'initial';
            const existingChildExecutionId = data.childExecutionId;

            // Execute sub-workflow with step-based approach
            const result = await this.executeSubWorkflow(
                executionId,
                workflowId,
                nodeId,
                job.id!,
                config,
                processedInputData,
                execution?.depth || 0,
                currentStep,
                existingChildExecutionId
            );

            // If checkpoint requested, parent job completes immediately (non-blocking!)
            if (result.checkpoint) {
                // Save checkpoint state with child execution ID
                // The completion hook will detect when child finishes and re-enqueue this node
                await this.stateStore.updateNodeResult(executionId, nodeId, {
                    success: true,
                    data: {
                        checkpointed: true,
                        childExecutionId: result.childExecutionId,
                        subWorkflowStep: 'waiting-children'
                    }
                });

                logger.info({ ...logContext, childExecutionId: result.childExecutionId }, `💾 Checkpoint saved: Node ${nodeId} waiting for child ${result.childExecutionId}`);

                return {
                    success: true,
                    data: {
                        checkpointed: true,
                        childExecutionId: result.childExecutionId
                    }
                };
            }

            // If no checkpoint (or resumed from checkpoint), save and return result
            await this.stateStore.updateNodeResult(executionId, nodeId, result);
            return result;
        }

        // Special handling for delay node type (before regular execution checks)
        if (node.type === 'delay') {
            const executionState = await this.stateStore.getExecution(executionId);
            return this.processDelayNode(data, job, node, executionState);
        }

        // Regular node execution
        const executor = this.registry.get(node.type);

        if (!executor) {
            throw new Error(`No executor registered for node type: ${node.type}`);
        }

        // --- IDEMPOTENCY & STATE FETCH ---
        // Optimization: Use getNodeResults for a lightweight idempotency check.
        const existingResults = await this.stateStore.getNodeResults(executionId, [nodeId]);
        const existingResult = existingResults[nodeId];
        if (existingResult && (existingResult.success || existingResult.skipped)) {
            logger.info(logContext, `- Idempotency check: Node ${nodeId} already processed with status: ${existingResult.skipped ? 'skipped' : 'success'}. Skipping.`);
            return existingResult;
        }

        // Fetch execution status separately.
        const executionState = await this.stateStore.getExecution(executionId); // Keep for status check
        const parentNodeIds = node.inputs;
        const previousResults = await this.stateStore.getNodeResults(executionId, parentNodeIds);

        // Check execution status before running
        if (executionState?.status === 'cancelled') {
            logger.info(logContext, `🚫 Execution ${executionId} is cancelled. Skipping node ${nodeId}.`);
            return { success: false, error: 'Workflow execution cancelled' };
        }

        if (executionState?.status === 'paused') {
            logger.info(logContext, `⏸️ Execution ${executionId} is paused. Moving to delayed queue.`);
            await job.moveToDelayed(Date.now() + 5000, job.token); // Retry in 5 seconds
            throw new DelayedError();
        }

        // --- Rate Limiting Check ---
        const rateLimit = this.registry.getRateLimit(node.type);
        if (rateLimit) {
            const key = `rate-limit:${node.type}:${Math.floor(Date.now() / 1000)}`;
            const current = await this.redisConnection.incr(key);
            if (current === 1) {
                await this.redisConnection.expire(key, 2); // Expire after 2 seconds to be safe
            }

            if (current > rateLimit) {
                logger.info(logContext, `⏳ Rate limit exceeded for ${node.type}. Re-queueing.`);
                await job.moveToDelayed(Date.now() + 1000, job.token);
                throw new DelayedError();
            }
        }

        // --- Concurrency Check ---
        const maxConcurrency = workflow.maxConcurrency;
        if (maxConcurrency) {
            const activeKey = `workflow:active:${executionId}`;
            // Implementation of workflow-level concurrency would go here if needed
            // For now, we rely on queue concurrency
        }

        // --- Data Passing Logic ---
        let nodeInputData: any = inputData;

        if (node.inputs.length > 0) {
            // If we have inputs, we need to gather data from parent nodes
            if (node.inputs.length === 1) {
                // Single parent: Pass data directly
                const parentId = node.inputs[0];
                if (parentId) {
                    const parentResult = previousResults[parentId];
                    if (parentResult?.success && parentResult.data !== undefined) {
                        nodeInputData = parentResult.data;
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
                nodeInputData = mergedData;
            }
        }

        const context: any = {
            workflowId,
            executionId,
            nodeId,
            inputData: nodeInputData,
            nodeConfig: node.config,
            previousResults,
            parentExecutionId: executionState?.parentExecutionId,
            depth: executionState?.depth || 0,
        };

        // Execute the node
        logger.info(logContext, `▶️ Executing node ${nodeId} (${node.type})`);

        // Emit 'running' event at start of node execution
        await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);

        try {
            let result: ExecutionResult;

            // Wrap external node execution with circuit breaker if registry is available
            const cbKey = this.circuitBreakerRegistry ? this.registry.getCircuitBreakerKey(node.type, node.config) : null;
            if (this.circuitBreakerRegistry && cbKey) {
                const cbOptions = getCircuitBreakerOptions(node.config);
                const breaker = this.circuitBreakerRegistry.getOrCreate(cbKey, cbOptions);

                // Log circuit breaker usage (debug level)
                const cbStats = breaker.getStats();
                logger.debug(logContext, `🔌 [CircuitBreaker] Wrapping ${node.type} node (${nodeId}) with circuit breaker: ${cbKey}, state: ${cbStats.state}, failures: ${cbStats.failureCount}`);

                result = await breaker.execute(() => executor.execute(context));

                // Log successful execution through circuit breaker
                const postStats = breaker.getStats();
                if (postStats.state === 'CLOSED' && cbStats.state !== 'CLOSED') {
                    logger.info(logContext, `🔌 [CircuitBreaker] '${cbKey}' closed after recovery - node ${nodeId} execution succeeded`);
                }
            } else {
                result = await executor.execute(context);
            }

            // Save result
            await this.stateStore.updateNodeResult(executionId, nodeId, result);

            // Handle node failure - fail the entire workflow
            if (!result.success) {
                logger.error({ ...logContext, error: result.error }, `❌ Node ${nodeId} returned failure result: ${result.error}`);
                await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, result.error || 'Node execution failed');
                await this.handleWorkflowError(executionId, workflowId, new Error(result.error || 'Node execution failed'), job);
                return result;
            }

            // Emit 'completed' event on successful execution
            await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, result.data);

            // If this node succeeded, check and enqueue/skip its children
            if (node.outputs.length > 0) {
                logger.info(logContext, `📤 Node ${nodeId} completed successfully, checking ${node.outputs.length} children`);
                await this.checkAndEnqueueChildren(executionId, workflowId, node, result.nextNodes, job);
            }

            // Check if workflow is complete
            await this.checkWorkflowCompletion(executionId, workflowId, job);

            return result;
        } catch (error) {
            logger.error({ ...logContext, error }, `❌ Node ${nodeId} execution failed`);

            // Emit 'failed' event on execution failure
            const errorMessage = error instanceof Error ? error.message : String(error);
            await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, errorMessage);

            // Handle CircuitBreakerError specially - don't retry when circuit is open
            if (error instanceof CircuitBreakerError) {
                // Log when circuit is open and preventing execution
                const cbKey = this.registry.getCircuitBreakerKey(node.type, node.config);
                const breaker = cbKey ? this.circuitBreakerRegistry?.get(cbKey) : null;
                const nextRetryTime = breaker?.getStats().nextAttempt || 'unknown';
                logger.info(logContext, `🔌 [CircuitBreaker] '${cbKey}' is OPEN - prevented execution for node ${nodeId}. Next retry: ${nextRetryTime}`);
                // Throw UnrecoverableError to prevent BullMQ retries - the circuit is open
                throw new UnrecoverableError(`Circuit breaker open: ${errorMessage}`);
            }

            throw error; // Let BullMQ handle retries for other errors
        }
    }

    private async checkAndEnqueueChildren(executionId: string, workflowId: string, node: any, nextNodes?: string[], job?: Job): Promise<void> {
        const workflow = await this.getWorkflowWithLazyLoad(workflowId);
        if (!workflow) return;

        for (const childNodeId of node.outputs) {
            // Check if this child should be skipped based on conditional branching
            // If nextNodes is provided, only those nodes should run. Others are skipped.
            const shouldRun = !nextNodes || nextNodes.includes(childNodeId);

            if (!shouldRun) {
                logger.info({ executionId, workflowId, childNodeId }, `🚫 Node ${childNodeId} excluded by conditional branching. Marking as skipped.`);
                await this.skipNode(executionId, workflowId, childNodeId, job);
                continue;
            }

            const childNode = workflow.nodes.find(n => n.id === childNodeId);
            if (!childNode) continue;

            // Check if all parents of this child have completed
            const parentIds = childNode.inputs;
            const parentResults = await this.stateStore.getNodeResults(executionId, parentIds);

            const allParentsCompleted = parentIds.every(pid => {
                const res = parentResults[pid];
                return res && (res.success || res.skipped);
            });

            if (allParentsCompleted) {
                logger.info({ executionId, workflowId, childNodeId }, `✅ All parents of ${childNodeId} resolved, enqueueing`);
                await this.enqueueNode(executionId, workflowId, childNodeId);
            } else {
                logger.info({ executionId, workflowId, childNodeId }, `⏳ Child node ${childNodeId} waiting for other parents`);
            }
        }
    }

    private async skipNode(executionId: string, workflowId: string, nodeId: string, job?: Job): Promise<void> {
        // Mark as skipped in state store
        await this.stateStore.updateNodeResult(executionId, nodeId, {
            success: true,
            skipped: true,
            data: null
        });

        // Emit 'skipped' event if job is available
        if (job) {
            await WorkflowEventEmitter.emitNodeSkipped(job, nodeId, workflowId, executionId);
        }

        // Propagate skip to children - use async lazy loading instead of sync cache access
        const workflow = await this.getWorkflowWithLazyLoad(workflowId);
        const node = workflow?.nodes.find(n => n.id === nodeId);
        if (node) {
            // Recursively check children. 
            // We pass undefined for nextNodes because a skipped node doesn't choose paths, 
            // but its children might still run if they are merges.
            await this.checkAndEnqueueChildren(executionId, workflowId, node, undefined, job);
        }
    }

    private async enqueueNode(
        executionId: string,
        workflowId: string,
        nodeId: string,
        options: {
            delay?: number;
            subWorkflowStep?: 'initial' | 'waiting-children' | 'complete';
            childExecutionId?: string;
            delayStep?: 'initial' | 'resumed';
            delayStartTime?: number;
        } = {}
    ): Promise<void> {
        const jobData: NodeJobData = {
            executionId,
            workflowId,
            nodeId,
            inputData: {}, // Input data is fetched during execution now
            subWorkflowStep: options.subWorkflowStep,
            childExecutionId: options.childExecutionId,
            delayStep: options.delayStep,
            delayStartTime: options.delayStartTime,
        };

        // Use deterministic job IDs to prevent duplicate job creation (idempotency)
        // - For sub-workflow resume jobs: include childExecutionId for uniqueness
        // - For delay node resume jobs: include delayStep for uniqueness
        // - For regular child nodes: use format `${executionId}-node-${nodeId}` (no timestamp)
        // BullMQ will reject duplicate job IDs automatically, preventing race conditions
        let jobId: string;
        if (options.subWorkflowStep) {
            jobId = `${executionId}-node-${nodeId}-resume-${options.childExecutionId}`;
        } else if (options.delayStep === 'resumed') {
            jobId = `${executionId}-node-${nodeId}-delay-resumed`;
        } else {
            jobId = `${executionId}-node-${nodeId}`;
        }

        await this.queueManager.nodeQueue.add('process-node', jobData, {
            jobId,
            delay: options.delay,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        });
    }

    private async checkWorkflowCompletion(executionId: string, workflowId: string, job?: Job): Promise<void> {
        const workflow = await this.getWorkflowWithLazyLoad(workflowId);
        if (!workflow) return;

        // Check if already failed/cancelled
        const currentExecution = await this.stateStore.getExecution(executionId);
        if (currentExecution?.status === 'failed' || currentExecution?.status === 'cancelled') {
            return;
        }

        // Use distributed lock to prevent race condition when multiple nodes complete simultaneously
        const lockKey = `completion:${executionId}`;
        const lockToken = await this.distributedLock.acquire(lockKey, 5000);

        if (!lockToken) {
            // Another process is checking completion, skip
            logger.info({ executionId, workflowId }, `⏳ Skipping completion check for ${executionId} - another process is handling it`);
            return;
        }

        try {
            const totalNodes = workflow.nodes.length;
            const pendingCount = await this.stateStore.getPendingNodeCount(executionId, totalNodes);

            if (pendingCount === 0) {
                await this.stateStore.setExecutionStatus(executionId, 'completed');
                logger.info({ executionId, workflowId }, `🎉 Workflow ${executionId} completed successfully`);

                // Emit 'completed' workflow event
                if (job) {
                    await WorkflowEventEmitter.emitWorkflowStatus(job, {
                        executionId,
                        workflowId,
                        status: 'completed',
                    });
                }

                await this.notifyParentWorkflow(executionId, 'completed');
            }
        } finally {
            await this.distributedLock.release(lockKey, lockToken);
        }
    }

    async handleWorkflowError(executionId: string, workflowId: string, error: any, job?: Job): Promise<void> {
        await this.stateStore.setExecutionStatus(executionId, 'failed');

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

        await this.notifyParentWorkflow(executionId, 'failed');
    }

    private async notifyParentWorkflow(executionId: string, status: 'completed' | 'failed'): Promise<void> {
        const execution = await this.stateStore.getExecution(executionId);
        if (!execution || !execution.parentExecutionId) return;

        // We need parentNodeId. It should be in metadata.
        const metadata = execution.metadata || {};
        const { parentExecutionId, parentNodeId, parentWorkflowId } = metadata;

        if (parentExecutionId && parentNodeId) {
            logger.info({ executionId, parentExecutionId, parentNodeId, status }, `🔔 Notifying parent workflow ${parentExecutionId} (node ${parentNodeId}) of child ${executionId} ${status}`);
            // Pass sub-workflow state for resumption
            await this.enqueueNode(parentExecutionId, parentWorkflowId || 'unknown', parentNodeId, {
                subWorkflowStep: 'complete',
                childExecutionId: executionId
            });
        }
    }

    /**
     * Process a delay node - pauses workflow execution for a configured duration.
     * 
     * Uses BullMQ's delayed queue mechanism to efficiently hold jobs without
     * consuming worker resources during the wait period.
     * 
     * @param data - The node job data
     * @param job - The BullMQ job instance
     * @param node - The node definition
     * @param executionState - Current execution state (may be null)
     * @returns ExecutionResult with success/failure status
     */
    private async processDelayNode(
        data: NodeJobData,
        job: Job,
        node: NodeDefinition,
        executionState: ExecutionState | null
    ): Promise<ExecutionResult> {
        const { executionId, workflowId, nodeId } = data;
        const config = node.config as DelayNodeConfig;

        // Resolve duration from config
        const duration = resolveDuration(config);

        // Validation: Check for missing duration configuration
        if (duration === null) {
            const error = 'Delay node missing duration configuration';
            logger.error({ executionId, nodeId }, `❌ ${error}`);
            await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, error);
            return { success: false, error };
        }

        // Validation: Check for negative duration
        if (duration < 0) {
            const error = 'Delay duration must be positive';
            logger.error({ executionId, nodeId, duration }, `❌ ${error}`);
            await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, error);
            return { success: false, error };
        }

        // Warning: Log if duration exceeds 24 hours
        const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
        if (duration > TWENTY_FOUR_HOURS_MS) {
            logger.warn({ executionId, nodeId, duration }, `⚠️ Delay node ${nodeId} has duration exceeding 24 hours: ${duration}ms`);
        }

        // Determine current step
        const currentStep = data.delayStep || 'initial';

        if (currentStep === 'initial') {
            // Initial processing: emit started event and move to delayed queue
            logger.info({ executionId, nodeId, duration }, `⏳ Delay node ${nodeId} starting with duration ${duration}ms`);

            // Emit node:started event
            await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);

            // Emit node:delayed event with expected resume time
            const resumeTime = Date.now() + duration;
            await WorkflowEventEmitter.emitNodeDelayed(job, nodeId, workflowId, executionId, resumeTime);

            // Enqueue the resumed job with delay
            await this.enqueueNode(executionId, workflowId, nodeId, {
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

        // Resumed step: delay has expired, complete the node
        if (currentStep === 'resumed') {
            logger.info({ executionId, nodeId }, `▶️ Delay node ${nodeId} resuming after delay`);

            // Re-check workflow status before completing
            const currentExecution = await this.stateStore.getExecution(executionId);
            if (currentExecution?.status === 'cancelled') {
                logger.info({ executionId, nodeId }, `🚫 Workflow ${executionId} was cancelled during delay. Skipping node ${nodeId}.`);
                return { success: false, error: 'Workflow execution cancelled' };
            }

            // Gather input data from parent nodes (same logic as regular nodes)
            let outputData: any = data.inputData;

            if (node.inputs.length > 0) {
                const previousResults = await this.stateStore.getNodeResults(executionId, node.inputs);

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
            await this.stateStore.updateNodeResult(executionId, nodeId, result);

            // Emit node:completed event
            await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, outputData);

            logger.info({ executionId, nodeId }, `✅ Delay node ${nodeId} completed successfully`);

            // Enqueue downstream nodes
            if (node.outputs.length > 0) {
                logger.info({ executionId, nodeId }, `📤 Delay node ${nodeId} completed, checking ${node.outputs.length} children`);
                await this.checkAndEnqueueChildren(executionId, workflowId, node, undefined, job);
            }

            // Check if workflow is complete
            await this.checkWorkflowCompletion(executionId, workflowId, job);

            return result;
        }

        // Invalid step
        return {
            success: false,
            error: 'Invalid delay node execution step'
        };
    }

    // Execute a sub-workflow using Checkpoint & Resume pattern (fully non-blocking)
    private async executeSubWorkflow(
        parentExecutionId: string,
        parentWorkflowId: string,
        parentNodeId: string,
        parentJobId: string,
        config: { workflowId: string; inputMapping?: Record<string, string>; outputMapping?: Record<string, string> },
        inputData: any,
        depth: number,
        step: 'initial' | 'waiting-children' | 'complete',
        childExecutionId?: string
    ): Promise<ExecutionResult & { checkpoint?: boolean; childExecutionId?: string }> {
        const { workflowId, inputMapping, outputMapping } = config;

        // Validate sub-workflow exists - use lazy loading from database before returning not-found error
        const subWorkflow = await this.getWorkflowWithLazyLoad(workflowId);
        if (!subWorkflow) {
            return {
                success: false,
                error: `Sub-workflow '${workflowId}' not found`
            };
        }

        try {
            // Step 1: Initial - start child and checkpoint immediately (NO WAITING)
            if (step === 'initial') {
                // Apply input mapping
                let mappedInput = inputData;
                if (inputMapping && typeof inputData === 'object' && inputData !== null) {
                    mappedInput = {};
                    for (const [targetKey, sourceKey] of Object.entries(inputMapping)) {
                        if (sourceKey in inputData) {
                            mappedInput[targetKey] = inputData[sourceKey];
                        }
                    }
                }

                logger.info({ parentExecutionId, depth: depth + 1, workflowId }, `🔀 Sub-workflow ${workflowId} starting`);

                // Start child workflow (normal enqueue, no parent reference needed)
                const newChildExecutionId = await this.enqueueWorkflow(
                    workflowId,
                    mappedInput,
                    parentExecutionId,
                    depth + 1
                );

                // CRITICAL: Store parent node info in execution metadata for resume callback
                // This will be used by the completion hook to re-enqueue the parent node
                const metadata = {
                    parentNodeId,
                    parentWorkflowId
                };
                await this.stateStore.updateExecutionMetadata(newChildExecutionId, metadata);

                logger.info({ workflowId, newChildExecutionId }, `✅ Sub-workflow checkpoint: ${workflowId} started, parent node will resume when child completes`);

                // Return with checkpoint flag - parent job will complete and free the worker!
                return {
                    success: true,
                    checkpoint: true,
                    childExecutionId: newChildExecutionId,
                    data: { childExecutionId: newChildExecutionId }
                };
            }

            // Step 2: Resume/Complete - child finished, aggregate results
            if (step === 'complete' && childExecutionId) {
                const childExecution = await this.stateStore.getExecution(childExecutionId);

                if (!childExecution) {
                    return {
                        success: false,
                        error: `Sub-workflow execution ${childExecutionId} not found`
                    };
                }

                if (childExecution.status === 'completed') {
                    // Aggregate results from final nodes - use the already loaded subWorkflow
                    const finalNodes = subWorkflow.nodes.filter(node => node.outputs.length === 0);

                    let aggregatedResult: any = {};

                    if (finalNodes.length === 1 && finalNodes[0]) {
                        const finalNodeId = finalNodes[0].id;
                        const result = childExecution.nodeResults[finalNodeId];
                        aggregatedResult = result?.data;
                    } else if (finalNodes.length > 1) {
                        for (const node of finalNodes) {
                            const result = childExecution.nodeResults[node.id];
                            if (result?.success && result.data !== undefined) {
                                aggregatedResult[node.id] = result.data;
                            }
                        }
                    }

                    // Apply output mapping
                    let mappedOutput = aggregatedResult;
                    if (outputMapping && typeof aggregatedResult === 'object' && aggregatedResult !== null) {
                        mappedOutput = {};
                        for (const [targetKey, sourceKey] of Object.entries(outputMapping)) {
                            if (sourceKey in aggregatedResult) {
                                mappedOutput[targetKey] = aggregatedResult[sourceKey];
                            }
                        }
                    }

                    console.log(`✅ Sub-workflow ${workflowId} completed (execution: ${childExecutionId})`);
                    return {
                        success: true,
                        data: mappedOutput
                    };
                }

                if (childExecution.status === 'failed') {
                    console.error(`❌ Sub-workflow ${workflowId} failed (execution: ${childExecutionId})`);
                    return {
                        success: false,
                        error: `Sub-workflow '${workflowId}' failed`,
                        data: childExecution.nodeResults
                    };
                }

                if (childExecution.status === 'cancelled') {
                    console.log(`🚫 Sub-workflow ${workflowId} cancelled (execution: ${childExecutionId})`);
                    return {
                        success: false,
                        error: `Sub-workflow '${workflowId}' was cancelled`
                    };
                }

                // Child still running - this shouldn't happen in checkpoint-resume
                // but if it does, just return success and it will be retried
                console.log(`⏳ Sub-workflow ${workflowId} still running, will check again`);
                return {
                    success: true,
                    checkpoint: true,
                    childExecutionId,
                    data: { status: 'waiting' }
                };
            }

            return {
                success: false,
                error: 'Invalid sub-workflow execution step'
            };

        } catch (error) {
            console.error(`❌ Sub-workflow ${workflowId} error:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}
