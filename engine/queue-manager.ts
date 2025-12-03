import { Queue, QueueEvents, FlowProducer } from 'bullmq';
import { Redis } from 'ioredis';
import { MetricsCollector } from '../utils/metrics';
import type { NodeJobData, WorkflowJobData, DLQItem } from './types';
import type { IExecutionStateStore } from '../types';

export class QueueManager {
    public nodeQueue: Queue<NodeJobData>;
    public workflowQueue: Queue<WorkflowJobData>;
    public dlqQueue: Queue<DLQItem>;
    public flowProducer: FlowProducer;
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
        });

        this.workflowQueue = new Queue<WorkflowJobData>('workflow-execution', {
            connection: redisConnection,
        });

        this.dlqQueue = new Queue<DLQItem>('dlq-execution', {
            connection: redisConnection,
        });

        // Initialize FlowProducer for parent-child job dependencies
        this.flowProducer = new FlowProducer({
            connection: redisConnection,
        });

        // Initialize queue events for monitoring
        this.nodeQueueEvents = new QueueEvents('node-execution', {
            connection: redisConnection,
        });

        this.workflowQueueEvents = new QueueEvents('workflow-execution', {
            connection: redisConnection,
        });

        // Dedicated QueueEvents for caching results to avoid conflicts
        this.resultCacheEvents = new QueueEvents('node-execution', {
            connection: redisConnection,
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
            console.log(`✓ Node job ${jobId} completed with result:`, returnvalue);
        });

        this.nodeQueueEvents.on('failed', async ({ jobId, failedReason }) => {
            console.error(`✗ Node job ${jobId} failed:`, failedReason);
        });

        this.nodeQueueEvents.on('progress', ({ jobId, data }) => {
            console.log(`⟳ Node job ${jobId} progress:`, data);
        });

        this.workflowQueueEvents.on('completed', ({ jobId }) => {
            console.log(`✓ Workflow job ${jobId} completed`);
        });

        this.workflowQueueEvents.on('failed', ({ jobId, failedReason }) => {
            console.error(`✗ Workflow job ${jobId} failed:`, failedReason);
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
                console.error(`Error caching result for job ${jobId}:`, error);
            }
        });
    }

    async close(): Promise<void> {
        await this.nodeQueue.close();
        await this.workflowQueue.close();
        await this.dlqQueue.close();
        await this.flowProducer.close();
        await this.nodeQueueEvents.close();
        await this.workflowQueueEvents.close();
        await this.resultCacheEvents.close();
    }
}
