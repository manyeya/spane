import { Job, DelayedError, UnrecoverableError, RateLimitError } from 'bullmq';
import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import { NodeRegistry } from './registry';
import type { IExecutionStateStore, WorkflowDefinition, ExecutionResult, DelayNodeConfig, NodeDefinition, ExecutionState, SubWorkflowConfig } from '../types';
import type { NodeJobData } from './types';
import { QueueManager } from './queue-manager';
import { DistributedLock } from '../utils/distributed-lock';
import { WorkflowEventEmitter } from './event-emitter';
import { CircuitBreakerRegistry, CircuitBreakerError } from '../utils/circuit-breaker';
import { logger } from '../utils/logger';
import type { PayloadManager } from './payload-manager';
import type { EngineConfig } from './config';

// Import stateless utilities that can run in both main thread and sandbox
import {
    resolveDuration as resolveDelayDuration,
    validateDuration,
    mergeParentInputs,
    applyInputMapping,
    applyOutputMapping,
    aggregateChildResults,
    createContinueOnFailResult,
    isNodeAlreadyProcessed,
    generateNodeJobId,
    extractRetryConfig,
    getCircuitBreakerOptions as getCircuitBreakerOptionsFromConfig,
    DEFAULT_CIRCUIT_BREAKER_OPTIONS as DEFAULT_CB_OPTIONS,
} from './processors/stateless-utils';

// Re-export stateless utilities for backward compatibility
// These are now implemented in ./processors/stateless-utils.ts
export { resolveDelayDuration as resolveDuration };
export { getCircuitBreakerOptionsFromConfig as getCircuitBreakerOptions };
export { DEFAULT_CB_OPTIONS as DEFAULT_CIRCUIT_BREAKER_OPTIONS };

/**
 * Configuration for sandboxed processor dependencies.
 * These values are loaded from environment variables in worker threads.
 */
export interface SandboxedProcessorConfig {
    /** Redis connection URL (e.g., redis://localhost:6379) */
    redisUrl: string;
    /** Database connection URL for DrizzleStore (optional, uses InMemoryStore if not provided) */
    databaseUrl?: string;
    /** Engine configuration options */
    engineConfig?: EngineConfig;
}

/**
 * Factory function to create dependencies for sandboxed processor execution.
 * 
 * This function creates all the necessary dependencies for a NodeProcessor
 * to run in a BullMQ worker thread. It handles:
 * - Loading configuration from environment variables
 * - Creating Redis connection for the worker thread
 * - Initializing state store (DrizzleStore or InMemoryStore)
 * - Creating NodeRegistry with default executors
 * - Creating QueueManager for job operations
 * - Creating CircuitBreakerRegistry for external node protection
 * 
 * The dependencies are returned as an object that can be used to create
 * a NodeProcessor instance.
 * 
 * @returns Promise containing all dependencies needed for NodeProcessor
 * @throws Error if required environment variables are missing
 */
export async function createSandboxedProcessorDependencies(): Promise<{
    registry: NodeRegistry;
    stateStore: IExecutionStateStore;
    redisConnection: Redis;
    queueManager: QueueManager;
    workflowCache: Map<string, WorkflowDefinition>;
    enqueueWorkflow: EnqueueWorkflowFn;
    circuitBreakerRegistry: CircuitBreakerRegistry;
    engineConfig: EngineConfig;
}> {
    // Load configuration from environment variables
    // Worker threads cannot share memory with the main thread, so we use env vars
    const redisUrl = process.env.SPANE_REDIS_URL || process.env.REDIS_URL;
    if (!redisUrl) {
        throw new Error(
            'Sandboxed processor requires SPANE_REDIS_URL or REDIS_URL environment variable. ' +
            'Set this to your Redis connection URL (e.g., redis://localhost:6379).'
        );
    }

    const databaseUrl = process.env.SPANE_DATABASE_URL || process.env.DATABASE_URL;

    // Parse engine config from environment (JSON string)
    let engineConfig: EngineConfig = {};
    const engineConfigJson = process.env.SPANE_ENGINE_CONFIG;
    if (engineConfigJson) {
        try {
            engineConfig = JSON.parse(engineConfigJson);
        } catch (error) {
            logger.warn({ error }, 'Failed to parse SPANE_ENGINE_CONFIG, using defaults');
        }
    }

    // Create Redis connection for this worker thread
    const redisConnection = new Redis(redisUrl, {
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
    });

    // Create state store based on database availability
    let stateStore: IExecutionStateStore;
    if (databaseUrl) {
        // Dynamic import to avoid loading database dependencies if not needed
        try {
            const { DrizzleExecutionStateStore } = await import('../db/drizzle-store');
            stateStore = new DrizzleExecutionStateStore(databaseUrl);
            logger.info('Sandboxed processor using DrizzleExecutionStateStore');
        } catch (error) {
            logger.warn({ error }, 'Failed to initialize DrizzleExecutionStateStore, falling back to InMemoryExecutionStore');
            const { InMemoryExecutionStore } = await import('../db/inmemory-store');
            stateStore = new InMemoryExecutionStore();
        }
    } else {
        // Use in-memory store if no database configured
        const { InMemoryExecutionStore } = await import('../db/inmemory-store');
        stateStore = new InMemoryExecutionStore();
        logger.info('Sandboxed processor using InMemoryExecutionStore (no DATABASE_URL configured)');
    }

    // Create NodeRegistry with default external node types
    const registry = new NodeRegistry();
    registry.registerDefaultExternalNodes();

    // Create QueueManager for job operations
    const queueManager = new QueueManager(redisConnection, stateStore);

    // Create workflow cache (simple Map for sandboxed execution)
    // Workflows will be lazy-loaded from the state store as needed
    const workflowCache = new Map<string, WorkflowDefinition>();

    // Create circuit breaker registry for external node protection
    const circuitBreakerRegistry = new CircuitBreakerRegistry();

    // Create a simple enqueueWorkflow function for sandboxed execution
    // This is a simplified version that just adds jobs to the queue
    const enqueueWorkflow: EnqueueWorkflowFn = async (
        workflowId: string,
        initialData?: any,
        parentExecutionId?: string,
        depth: number = 0
    ): Promise<string> => {
        // Get workflow from cache or database
        let workflow = workflowCache.get(workflowId);
        if (!workflow) {
            workflow = await stateStore.getWorkflow(workflowId) ?? undefined;
            if (workflow) {
                workflowCache.set(workflowId, workflow);
            }
        }

        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        // Depth limit to prevent infinite recursion
        const MAX_DEPTH = 10;
        if (depth >= MAX_DEPTH) {
            throw new Error(`Maximum sub-workflow depth (${MAX_DEPTH}) exceeded`);
        }

        // Create execution in state store
        const executionId = await stateStore.createExecution(
            workflowId,
            parentExecutionId,
            depth,
            initialData
        );

        // Find entry nodes
        const entryNodes = workflow.nodes.filter(node => node.inputs.length === 0);
        if (entryNodes.length === 0) {
            throw new Error(`No entry nodes found in workflow '${workflowId}'`);
        }

        // Enqueue entry nodes
        for (const node of entryNodes) {
            await queueManager.nodeQueue.add(
                'process-node',
                {
                    executionId,
                    workflowId,
                    nodeId: node.id,
                    inputData: initialData,
                },
                {
                    jobId: `${executionId}-${node.id}-manual-${Date.now()}`,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 1000 },
                }
            );
        }

        return executionId;
    };

    return {
        registry,
        stateStore,
        redisConnection,
        queueManager,
        workflowCache,
        enqueueWorkflow,
        circuitBreakerRegistry,
        engineConfig,
    };
}

/**
 * Factory function to create a NodeProcessor for sandboxed execution.
 * 
 * This function is called by the sandboxed processor (node-processor.sandbox.ts)
 * when running in a BullMQ worker thread. It creates a NodeProcessor instance
 * with the necessary dependencies for sandboxed execution.
 * 
 * Environment Variables Required:
 * - SPANE_REDIS_URL or REDIS_URL: Redis connection URL
 * 
 * Optional Environment Variables:
 * - SPANE_DATABASE_URL or DATABASE_URL: Database URL for DrizzleStore
 * - SPANE_ENGINE_CONFIG: JSON string of EngineConfig options
 * 
 * @returns Promise<NodeProcessor> - A configured NodeProcessor instance
 * @throws Error if required environment variables are missing
 */
export async function createSandboxedProcessor(): Promise<NodeProcessor> {
    const deps = await createSandboxedProcessorDependencies();

    return new NodeProcessor(
        deps.registry,
        deps.stateStore,
        deps.redisConnection,
        deps.queueManager,
        deps.workflowCache,
        deps.enqueueWorkflow,
        deps.circuitBreakerRegistry,
        undefined, // payloadManager - not supported in sandboxed mode yet
        deps.engineConfig
    );
}

export type EnqueueWorkflowFn = (
    workflowId: string,
    initialData?: any,
    parentExecutionId?: string,
    depth?: number
) => Promise<string>;

// Cache interface that works with both Map and LRUCache
type WorkflowCache = Map<string, WorkflowDefinition> | LRUCache<string, WorkflowDefinition>;

export class NodeProcessor {
    private distributedLock: DistributedLock;

    constructor(
        private registry: NodeRegistry,
        private stateStore: IExecutionStateStore,
        private redisConnection: Redis,
        private queueManager: QueueManager,
        private workflows: WorkflowCache,
        private enqueueWorkflow: EnqueueWorkflowFn,
        private circuitBreakerRegistry?: CircuitBreakerRegistry,
        private payloadManager?: PayloadManager,
        private engineConfig?: EngineConfig
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
        // Load large payload input reference if needed (Claim Check Pattern)
        if (this.payloadManager && data.inputData) {
            try {
                data.inputData = await this.payloadManager.loadIfNeeded(data.inputData);
            } catch (error) {
                logger.error({ executionId: data.executionId, nodeId: data.nodeId, error }, 'Failed to load input payload');
                // Failure to load input is fatal for this node
                throw error;
            }
        }

        const { executionId, workflowId, nodeId, inputData } = data;
        const logContext = { executionId, workflowId, nodeId, jobId: job.id };
        logger.info(logContext, `🔧 Processing node job`);

        // Handle virtual root node (for workflows with multiple entry points)
        if (nodeId === '__root__') {
            return { success: true, data: { message: 'Virtual root node' } };
        }

        // Handle sub-workflow aggregator node (FlowProducer pattern)
        // This node collects results from all child jobs in a sub-workflow flow
        if (nodeId === '__aggregator__' && data.isSubWorkflowAggregator) {
            return this.processAggregatorNode(data, job);
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

            const config = node.config as SubWorkflowConfig;

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

            // Use FlowProducer pattern for sub-workflow execution
            // This leverages BullMQ's native parent-child job dependencies
            logger.info(logContext, `🔀 Executing sub-workflow ${config.workflowId} via FlowProducer`);

            // Emit node started event
            await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);

            const result = await this.executeSubWorkflowWithFlow(
                executionId,
                nodeId,
                config,
                processedInputData,
                execution?.depth || 0,
                job
            );

            // Save result and return - the aggregator will handle completion notification
            await this.stateStore.updateNodeResult(executionId, nodeId, result);

            if (result.success) {
                await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, result.data);
            } else {
                await WorkflowEventEmitter.emitNodeFailed(job, nodeId, workflowId, executionId, result.error || 'Sub-workflow failed');
            }

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

        // Rate limiting is now handled natively by BullMQ at the Worker level
        // via the limiter option in WorkerManager. Custom Redis INCR/EXPIRE
        // rate limiting has been removed as part of the BullMQ improvements cleanup.

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
                        nodeInputData = this.payloadManager
                            ? await this.payloadManager.loadIfNeeded(parentResult.data)
                            : parentResult.data;
                    }
                }
            } else {
                // Multiple parents: Merge data into an object keyed by parent node ID
                const mergedData: Record<string, any> = {};
                for (const parentId of node.inputs) {
                    const parentResult = previousResults[parentId];
                    if (parentResult?.success && parentResult.data !== undefined) {
                        mergedData[parentId] = this.payloadManager
                            ? await this.payloadManager.loadIfNeeded(parentResult.data)
                            : parentResult.data;
                    }
                }
                nodeInputData = mergedData;
            }
        }

        // Create rate limit function for external nodes
        // This allows executors to trigger manual rate limiting when they receive
        // rate limit responses from external APIs (e.g., HTTP 429)
        const rateLimitFn = this.registry.isExternalNode(node.type)
            ? async (duration: number): Promise<Error> => {
                logger.info(
                    { ...logContext, duration },
                    `🚦 Manual rate limit triggered by ${node.type} executor for ${duration}ms`
                );
                await this.queueManager.rateLimit(duration);
                return new RateLimitError();
            }
            : undefined;

        const context: any = {
            workflowId,
            executionId,
            nodeId,
            inputData: nodeInputData,
            nodeConfig: node.config,
            previousResults,
            allNodeResults: executionState?.nodeResults, // Pass full execution history
            parentExecutionId: executionState?.parentExecutionId,
            depth: executionState?.depth || 0,
            // Provide rate limiting capability for external nodes
            rateLimit: rateLimitFn,
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
                const cbOptions = getCircuitBreakerOptionsFromConfig(node.config);
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

            // Offload large output if needed (Claim Check Pattern)
            if (this.payloadManager && result.success && result.data) {
                try {
                    result.data = await this.payloadManager.offloadIfNeeded(executionId, `node-${nodeId}-output`, result.data);
                } catch (error) {
                    logger.warn({ executionId, nodeId, error }, 'Failed to offload output payload, proceeding with inline data');
                    // Continue with inline data
                }
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
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Check 'continueOnFail' policy
            // We apply this ONLY on the last attempt
            const maxAttempts = job.opts.attempts || 1;
            const currentAttempt = job.attemptsMade; // BullMQ is 1-based (starts at 1)

            if (node.config.retryPolicy?.continueOnFail && currentAttempt >= maxAttempts) {
                logger.warn({ ...logContext, error: errorMessage }, `⚠️ Node ${nodeId} failed but 'continueOnFail' is enabled. Marking as success.`);

                // Save result as success but with error info in data
                // We do NOT set success: false, because that would fail the flow in checkAndEnqueueChildren logic (if we didn't handle it here)
                // But specifically, we want downstream nodes to execute
                const safeResult: ExecutionResult = {
                    success: true,
                    data: {
                        error: errorMessage,
                        _metadata: {
                            continuedOnFail: true,
                            originalError: errorMessage
                        }
                    },
                    error: errorMessage // Valid to keep error string even if success=true for UI visibility
                };

                await this.stateStore.updateNodeResult(executionId, nodeId, safeResult);

                // Emit completed event so UI updates correctly
                await WorkflowEventEmitter.emitNodeCompleted(job, nodeId, workflowId, executionId, safeResult.data);

                // Trigger children
                if (node.outputs.length > 0) {
                    await this.checkAndEnqueueChildren(executionId, workflowId, node, safeResult.nextNodes, job);
                }

                // Check workflow completion
                await this.checkWorkflowCompletion(executionId, workflowId, job);

                return safeResult;
            }

            logger.error({ ...logContext, error }, `❌ Node ${nodeId} execution failed`);

            // Emit 'failed' event on execution failure
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
            delayStep?: 'initial' | 'resumed';
            delayStartTime?: number;
        } = {}
    ): Promise<void> {
        const jobData: NodeJobData = {
            executionId,
            workflowId,
            nodeId,
            inputData: {}, // Input data is fetched during execution now
            delayStep: options.delayStep,
            delayStartTime: options.delayStartTime,
        };

        // Use stateless utility to generate deterministic job ID
        const jobId = generateNodeJobId(executionId, nodeId, options.delayStep);

        // Fetch node configuration for retry policy
        const workflow = await this.getWorkflowWithLazyLoad(workflowId);
        const node = workflow?.nodes.find(n => n.id === nodeId);
        
        // Use stateless utility to extract retry configuration
        const retryConfig = extractRetryConfig(node?.config?.retryPolicy);

        await this.queueManager.nodeQueue.add('process-node', jobData, {
            jobId,
            delay: options.delay,
            attempts: retryConfig.attempts,
            backoff: retryConfig.backoff,
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

                // Note: Parent workflow notification is now handled by the aggregator node
                // in the FlowProducer pattern. The old notifyParentWorkflow callback mechanism
                // has been removed as part of the BullMQ improvements cleanup.
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

        // Note: Parent workflow notification is now handled by the aggregator node
        // in the FlowProducer pattern. The old notifyParentWorkflow callback mechanism
        // has been removed as part of the BullMQ improvements cleanup.
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
        const duration = resolveDelayDuration(config);

        // Validate duration using stateless utility
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
            // Initial processing: emit started event and move to delayed queue
            logger.info({ executionId, nodeId, duration: validDuration }, `⏳ Delay node ${nodeId} starting with duration ${validDuration}ms`);

            // Emit node:started event
            await WorkflowEventEmitter.emitNodeStarted(job, nodeId, workflowId, executionId);

            // Emit node:delayed event with expected resume time
            const resumeTime = Date.now() + validDuration;
            await WorkflowEventEmitter.emitNodeDelayed(job, nodeId, workflowId, executionId, resumeTime);

            // Enqueue the resumed job with delay
            await this.enqueueNode(executionId, workflowId, nodeId, {
                delay: validDuration,
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
                    duration: validDuration,
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

    /**
     * Process a sub-workflow aggregator node (FlowProducer pattern).
     * 
     * This node is automatically created by executeSubWorkflowWithFlow() and serves as
     * the parent job in a BullMQ flow. It waits for all child jobs (sub-workflow nodes)
     * to complete, then aggregates their results using getChildrenValues().
     * 
     * @param data - The node job data containing aggregator configuration
     * @param job - The BullMQ job instance
     * @returns ExecutionResult with aggregated sub-workflow output
     */
    private async processAggregatorNode(data: NodeJobData, job: Job): Promise<ExecutionResult> {
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

            // Use stateless utility to aggregate child results
            const aggregatedResult = aggregateChildResults(childrenValues, executionId);

            // Apply output mapping using stateless utility
            const mappedOutput = applyOutputMapping(aggregatedResult, outputMapping);

            // Mark sub-workflow execution as completed
            await this.stateStore.setExecutionStatus(executionId, 'completed');

            logger.info(logContext, `✅ Sub-workflow aggregator completed successfully`);

            // Notify parent workflow if this is a nested sub-workflow
            if (parentExecutionId && parentNodeId) {
                logger.info(
                    { ...logContext, parentExecutionId, parentNodeId },
                    `🔔 Notifying parent workflow of sub-workflow completion`
                );

                // Get parent workflow ID from parent execution
                const parentExecution = await this.stateStore.getExecution(parentExecutionId);
                const parentWorkflowId = parentExecution?.workflowId || 'unknown';

                // Re-enqueue the parent node to continue processing
                // The parent node will check the state store for sub-workflow completion
                await this.enqueueNode(parentExecutionId, parentWorkflowId, parentNodeId);
            }

            return {
                success: true,
                data: mappedOutput
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ ...logContext, error: errorMessage }, `❌ Sub-workflow aggregator failed`);

            // Mark sub-workflow execution as failed
            await this.stateStore.setExecutionStatus(executionId, 'failed');

            // Notify parent workflow of failure if applicable
            if (parentExecutionId && parentNodeId) {
                const parentExecution = await this.stateStore.getExecution(parentExecutionId);
                const parentWorkflowId = parentExecution?.workflowId || 'unknown';

                // Re-enqueue the parent node to handle the failure
                await this.enqueueNode(parentExecutionId, parentWorkflowId, parentNodeId);
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
     * This method creates a flow with the sub-workflow's entry nodes as children
     * and an aggregator node as the parent. BullMQ handles the dependency management
     * and the aggregator collects results via getChildrenValues().
     * 
     * The flow is built recursively to mirror the sub-workflow's DAG structure:
     * - Entry nodes (no inputs) are direct children of the aggregator
     * - Each node's children in the workflow become its children in the flow
     * - This ensures BullMQ waits for the entire sub-workflow to complete
     * 
     * @param parentExecutionId - The execution ID of the parent workflow
     * @param parentNodeId - The node ID in the parent workflow that triggered this sub-workflow
     * @param config - Sub-workflow configuration including workflowId and mappings
     * @param inputData - Input data to pass to the sub-workflow
     * @param depth - Current nesting depth
     * @param job - The parent BullMQ job instance
     * @returns ExecutionResult with the aggregated sub-workflow output
     */
    async executeSubWorkflowWithFlow(
        parentExecutionId: string,
        parentNodeId: string,
        config: SubWorkflowConfig,
        inputData: any,
        depth: number,
        job: Job
    ): Promise<ExecutionResult> {
        const { workflowId, inputMapping, outputMapping } = config;

        // Validate sub-workflow exists
        const subWorkflow = await this.getWorkflowWithLazyLoad(workflowId);
        if (!subWorkflow) {
            return {
                success: false,
                error: `Sub-workflow '${workflowId}' not found`
            };
        }

        try {
            // Apply input mapping using stateless utility
            const mappedInput = applyInputMapping(inputData, inputMapping);

            // Create child execution in state store
            const childExecutionId = await this.stateStore.createExecution(
                workflowId,
                parentExecutionId,
                depth + 1,
                mappedInput
            );

            // Store parent node info in execution metadata for potential callbacks
            const metadata = {
                parentNodeId,
                parentWorkflowId: (await this.stateStore.getExecution(parentExecutionId))?.workflowId || 'unknown'
            };
            await this.stateStore.updateExecutionMetadata(childExecutionId, metadata);

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
            // This creates a hierarchical structure that mirrors the sub-workflow's DAG
            const childFlows = this.buildFlowTreeFromEntryNodes(
                subWorkflow,
                entryNodes,
                childExecutionId,
                mappedInput,
                config.continueOnFail
            );

            // Build flow with entry nodes (and their descendants) as children of an aggregator
            const flow = await this.queueManager.flowProducer.add({
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
            // The parent node will be notified when the aggregator completes
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
     * This creates a hierarchical flow structure that mirrors the sub-workflow's DAG:
     * - Each node becomes a flow job
     * - In BullMQ FlowProducer, children are dependencies that must complete BEFORE the parent
     * - So we build the tree from final nodes (no outputs) back to entry nodes
     * - Final nodes become direct children of the aggregator
     * - Each node has its input nodes (predecessors) as children
     * 
     * BullMQ Flow Dependency Options:
     * - failParentOnFailure: When true, if this child job fails, the parent job will also fail
     * - ignoreDependencyOnFailure: When true, the parent job will proceed even if this child fails
     * 
     * These options work together with continueOnFail:
     * - continueOnFail=false: failParentOnFailure=true, ignoreDependencyOnFailure=false (default)
     * - continueOnFail=true: failParentOnFailure=false, ignoreDependencyOnFailure=true
     * 
     * @param workflow - The sub-workflow definition
     * @param entryNodes - The entry nodes (used for validation)
     * @param executionId - The child execution ID
     * @param inputData - Input data for entry nodes
     * @param continueOnFail - Whether to continue on failure
     * @returns Array of flow job definitions for FlowProducer
     */
    private buildFlowTreeFromEntryNodes(
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

        // Recursive function to build flow tree for a node and its predecessors (inputs)
        // In BullMQ FlowProducer, children execute BEFORE the parent
        // So a node's "children" in the flow are its input nodes (predecessors in the workflow)
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

            // Build children flows (predecessor nodes in the workflow - they must run first)
            const childFlows: any[] = [];
            for (const inputNodeId of node.inputs) {
                const inputNode = nodeMap.get(inputNodeId);
                if (inputNode) {
                    childFlows.push(buildNodeFlow(inputNode));
                }
            }

            // Determine if this is an entry node (no inputs)
            const isEntryNode = node.inputs.length === 0;

            // Configure flow dependency options based on continueOnFail setting:
            // - failParentOnFailure: Propagate failure to parent sub-workflow node
            // - ignoreDependencyOnFailure: Continue parent even if this child fails
            const flowNode = {
                name: 'process-node',
                queueName: 'node-execution',
                data: {
                    executionId,
                    workflowId: workflow.id,
                    nodeId: node.id,
                    inputData: isEntryNode ? inputData : undefined, // Only entry nodes get initial input
                } as NodeJobData,
                opts: {
                    jobId: `${executionId}-${node.id}`,
                    // When continueOnFail is true, don't fail parent and ignore dependency failure
                    // When continueOnFail is false (default), fail parent on child failure
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

        // Build flow trees starting from each final node (working backwards to entry nodes)
        return rootNodes.map(node => buildNodeFlow(node));
    }
}
