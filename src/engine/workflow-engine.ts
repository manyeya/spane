import { Redis } from 'ioredis';
import type { JobType } from 'bullmq';
import { LRUCache } from 'lru-cache';
import { NodeRegistry } from './registry';
import type { IExecutionStateStore, WorkflowDefinition } from '../types';
import { validateWorkflow, type ValidationError } from './graph-validation';
import { MetricsCollector } from '../utils/metrics';
import { CircuitBreakerRegistry } from '../utils/circuit-breaker';
import { QueueManager } from './queue-manager';
import { DLQManager } from './dlq-manager';
import { NodeProcessor } from './node-processor';
import { WorkerManager } from './worker-manager';
import type { DLQItem } from './types';
import { TimeoutMonitor } from '../utils/timeout-monitor';
import { HealthMonitor } from '../utils/health-monitor';
import type { WorkflowStatusEvent } from './event-types';
import { EventStreamManager } from './event-stream';
import { logger } from '../utils/logger';
import type { PayloadManager } from './payload-manager';
import { type EngineConfig, mergeEngineConfig } from './config';

export interface WorkflowCacheOptions {
    maxSize?: number;      // Max number of workflows to cache (default: 500)
    ttlMs?: number;        // Time-to-live in milliseconds (default: 1 hour)
}

export class WorkflowEngine {
    private queueManager: QueueManager;
    private dlqManager: DLQManager;
    private nodeProcessor: NodeProcessor;
    private workerManager: WorkerManager;
    private timeoutMonitor?: TimeoutMonitor;
    private healthMonitor?: HealthMonitor;
    private eventStreamManager: EventStreamManager;
    private workflowCache: LRUCache<string, WorkflowDefinition>;
    private config: EngineConfig;

    constructor(
        registry: NodeRegistry,
        private stateStore: IExecutionStateStore,
        redisConnection: Redis,
        private metricsCollector?: MetricsCollector,
        _circuitBreakerRegistry?: CircuitBreakerRegistry,
        cacheOptions?: WorkflowCacheOptions,
        private payloadManager?: PayloadManager,
        engineConfig?: Partial<EngineConfig>
    ) {
        // Merge user config with defaults
        this.config = mergeEngineConfig(engineConfig);

        // Initialize LRU cache with configurable limits
        const { maxSize = 500, ttlMs = 3600000 } = cacheOptions || {};
        this.workflowCache = new LRUCache<string, WorkflowDefinition>({
            max: maxSize,
            ttl: ttlMs,
            updateAgeOnGet: true, // Reset TTL on access
        });

        // Initialize components
        this.queueManager = new QueueManager(redisConnection, stateStore, metricsCollector);
        this.dlqManager = new DLQManager(this.queueManager);

        // Initialize EventStreamManager for real-time event streaming
        this.eventStreamManager = new EventStreamManager(redisConnection, stateStore);

        // Initialize NodeProcessor with bound enqueueWorkflow
        this.nodeProcessor = new NodeProcessor(
            registry,
            stateStore,
            redisConnection,
            this.queueManager,
            this.workflowCache, // Pass LRU cache reference to NodeProcessor
            this.enqueueWorkflow.bind(this),
            _circuitBreakerRegistry, // Pass circuit breaker registry for external node protection
            payloadManager,
            this.config // Pass engine config for feature flags
        );

        // Initialize WorkerManager
        this.workerManager = new WorkerManager(
            redisConnection,
            this.nodeProcessor,
            this.dlqManager,
            stateStore,
            this.enqueueWorkflow.bind(this),
            metricsCollector,
            this.config
        );

        // Initialize monitors (optional, only if using DrizzleStore)
        if ('findTimedOutExecutions' in stateStore) {
            this.timeoutMonitor = new TimeoutMonitor(stateStore, redisConnection, 60000);
            this.healthMonitor = new HealthMonitor(stateStore, redisConnection, this.queueManager, 30000);
        }

        // Note: Workflows are now loaded lazily on-demand from database
        // This improves startup time and memory usage
    }



    // Helper to log to both console and state store
    private async log(executionId: string, nodeId: string | undefined, level: 'info' | 'warn' | 'error' | 'debug', message: string, metadata?: any): Promise<void> {
        // Structured log
        const logContext = { executionId, nodeId, ...metadata };
        if (level === 'error') logger.error(logContext, message);
        else if (level === 'warn') logger.warn(logContext, message);
        else if (level === 'debug') logger.debug(logContext, message);
        else logger.info(logContext, message);

        // Store log
        await this.stateStore.addLog({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            executionId,
            nodeId,
            level,
            message,
            timestamp: new Date(),
            metadata
        });
    }

    // Register a workflow definition (saves to database with versioning)
    async registerWorkflow(workflow: WorkflowDefinition, changeNotes?: string): Promise<void> {
        // Validate workflow graph before saving
        const validationResult = validateWorkflow(workflow);

        // Log warnings (unreachable nodes, etc.)
        const warnings = validationResult.errors.filter((e) => e.severity === 'warning');
        if (warnings.length > 0) {
            for (const warning of warnings) {
                logger.warn(
                    { workflowId: workflow.id, warning },
                    `⚠️ Workflow validation warning: ${warning.message}`
                );
            }
        }

        // Throw error for critical validation failures (cycles, missing refs, etc.)
        const errors = validationResult.errors.filter((e) => e.severity === 'error');
        if (errors.length > 0) {
            const errorMessages = errors.map((e) => e.message).join('; ');
            logger.error(
                { workflowId: workflow.id, errors },
                `❌ Workflow validation failed: ${errorMessages}`
            );
            throw new Error(`Workflow validation failed: ${errorMessages}`);
        }

        try {
            // Save to database (with versioning)
            const versionId = await this.stateStore.saveWorkflow(workflow, changeNotes);
            logger.info({ workflowId: workflow.id, versionId }, `✅ Saved workflow ${workflow.id} to database (version ID: ${versionId})`);
        } catch (error) {
            // If database doesn't support workflow persistence, just log and continue
            if (error instanceof Error && error.message.includes('not supported')) {
                logger.info({ workflowId: workflow.id }, `💡 Workflow ${workflow.id} registered in-memory only (no database persistence)`);
            } else {
                logger.error({ workflowId: workflow.id, error }, `Failed to save workflow ${workflow.id} to database`);
                // Don't throw - allow in-memory registration to proceed
            }
        }

        // Update in-memory cache
        this.workflowCache.set(workflow.id, workflow);

        // Handle Schedule Triggers using upsertJobScheduler (idempotent, no manual cleanup needed)
        if (workflow.triggers) {
            for (const trigger of workflow.triggers) {
                if (trigger.type === 'schedule') {
                    try {
                        await this.registerScheduleWithUpsert(
                            workflow.id,
                            trigger.config.cron,
                            trigger.config.timezone
                        );
                    } catch (error) {
                        const errorMsg = `Failed to register schedule trigger for workflow ${workflow.id}: ${error instanceof Error ? error.message : String(error)}`;
                        logger.error({ workflowId: workflow.id, error }, errorMsg);
                        throw new Error(errorMsg);
                    }
                }
            }
        }
    }

    /**
     * Register a schedule trigger using BullMQ's upsertJobScheduler.
     * This is idempotent - calling it multiple times with the same parameters
     * will update the existing schedule rather than creating duplicates.
     * 
     * @param workflowId - The workflow ID to schedule
     * @param cron - Cron pattern for the schedule
     * @param timezone - Optional timezone for the cron schedule
     */
    async registerScheduleWithUpsert(
        workflowId: string,
        cron: string,
        timezone?: string
    ): Promise<void> {
        const schedulerId = `schedule:${workflowId}:${cron}`;

        await this.queueManager.workflowQueue.upsertJobScheduler(
            schedulerId,
            {
                pattern: cron,
                ...(timezone && { tz: timezone }),
            },
            {
                name: 'workflow-execution',
                data: { workflowId },
            }
        );

        logger.info(
            { workflowId, cron, timezone, schedulerId },
            `⏰ Upserted schedule for workflow ${workflowId}: ${cron}`
        );
    }

    /**
     * Remove all job schedulers associated with a workflow.
     * Used when deactivating a workflow to stop scheduled executions.
     * 
     * @param workflowId - The workflow ID to deactivate schedules for
     * @returns Number of schedulers removed
     */
    async removeWorkflowSchedulers(workflowId: string): Promise<number> {
        const schedulers = await this.queueManager.workflowQueue.getJobSchedulers();
        let removedCount = 0;

        for (const scheduler of schedulers) {
            // Scheduler IDs follow the pattern: schedule:{workflowId}:{cron}
            const schedulerId = scheduler.id;
            if (schedulerId && schedulerId.startsWith(`schedule:${workflowId}:`)) {
                await this.queueManager.workflowQueue.removeJobScheduler(schedulerId);
                logger.info(
                    { workflowId, schedulerId },
                    `🗑️ Removed scheduler ${schedulerId} for workflow ${workflowId}`
                );
                removedCount++;
            }
        }

        if (removedCount > 0) {
            logger.info(
                { workflowId, removedCount },
                `✅ Removed ${removedCount} scheduler(s) for workflow ${workflowId}`
            );
        } else {
            logger.debug(
                { workflowId },
                `No schedulers found for workflow ${workflowId}`
            );
        }

        return removedCount;
    }

    /**
     * Get all active job schedulers.
     * Returns a list of job schedulers with their IDs, patterns, and next execution times.
     * Useful for monitoring scheduled workflows and building dashboards.
     * 
     * @param start - Start index for pagination (default: 0)
     * @param end - End index for pagination (default: -1 for all)
     * @param asc - Sort by next execution time ascending (default: true)
     * @returns Array of job scheduler objects
     */
    async getJobSchedulers(
        start: number = 0,
        end: number = -1,
        asc: boolean = true
    ): Promise<Array<{
        id: string;
        pattern?: string;
        every?: number;
        tz?: string;
        next?: number;
        endDate?: number;
    }>> {
        const schedulers = await this.queueManager.workflowQueue.getJobSchedulers(start, end, asc);
        return schedulers
            .filter(scheduler => scheduler.id != null)
            .map(scheduler => ({
                id: scheduler.id!,
                pattern: scheduler.pattern,
                every: scheduler.every,
                tz: scheduler.tz,
                next: scheduler.next,
                endDate: scheduler.endDate,
            }));
    }

    /**
     * Get a specific job scheduler by ID.
     * 
     * @param schedulerId - The scheduler ID to look up
     * @returns The job scheduler object or null if not found
     */
    async getJobScheduler(schedulerId: string): Promise<{
        id: string;
        pattern?: string;
        every?: number;
        tz?: string;
        next?: number;
        endDate?: number;
    } | null> {
        const scheduler = await this.queueManager.workflowQueue.getJobScheduler(schedulerId);
        if (!scheduler || !scheduler.id) {
            return null;
        }
        return {
            id: scheduler.id,
            pattern: scheduler.pattern,
            every: scheduler.every,
            tz: scheduler.tz,
            next: scheduler.next,
            endDate: scheduler.endDate,
        };
    }

    /**
     * Get workflow definition (lazy loads from database if not cached)
     */
    async getWorkflow(workflowId: string): Promise<WorkflowDefinition | undefined> {
        // Check cache first
        let workflow = this.workflowCache.get(workflowId);

        // If not in cache, try to load from database
        if (!workflow) {
            const dbWorkflow = await this.stateStore.getWorkflow(workflowId);
            if (dbWorkflow) {
                // Cache it for future use
                this.workflowCache.set(workflowId, dbWorkflow);
                workflow = dbWorkflow;
            }
        }

        return workflow;
    }

    /**
     * Get workflow from cache only (synchronous)
     */
    getWorkflowFromCache(workflowId: string): WorkflowDefinition | undefined {
        return this.workflowCache.get(workflowId);
    }

    getAllWorkflows(): Map<string, WorkflowDefinition> {
        // Convert LRU cache entries to Map for backwards compatibility
        const map = new Map<string, WorkflowDefinition>();
        for (const [key, value] of this.workflowCache.entries()) {
            map.set(key, value);
        }
        return map;
    }

    /**
     * Get cache statistics for monitoring
     */
    getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
        return {
            size: this.workflowCache.size,
            maxSize: this.workflowCache.max,
        };
    }

    /**
     * Get the current engine configuration
     */
    getConfig(): EngineConfig {
        return this.config;
    }

    /**
     * Get the EventStreamManager for real-time event streaming.
     * Used by API endpoints to subscribe to workflow events via SSE.
     */
    getEventStream(): EventStreamManager {
        return this.eventStreamManager;
    }

    /**
     * Get all workflows from database (ensures persistence across restarts)
     * Supports pagination for memory efficiency
     */
    async getAllWorkflowsFromDatabase(
        activeOnly: boolean = true,
        limit: number = 100,
        offset: number = 0
    ): Promise<WorkflowDefinition[]> {
        return await this.stateStore.listWorkflows(activeOnly, limit, offset);
    }

    // Get workflow from database (optionally specific version)
    async getWorkflowFromDatabase(workflowId: string, version?: number): Promise<WorkflowDefinition | null> {
        return await this.stateStore.getWorkflow(workflowId, version);
    }

    // Enqueue a full workflow execution
    async enqueueWorkflow(
        workflowId: string,
        initialData?: any,
        parentExecutionId?: string,
        depth: number = 0,
        parentJobId?: string,
        options?: {
            priority?: number;
            delay?: number;
            jobId?: string;
        }
    ): Promise<string> {
        // Lazy load workflow from database if not in cache
        const workflow = await this.getWorkflow(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        // Depth limit to prevent infinite recursion
        const MAX_DEPTH = 10;
        if (depth >= MAX_DEPTH) {
            throw new Error(`Maximum sub-workflow depth (${MAX_DEPTH}) exceeded`);
        }

        const executionId = await this.stateStore.createExecution(workflowId, parentExecutionId, depth, initialData);

        // Offload initial data if large (Claim Check Pattern)
        // We do this AFTER createExecution so DB has full data, but BEFORE enqueueNode so Redis gets reference
        let safeInitialData = initialData;
        if (this.payloadManager && initialData) {
            try {
                safeInitialData = await this.payloadManager.offloadIfNeeded(executionId, 'initialData', initialData);
            } catch (error) {
                logger.error({ executionId, workflowId, error }, 'Failed to offload initial payload');
                // Proceed with inline data as fallback
            }
        }

        // Track metrics
        if (this.metricsCollector) {
            this.metricsCollector.incrementWorkflowsEnqueued();
        }

        // Determine entry nodes: use entryNodeId if specified, otherwise detect nodes with empty inputs
        let entryNodes: typeof workflow.nodes;

        if (workflow.entryNodeId) {
            // Use the specified entry node
            const entryNode = workflow.nodes.find(n => n.id === workflow.entryNodeId);
            if (!entryNode) {
                throw new Error(`Entry node '${workflow.entryNodeId}' not found in workflow '${workflowId}'`);
            }
            entryNodes = [entryNode];
        } else {
            // Fall back to detecting nodes with empty inputs
            entryNodes = workflow.nodes.filter(node => node.inputs.length === 0);
        }

        if (entryNodes.length === 0) {
            throw new Error(`No entry nodes found in workflow '${workflowId}'`);
        }

        // Enqueue all entry nodes, passing parent job reference if this is a sub-workflow
        // Also pass priority and delay options to each node
        for (const node of entryNodes) {
            await this.enqueueNode(executionId, workflowId, node.id, safeInitialData, parentJobId, options);
        }

        // Emit 'started' workflow event directly via EventStreamManager
        const startedEvent: WorkflowStatusEvent = {
            type: 'workflow:status',
            timestamp: Date.now(),
            executionId,
            workflowId,
            status: 'started',
        };
        this.eventStreamManager.emitLocal(startedEvent);

        await this.log(executionId, undefined, 'info', `Workflow ${workflowId} started (Execution ID: ${executionId})`);
        return executionId;
    }

    // Enqueue a single node execution (for manual/direct node execution)
    // Note: This method is used for manual triggers and initial workflow entry nodes
    // It uses timestamp in job ID since these are user-initiated actions that may be retried
    async enqueueNode(
        executionId: string,
        workflowId: string,
        nodeId: string,
        inputData?: any,
        parentJobId?: string,
        options?: {
            priority?: number;
            delay?: number;
            jobId?: string;
        }
    ): Promise<string> {
        // For manual/entry node jobs, use timestamp for uniqueness (allows retries)
        // Child node jobs use deterministic IDs in NodeProcessor.enqueueNode
        const jobOpts: any = {
            jobId: options?.jobId || `${executionId}-${nodeId}-manual-${Date.now()}`,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        };

        // Add priority if specified (1-10, higher = more important)
        if (options?.priority !== undefined) {
            jobOpts.priority = options.priority;
        }

        // Add delay if specified (in milliseconds)
        if (options?.delay !== undefined) {
            jobOpts.delay = options.delay;
        }

        // Add parent reference if provided (for BullMQ dependencies)
        if (parentJobId) {
            jobOpts.parent = {
                id: parentJobId,
                queue: 'node-execution',
            };
        }

        const job = await this.queueManager.nodeQueue.add(
            'process-node',
            { executionId, workflowId, nodeId, inputData },
            jobOpts
        );

        return job.id!;
    }

    // Trigger workflows via webhook path
    async triggerWebhook(path: string, method: string, data: any): Promise<string[]> {
        const triggeredExecutionIds: string[] = [];

        for (const workflow of this.workflowCache.values()) {
            if (workflow.triggers) {
                for (const trigger of workflow.triggers) {
                    if (trigger.type === 'webhook' && trigger.config.path === path) {
                        // Check method if specified
                        if (trigger.config.method && trigger.config.method !== method) {
                            continue;
                        }

                        logger.info({ workflowId: workflow.id, path }, `🔗 Webhook triggered workflow ${workflow.id} (path: ${path})`);
                        const executionId = await this.enqueueWorkflow(workflow.id, data);
                        triggeredExecutionIds.push(executionId);
                    }
                }
            }
        }

        return triggeredExecutionIds;
    }

    // Replay a past execution
    async replayWorkflow(executionId: string): Promise<string> {
        const execution = await this.stateStore.getExecution(executionId);
        if (!execution) {
            throw new Error(`Execution ${executionId} not found`);
        }

        // Retrieve initialData from the original execution state
        const initialData = execution.initialData;

        // Start new execution
        const newExecutionId = await this.enqueueWorkflow(execution.workflowId, initialData);

        // Link to original execution
        await this.stateStore.updateExecutionMetadata(newExecutionId, {
            replayedFrom: executionId,
            ...execution.metadata
        });

        await this.log(newExecutionId, undefined, 'info', `Replay of execution ${executionId}`);

        return newExecutionId;
    }

    // Start worker processes
    startWorkers(concurrency?: number): void {
        // Use provided concurrency, or fall back to config value
        this.workerManager.startWorkers(concurrency ?? this.config.workerConcurrency);

        // Start event stream for real-time updates
        this.eventStreamManager.start().catch((error) => {
            logger.error({ error }, '[WorkflowEngine] Failed to start event stream');
        });

        // Start monitors
        if (this.timeoutMonitor) {
            this.timeoutMonitor.start();
        }
        if (this.healthMonitor) {
            this.healthMonitor.start();
        }
    }

    // Get items from DLQ
    async getDLQItems(start: number = 0, end: number = 10): Promise<DLQItem[]> {
        return this.dlqManager.getDLQItems(start, end);
    }

    async retryDLQItem(dlqJobId: string): Promise<boolean> {
        return this.dlqManager.retryDLQItem(dlqJobId);
    }

    // --- Control Flow Methods ---

    async cancelWorkflow(executionId: string): Promise<void> {
        // Get workflow ID for event emission
        const execution = await this.stateStore.getExecution(executionId);
        const workflowId = execution?.workflowId || 'unknown';

        // Update database status
        await this.stateStore.setExecutionStatus(executionId, 'cancelled');

        // Remove all pending jobs for this execution from the queue
        const jobStates: JobType[] = ['waiting', 'delayed', 'prioritized', 'waiting-children'];
        const jobs = await this.queueManager.nodeQueue.getJobs(jobStates, 0, -1);

        let removedCount = 0;
        for (const job of jobs) {
            // Check if job belongs to this execution
            if (job.data.executionId === executionId) {
                await job.remove();
                removedCount++;
            }
        }

        // Emit 'cancelled' workflow event directly via EventStreamManager
        const cancelledEvent: WorkflowStatusEvent = {
            type: 'workflow:status',
            timestamp: Date.now(),
            executionId,
            workflowId,
            status: 'cancelled',
        };
        this.eventStreamManager.emitLocal(cancelledEvent);

        logger.info({ executionId, removedCount }, `🚫 Workflow ${executionId} cancelled (removed ${removedCount} pending jobs)`);
    }

    async pauseWorkflow(executionId: string): Promise<void> {
        // Get workflow ID for event emission
        const execution = await this.stateStore.getExecution(executionId);
        const workflowId = execution?.workflowId || 'unknown';

        // Update database status
        await this.stateStore.setExecutionStatus(executionId, 'paused');

        // Move all waiting jobs to delayed state (24 hours)
        const jobStates: JobType[] = ['waiting', 'prioritized'];
        const jobs = await this.queueManager.nodeQueue.getJobs(jobStates, 0, -1);

        let pausedCount = 0;
        for (const job of jobs) {
            if (job.data.executionId === executionId) {
                try {
                    // Strategy: Remove and re-add with delay (preserving ID)
                    // moveToDelayed only works for active jobs or requires complex state handling

                    const jobName = job.name;
                    const jobData = job.data;
                    const jobOpts = job.opts;
                    const jobId = job.id;

                    // Remove the current job
                    await job.remove();

                    // Re-add with long delay (24h)
                    await this.queueManager.nodeQueue.add(jobName, jobData, {
                        ...jobOpts,
                        jobId: jobId, // Preserve ID
                        delay: 86400000, // 24 hours
                        priority: jobOpts.priority, // Ensure priority is preserved
                    });

                    pausedCount++;
                } catch (error) {
                    logger.warn({ jobId: job.id, error }, `  ⚠️ Failed to pause job ${job.id}`);
                }
            }
        }

        // Emit 'paused' workflow event directly via EventStreamManager
        const pausedEvent: WorkflowStatusEvent = {
            type: 'workflow:status',
            timestamp: Date.now(),
            executionId,
            workflowId,
            status: 'paused',
        };
        this.eventStreamManager.emitLocal(pausedEvent);

        console.log(`⏸️ Workflow ${executionId} paused (delayed ${pausedCount} jobs)`);
    }

    async resumeWorkflow(executionId: string): Promise<void> {
        // Update database status
        await this.stateStore.setExecutionStatus(executionId, 'running');

        // Promote all delayed jobs back to waiting
        const delayedJobs = await this.queueManager.nodeQueue.getJobs('delayed', 0, -1);

        let resumedCount = 0;
        for (const job of delayedJobs) {
            if (job.data.executionId === executionId) {
                try {
                    // Promote to waiting (immediate execution)
                    await job.promote();
                    resumedCount++;
                } catch (error) {
                    // Job might have already been promoted, ignore
                }
            }
        }
        logger.info({ executionId, resumedCount }, `▶️ Workflow ${executionId} resumed(promoted ${resumedCount} jobs)`);
    }

    async getJobStatus(jobId: string): Promise<{ exists: boolean; status?: string }> {
        const job = await this.queueManager.nodeQueue.getJob(jobId);
        if (!job) {
            return { exists: false };
        }
        const state = await job.getState();
        return { exists: true, status: state };
    }

    // --- Bulk Operations ---

    async enqueueBulkWorkflows(workflows: Array<{
        workflowId: string;
        initialData?: any;
        options?: { priority?: number; delay?: number; jobId?: string };
    }>): Promise<string[]> {
        const executionIds: string[] = [];
        for (const wf of workflows) {
            try {
                const id = await this.enqueueWorkflow(wf.workflowId, wf.initialData, undefined, 0, undefined, wf.options);
                executionIds.push(id);
            } catch (error) {
                logger.error({ workflowId: wf.workflowId, error }, `Failed to enqueue workflow ${wf.workflowId} in bulk`);
                executionIds.push(''); // Push empty string to maintain index alignment or handle error differently
            }
        }
        return executionIds;
    }

    async pauseBulkWorkflows(executionIds: string[]): Promise<void> {
        await Promise.all(executionIds.map(id => this.pauseWorkflow(id)));
    }

    async resumeBulkWorkflows(executionIds: string[]): Promise<void> {
        await Promise.all(executionIds.map(id => this.resumeWorkflow(id)));
    }

    async cancelBulkWorkflows(executionIds: string[]): Promise<void> {
        await Promise.all(executionIds.map(id => this.cancelWorkflow(id)));
    }

    // Get queue statistics
    async getQueueStats(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        paused: number;
    }> {
        const [nodeQueueCounts, workflowQueueCounts] = await Promise.all([
            this.queueManager.nodeQueue.getJobCounts(),
            this.queueManager.workflowQueue.getJobCounts()
        ]);

        return {
            waiting: (nodeQueueCounts.waiting ?? 0) + (workflowQueueCounts.waiting ?? 0),
            active: (nodeQueueCounts.active ?? 0) + (workflowQueueCounts.active ?? 0),
            completed: (nodeQueueCounts.completed ?? 0) + (workflowQueueCounts.completed ?? 0),
            failed: (nodeQueueCounts.failed ?? 0) + (workflowQueueCounts.failed ?? 0),
            delayed: (nodeQueueCounts.delayed ?? 0) + (workflowQueueCounts.delayed ?? 0),
            paused: (nodeQueueCounts.paused ?? 0) + (workflowQueueCounts.paused ?? 0),
        };
    }

    // Schedule a workflow to execute at a specific time
    async scheduleWorkflow(
        workflowId: string,
        initialData: any,
        executeAt: Date
    ): Promise<string> {
        const delay = executeAt.getTime() - Date.now();

        if (delay < 0) {
            throw new Error('Cannot schedule workflow in the past');
        }

        return this.enqueueWorkflow(
            workflowId,
            initialData,
            undefined,
            0,
            undefined,
            { delay }
        );
    }

    // Graceful shutdown
    async close(): Promise<void> {
        logger.info('🛑 Shutting down workflow engine...');

        // Stop monitors
        if (this.timeoutMonitor) {
            this.timeoutMonitor.stop();
        }
        if (this.healthMonitor) {
            this.healthMonitor.stop();
        }

        // Close event stream manager
        await this.eventStreamManager.close();

        await this.workerManager.close();
        await this.queueManager.close();
        logger.info('✓ Workflow engine shutdown complete');
    }
}
