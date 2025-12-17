import { Worker, Job, DelayedError } from 'bullmq';
import { Redis } from 'ioredis';
import { MetricsCollector } from '../utils/metrics';
import type { NodeJobData, WorkflowJobData } from './types';
import { NodeProcessor, type EnqueueWorkflowFn } from './node-processor';
import { DLQManager } from './dlq-manager';
import type { IExecutionStateStore } from '../types';
import { logger } from '../utils/logger';

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
                logger.info({ jobId: job.id, jobName: job.name }, `🚀 Processing node job ${job.id} of type ${job.name}`);
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
                logger.info({ jobId: job.id, workflowId: job.data.workflowId }, `⏰ Processing workflow job ${job.id} for ${job.data.workflowId}`);
                // Start a new execution for this workflow
                await this.enqueueWorkflow(job.data.workflowId, job.data.initialData);
            },
            {
                connection: this.redisConnection,
                concurrency: Math.max(1, Math.floor(concurrency / 2)),
            }
        );

        this.nodeWorker.on('completed', (job) => {
            logger.info({ jobId: job.id }, `✓ Node worker completed job ${job.id}`);

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

            logger.error({ jobId: job?.id, error: err.message }, `✗ Node worker failed job ${job?.id}`);

            if (job) {
                // Check if we have exhausted all attempts
                if (job.attemptsMade >= (job.opts.attempts || 1)) {
                    logger.warn({ jobId: job.id }, `💀 Job ${job.id} has exhausted all retries. Moving to DLQ.`);

                    const { executionId, nodeId } = job.data;

                    try {
                        // Use transactional method for atomic DLQ + state update + error log
                        // Check if stateStore supports handlePermanentFailure (DrizzleStore)
                        if ('handlePermanentFailure' in this.stateStore && typeof (this.stateStore as any).handlePermanentFailure === 'function') {
                            await (this.stateStore as any).handlePermanentFailure(
                                executionId,
                                nodeId,
                                job.data,
                                err.message,
                                job.attemptsMade
                            );
                        } else {
                            // Fallback for InMemoryStore (non-transactional)
                            await this.dlqManager.moveToDLQ(job, err);
                            await this.stateStore.updateNodeResult(executionId, nodeId, {
                                success: false,
                                error: err.message
                            });
                        }

                        // Track metrics - only count permanent failures
                        if (this.metricsCollector) {
                            this.metricsCollector.incrementNodesFailed();
                            this.metricsCollector.incrementDLQItems();
                        }

                        // Propagate error to workflow status
                        const { workflowId } = job.data;
                        await this.nodeProcessor.handleWorkflowError(executionId, workflowId, err, job);
                    } catch (criticalError) {
                        logger.error({ jobId: job.id, executionId, error: criticalError }, `CRITICAL: Permanent failure handling failed for job ${job.id}`);
                        // Log to external monitoring system if available
                        // TODO: Send to external alerting system (e.g., Sentry, DataDog)
                    }
                }
            }
        });

        this.nodeWorker.on('progress', (job, progress) => {
            logger.debug({ jobId: job.id, progress }, `⟳ Node job ${job.id} at ${progress}%`);
        });

        this.workflowWorker.on('completed', (job) => {
            logger.info({ jobId: job.id }, `✓ Workflow worker completed job ${job.id}`);
        });

        this.workflowWorker.on('failed', (job, err) => {
            logger.error({ jobId: job?.id, error: err.message }, `✗ Workflow worker failed job ${job?.id}`);
        });

        logger.info({ concurrency }, `👷 Workers started with concurrency: ${concurrency}`);
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
