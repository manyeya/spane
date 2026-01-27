import { Worker, Job, DelayedError, RateLimitError } from 'bullmq';
import { Redis } from 'ioredis';

import { MetricsCollector } from '../utils/metrics';
import type { NodeJobData, WorkflowJobData } from './types';
import { NodeProcessor, type EnqueueWorkflowFn } from './node-processor';
import { DLQManager } from './dlq-manager';
import type { IExecutionStateStore } from '../types';
import { logger } from '../utils/logger';
import type { EngineConfig } from './config';
import { DEFAULT_WORKER_CONCURRENCY, PROGRESS_START, PROGRESS_COMPLETE } from './constants';

// Re-export RateLimitError for external use (e.g., in node executors)
export { RateLimitError };

/**
 * Check if an error is a RateLimitError from BullMQ.
 * RateLimitError is thrown when manual rate limiting is triggered via worker.rateLimit().
 * This error should not be treated as a job failure - the job will be moved back to waiting.
 */
export function isRateLimitError(err: Error): boolean {
    // Check by name since RateLimitError might be thrown as Worker.RateLimitError()
    return err.name === 'RateLimitError' || err instanceof RateLimitError;
}

export class WorkerManager {
    public nodeWorker?: Worker<NodeJobData>;
    public workflowWorker?: Worker<WorkflowJobData>;
    private config?: EngineConfig;

    constructor(
        private redisConnection: Redis,
        private nodeProcessor: NodeProcessor,
        private dlqManager: DLQManager,
        private stateStore: IExecutionStateStore,
        private enqueueWorkflow: EnqueueWorkflowFn,
        private metricsCollector?: MetricsCollector,
        config?: EngineConfig
    ) {
        this.config = config;
    }

    // Start worker processes
    startWorkers(concurrency?: number): void {
        // Use config values with fallbacks
        const workerConcurrency = concurrency ?? this.config?.workerConcurrency ?? DEFAULT_WORKER_CONCURRENCY;

        // Build worker options
        const nodeWorkerOptions: any = {
            connection: this.redisConnection,
            concurrency: workerConcurrency,
            prefix: 'spane',
        };

        // Add native rate limiting if configured
        if (this.config?.useNativeRateLimiting && this.config?.rateLimiter) {
            nodeWorkerOptions.limiter = {
                max: this.config.rateLimiter.max,
                duration: this.config.rateLimiter.duration,
            };
            logger.info(
                { max: this.config.rateLimiter.max, duration: this.config.rateLimiter.duration },
                '🚦 Native rate limiting enabled'
            );
        }



        // Worker for individual node execution
        // When processorPath is provided, BullMQ runs the processor in a separate worker thread
        // Otherwise, use inline processor function
        this.nodeWorker = new Worker<NodeJobData>(
            'node-execution',
            async (job: Job<NodeJobData>) => {
                await job.updateProgress(PROGRESS_START);
                logger.info({ jobId: job.id, jobName: job.name }, `🚀 Processing node job ${job.id} of type ${job.name}`);
                const result = await this.nodeProcessor.processNodeJob(job.data, job);
                await job.updateProgress(PROGRESS_COMPLETE);
                return result;
            },
            nodeWorkerOptions
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
                concurrency: Math.max(1, Math.floor(workerConcurrency / 2)),
                prefix: 'spane',
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

            // Ignore RateLimitError (used for manual rate limiting)
            // When Worker.RateLimitError() is thrown, the job is moved back to waiting, not failed
            if (isRateLimitError(err)) {
                logger.debug({ jobId: job?.id }, `⏳ Job ${job?.id} rate limited, will be retried`);
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

        // Handle worker-level errors (including sandbox/worker thread crashes)
        // This is CRITICAL - without this handler, errors can cause the worker to stop processing
        this.nodeWorker.on('error', (err) => {
            logger.error(
                { error: err.message, stack: err.stack },
                '⚠️ Node worker error occurred'
            );

            // Note: BullMQ will automatically recover from most errors
            // The worker continues to process jobs after emitting the error event
            // Jobs that were being processed when the error occurred will be
            // moved to failed or stalled state depending on the error type
        });

        // Handle stalled jobs - these can occur when sandbox processes crash mid-execution
        // A job becomes stalled when the worker processing it crashes or loses connection
        // before completing the job, and the lock expires
        this.nodeWorker.on('stalled', async (jobId, prev) => {
            logger.warn(
                {
                    jobId,
                    previousState: prev
                },
                `⚠️ Job ${jobId} stalled (previous state: ${prev})`
            );
        });

        this.workflowWorker.on('completed', (job) => {
            logger.info({ jobId: job.id }, `✓ Workflow worker completed job ${job.id}`);
        });

        this.workflowWorker.on('failed', (job, err) => {
            logger.error({ jobId: job?.id, error: err.message }, `✗ Workflow worker failed job ${job?.id}`);
        });

        // Handle workflow worker errors to prevent unhandled exceptions
        this.workflowWorker.on('error', (err) => {
            logger.error(
                { error: err.message, stack: err.stack },
                '⚠️ Workflow worker error occurred'
            );
        });

        logger.info({ concurrency: workerConcurrency }, `👷 Workers started with concurrency: ${workerConcurrency}`);
    }

    async close(): Promise<void> {
        if (this.nodeWorker) {
            await this.nodeWorker.close();
        }
        if (this.workflowWorker) {
            await this.workflowWorker.close();
        }
    }

    /**
     * Get the RateLimitError class for throwing after calling queue.rateLimit().
     * This is a convenience method to access Worker.RateLimitError.
     * 
     * Note: Manual rate limiting should be done via QueueManager.rateLimit() method,
     * then throw this error to move the job back to waiting.
     * 
     * @returns A new RateLimitError instance
     */
    static getRateLimitError(): Error {
        return Worker.RateLimitError();
    }
}
