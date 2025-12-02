import { Worker, Job, DelayedError } from 'bullmq';
import { Redis } from 'ioredis';
import { MetricsCollector } from '../metrics';
import type { NodeJobData, WorkflowJobData } from './types';
import { NodeProcessor, type EnqueueWorkflowFn } from './node-processor';
import { DLQManager } from './dlq-manager';
import type { IExecutionStateStore } from '../types';

export class WorkerManager {
    public nodeWorker?: Worker<NodeJobData>;
    public workflowWorker?: Worker<WorkflowJobData>;

    constructor(
        private redisConnection: Redis,
        private nodeProcessor: NodeProcessor,
        private dlqManager: DLQManager,
        private stateStore: IExecutionStateStore,
        private enqueueWorkflow: EnqueueWorkflowFn,
        private metricsCollector?: MetricsCollector
    ) { }

    // Start worker processes
    startWorkers(concurrency: number = 5): void {
        // Worker for individual node execution
        this.nodeWorker = new Worker<NodeJobData>(
            'node-execution',
            async (job: Job<NodeJobData>) => {
                await job.updateProgress(0);
                console.log(`🚀 Processing node job ${job.id} of type ${job.name}`);
                const result = await this.nodeProcessor.processNodeJob(job.data, job);
                await job.updateProgress(100);
                return result;
            },
            {
                connection: this.redisConnection,
                concurrency,
            }
        );

        // Worker for workflow orchestration (if needed for non-flow workflows)
        this.workflowWorker = new Worker<WorkflowJobData>(
            'workflow-execution',
            async (job: Job<WorkflowJobData>) => {
                console.log(`⏰ Processing workflow job ${job.id} for ${job.data.workflowId}`);
                // Start a new execution for this workflow
                await this.enqueueWorkflow(job.data.workflowId, job.data.initialData);
            },
            {
                connection: this.redisConnection,
                concurrency: Math.max(1, Math.floor(concurrency / 2)),
            }
        );

        this.nodeWorker.on('completed', (job) => {
            console.log(`✓ Node worker completed job ${job.id}`);

            // Track metrics
            if (this.metricsCollector) {
                this.metricsCollector.incrementNodesExecuted();
            }
        });

        this.nodeWorker.on('failed', async (job, err) => {
            // Ignore DelayedError (used for pause/rate-limit)
            if (err instanceof DelayedError || err.name === 'DelayedError') {
                return;
            }

            console.error(`✗ Node worker failed job ${job?.id}:`, err.message);

            if (job) {
                // Check if we have exhausted all attempts
                if (job.attemptsMade >= (job.opts.attempts || 1)) {
                    console.log(`💀 Job ${job.id} has exhausted all retries. Moving to DLQ.`);

                    try {
                        await this.dlqManager.moveToDLQ(job, err);

                        // Track metrics - only count permanent failures
                        if (this.metricsCollector) {
                            this.metricsCollector.incrementNodesFailed();
                            this.metricsCollector.incrementDLQItems();
                            // Note: workflowsFailed is counted in checkWorkflowCompletion to avoid double counting
                        }

                        // Propagate error to workflow status
                        const { executionId, nodeId } = job.data;
                        await this.stateStore.updateNodeResult(executionId, nodeId, {
                            success: false,
                            error: err.message
                        });

                        await this.nodeProcessor.handleWorkflowError(executionId, err.message);
                    } catch (dlqError) {
                        console.error(`CRITICAL: Failed to process DLQ/State update for job ${job.id} (Execution: ${job.data.executionId}):`, dlqError);
                        // Do not rethrow to prevent crashing the worker listener
                    }
                }
            }
        });

        this.nodeWorker.on('progress', (job, progress) => {
            console.log(`⟳ Node job ${job.id} at ${progress}%`);
        });

        this.workflowWorker.on('completed', (job) => {
            console.log(`✓ Workflow worker completed job ${job.id}`);
        });

        this.workflowWorker.on('failed', (job, err) => {
            console.error(`✗ Workflow worker failed job ${job?.id}:`, err.message);
        });

        console.log(`👷 Workers started with concurrency: ${concurrency}`);
    }

    async close(): Promise<void> {
        if (this.nodeWorker) {
            await this.nodeWorker.close();
        }
        if (this.workflowWorker) {
            await this.workflowWorker.close();
        }
    }
}
