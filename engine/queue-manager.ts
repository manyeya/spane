import { Queue, QueueEvents } from 'bullmq';
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
    public workflowQueueEvents: QueueEvents;
    public resultCacheEvents: QueueEvents;

    constructor(
        private redisConnection: Redis,
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

        this.workflowQueueEvents = new QueueEvents('workflow-execution', {
            connection: redisConnection,
            prefix: 'spane',
        });

        // Dedicated QueueEvents for caching results to avoid conflicts
        this.resultCacheEvents = new QueueEvents('node-execution', {
            connection: redisConnection,
            prefix: '{spane}',
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

        this.workflowQueueEvents.on('completed', ({ jobId }) => {
            logger.info({ jobId }, `✓ Workflow job ${jobId} completed`);
        });

        this.workflowQueueEvents.on('failed', ({ jobId, failedReason }) => {
            logger.error({ jobId, failedReason }, `✗ Workflow job ${jobId} failed`);
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
        await this.workflowQueueEvents.close();
        await this.resultCacheEvents.close();
    }
}
