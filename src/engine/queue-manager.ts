import { Queue, QueueEvents, FlowProducer } from 'bullmq';
import { Redis } from 'ioredis';
import { MetricsCollector } from '../utils/metrics';
import type { NodeJobData, WorkflowJobData, DLQItem } from './types';
import type { IExecutionStateStore } from '../types';
import { logger } from '../utils/logger';

export class QueueManager {
    public nodeQueue: Queue<NodeJobData>;
    public workflowQueue: Queue<WorkflowJobData>;
    public dlqQueue: Queue<DLQItem>;
    public nodeQueueEvents: QueueEvents;
    public resultCacheEvents: QueueEvents;
    public flowProducer!: FlowProducer;

    constructor(
        redisConnection: Redis,
        private stateStore: IExecutionStateStore,
        private metricsCollector?: MetricsCollector
    ) {
        // Initialize queues
        this.nodeQueue = new Queue<NodeJobData>('node-execution', {
            connection: redisConnection,
            prefix: 'spane',
            defaultJobOptions: {
                removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
                removeOnFail: { count: 500 },     // Keep last 500 failed jobs for debugging
            },
        });

        this.workflowQueue = new Queue<WorkflowJobData>('workflow-execution', {
            connection: redisConnection,
            prefix: 'spane',
            defaultJobOptions: {
                removeOnComplete: { age: 3600, count: 50 }, // Keep 1 hour or 50 jobs
                removeOnFail: { age: 86400 * 7 },           // Keep failed for 1 week
            },
        });

        this.dlqQueue = new Queue<DLQItem>('dlq-execution', {
            connection: redisConnection,
            prefix: 'spane',
        });

        // Initialize queue events for monitoring
        this.nodeQueueEvents = new QueueEvents('node-execution', {
            connection: redisConnection,
            prefix: 'spane',
        });

        // Dedicated QueueEvents for caching results to avoid conflicts
        this.resultCacheEvents = new QueueEvents('node-execution', {
            connection: redisConnection,
            prefix: '{spane}',
        });

        // Initialize FlowProducer for sub-workflow handling
        this.flowProducer = new FlowProducer({
            connection: redisConnection,
            prefix: 'spane',
        });

        this.setupQueueEventListeners();

        // Register queues with metrics collector if available
        if (this.metricsCollector) {
            this.metricsCollector.registerQueue(this.nodeQueue);
            this.metricsCollector.registerQueue(this.workflowQueue);
            this.metricsCollector.registerQueue(this.dlqQueue);
        }
    }

    private setupQueueEventListeners(): void {
        this.nodeQueueEvents.on('completed', ({ jobId, returnvalue }) => {
            logger.info({ jobId, returnvalue }, `✓ Node job ${jobId} completed`);
        });

        this.nodeQueueEvents.on('failed', async ({ jobId, failedReason }) => {
            logger.error({ jobId, failedReason }, `✗ Node job ${jobId} failed`);
        });

        this.nodeQueueEvents.on('progress', ({ jobId, data }) => {
            logger.debug({ jobId, data }, `⟳ Node job ${jobId} progress`);
        });

        // --- Result Caching Listener ---
        this.resultCacheEvents.on('completed', async ({ jobId, returnvalue }) => {
            try {
                const job = await this.nodeQueue.getJob(jobId);
                if (job && job.data) {
                    const { executionId, nodeId } = job.data;
                    // The returnvalue is the ExecutionResult, already in the correct format.
                    // BullMQ might return it as string if it's from Redis
                    const result = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;

                    // Skip caching for delay node initial step results.
                    // When a delay node first processes, it returns { success: true, data: { delayed: true, ... } }
                    // and enqueues a resumed job. We should NOT cache this intermediate result because:
                    // 1. It would cause getPendingNodeCount to count the node as "completed"
                    // 2. The actual completion happens when the resumed job runs after the delay expires
                    // The resumed job will save the final result via updateNodeResult in processDelayNode.
                    if (result?.data?.delayed === true) {
                        logger.debug({ jobId, executionId, nodeId }, `Skipping cache for delay node initial step`);
                        return;
                    }

                    await this.stateStore.cacheNodeResult(executionId, nodeId, result);
                }
            } catch (error) {
                logger.error({ jobId, error }, `Error caching result for job ${jobId}`);
            }
        });
    }

    async close(): Promise<void> {
        await this.nodeQueue.close();
        await this.workflowQueue.close();
        await this.dlqQueue.close();
        await this.nodeQueueEvents.close();
        await this.resultCacheEvents.close();
        await this.flowProducer.close();
    }

    /**
     * Trigger manual rate limiting for the node execution queue.
     * 
     * This method should be called when an external API returns a rate limit response
     * (e.g., HTTP 429). After calling this method, the caller MUST throw RateLimitError
     * to properly move the job back to the waiting queue.
     * 
     * Note: The worker must have a limiter.max option configured for this to work.
     * 
     * @param duration - Duration in milliseconds to rate limit
     * 
     * @example
     * ```typescript
     * // In a node executor when receiving HTTP 429:
     * if (response.status === 429) {
     *     const retryAfter = parseInt(response.headers['retry-after'] || '60', 10) * 1000;
     *     await queueManager.rateLimit(retryAfter);
     *     throw new RateLimitError();
     * }
     * ```
     */
    async rateLimit(duration: number): Promise<void> {
        logger.info({ duration }, `🚦 Manual rate limit triggered for ${duration}ms`);
        await this.nodeQueue.rateLimit(duration);
    }
}
