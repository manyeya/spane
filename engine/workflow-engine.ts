import { Redis } from 'ioredis';
import { NodeRegistry } from '../registry';
import type { IExecutionStateStore, WorkflowDefinition } from '../types';
import { MetricsCollector } from '../metrics';
import { CircuitBreakerRegistry } from '../circuit-breaker';
import { QueueManager } from './queue-manager';
import { DLQManager } from './dlq-manager';
import { NodeProcessor } from './node-processor';
import { WorkerManager } from './worker-manager';
import type { DLQItem } from './types';

export class WorkflowEngine {
    private queueManager: QueueManager;
    private dlqManager: DLQManager;
    private nodeProcessor: NodeProcessor;
    private workerManager: WorkerManager;
    private workflows: Map<string, WorkflowDefinition> = new Map();

    constructor(
        private registry: NodeRegistry,
        private stateStore: IExecutionStateStore,
        private redisConnection: Redis,
        private metricsCollector?: MetricsCollector,
        private circuitBreakerRegistry?: CircuitBreakerRegistry
    ) {
        // Initialize components
        this.queueManager = new QueueManager(redisConnection, stateStore, metricsCollector);
        this.dlqManager = new DLQManager(this.queueManager);

        // Initialize NodeProcessor with bound enqueueWorkflow
        this.nodeProcessor = new NodeProcessor(
            registry,
            stateStore,
            redisConnection,
            this.queueManager,
            this.workflows,
            this.enqueueWorkflow.bind(this)
        );

        // Initialize WorkerManager
        this.workerManager = new WorkerManager(
            redisConnection,
            this.nodeProcessor,
            this.dlqManager,
            stateStore,
            this.enqueueWorkflow.bind(this),
            metricsCollector
        );
    }

    // Helper to log to both console and state store
    private async log(executionId: string, nodeId: string | undefined, level: 'info' | 'warn' | 'error' | 'debug', message: string, metadata?: any): Promise<void> {
        // Console log
        const prefix = `[${level.toUpperCase()}] [${executionId}]${nodeId ? ` [${nodeId}]` : ''}`;
        if (level === 'error') console.error(`${prefix} ${message}`);
        else if (level === 'warn') console.warn(`${prefix} ${message}`);
        else console.log(`${prefix} ${message}`);

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

    // Register a workflow definition
    async registerWorkflow(workflow: WorkflowDefinition): Promise<void> {
        this.workflows.set(workflow.id, workflow);

        // Handle Schedule Triggers
        if (workflow.triggers) {
            for (const trigger of workflow.triggers) {
                if (trigger.type === 'schedule') {
                    const jobId = `schedule:${workflow.id}:${trigger.config.cron}`;

                    try {
                        // Remove existing job to make registration idempotent
                        const existingJobs = await this.queueManager.workflowQueue.getRepeatableJobs();
                        const existingJob = existingJobs.find(job => job.id === jobId);
                        if (existingJob) {
                            await this.queueManager.workflowQueue.removeRepeatableByKey(existingJob.key);
                            console.log(`🔄 Removed existing schedule for workflow ${workflow.id}`);
                        }

                        // Add new repeatable job
                        await this.queueManager.workflowQueue.add(
                            'workflow-execution',
                            { workflowId: workflow.id },
                            {
                                jobId,
                                repeat: {
                                    pattern: trigger.config.cron,
                                    ...(trigger.config.timezone && { tz: trigger.config.timezone }),
                                } as any, // BullMQ RepeatOptions type may not include tz in all versions
                            }
                        );
                        console.log(`⏰ Registered schedule for workflow ${workflow.id}: ${trigger.config.cron}`);
                    } catch (error) {
                        const errorMsg = `Failed to register schedule trigger for workflow ${workflow.id}: ${error instanceof Error ? error.message : String(error)}`;
                        console.error(`❌ ${errorMsg}`);
                        throw new Error(errorMsg);
                    }
                }
            }
        }
    }

    getWorkflow(workflowId: string): WorkflowDefinition | undefined {
        return this.workflows.get(workflowId);
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
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        // Depth limit to prevent infinite recursion
        const MAX_DEPTH = 10;
        if (depth >= MAX_DEPTH) {
            throw new Error(`Maximum sub-workflow depth (${MAX_DEPTH}) exceeded`);
        }

        const executionId = await this.stateStore.createExecution(workflowId, parentExecutionId, depth, initialData);

        // Track metrics
        if (this.metricsCollector) {
            this.metricsCollector.incrementWorkflowsEnqueued();
        }

        // Find all entry nodes (nodes with no inputs)
        const entryNodes = workflow.nodes.filter(node => node.inputs.length === 0);

        // Enqueue all entry nodes, passing parent job reference if this is a sub-workflow
        // Also pass priority and delay options to each node
        for (const node of entryNodes) {
            await this.enqueueNode(executionId, workflowId, node.id, initialData, parentJobId, options);
        }

        await this.log(executionId, undefined, 'info', `Workflow ${workflowId} started (Execution ID: ${executionId})`);
        return executionId;
    }

    // Enqueue a single node execution (for manual/direct node execution)
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
            'run-node',
            { executionId, workflowId, nodeId, inputData },
            jobOpts
        );

        return job.id!;
    }

    // Trigger workflows via webhook path
    async triggerWebhook(path: string, method: string, data: any): Promise<string[]> {
        const triggeredExecutionIds: string[] = [];

        for (const workflow of this.workflows.values()) {
            if (workflow.triggers) {
                for (const trigger of workflow.triggers) {
                    if (trigger.type === 'webhook' && trigger.config.path === path) {
                        // Check method if specified
                        if (trigger.config.method && trigger.config.method !== method) {
                            continue;
                        }

                        console.log(`🔗 Webhook triggered workflow ${workflow.id} (path: ${path})`);
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
    startWorkers(concurrency: number = 5): void {
        this.workerManager.startWorkers(concurrency);
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
        await this.stateStore.setExecutionStatus(executionId, 'cancelled');
        console.log(`🚫 Workflow ${executionId} cancelled`);
    }

    async pauseWorkflow(executionId: string): Promise<void> {
        await this.stateStore.setExecutionStatus(executionId, 'paused');
        console.log(`⏸️ Workflow ${executionId} paused`);
    }

    async resumeWorkflow(executionId: string): Promise<void> {
        await this.stateStore.setExecutionStatus(executionId, 'running');
        console.log(`▶️ Workflow ${executionId} resumed`);
        // We could optionally promote delayed jobs here, but they will retry automatically
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
                console.error(`Failed to enqueue workflow ${wf.workflowId} in bulk:`, error);
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

    // Graceful shutdown
    async close(): Promise<void> {
        console.log('🛑 Shutting down workflow engine...');
        await this.workerManager.close();
        await this.queueManager.close();
        console.log('✓ Workflow engine shutdown complete');
    }
}
