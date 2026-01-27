import { Job } from 'bullmq';
import { QueueManager } from './queue-manager';
import type { DLQItem, NodeJobData } from './types';
import { DEFAULT_DLQ_FETCH_SIZE, DEFAULT_RETRY_DELAY_MS } from './constants';

export class DLQManager {
    constructor(private queueManager: QueueManager) { }

    // Move failed job to Dead Letter Queue
    async moveToDLQ(job: Job<NodeJobData>, error: Error): Promise<void> {
        const dlqItem: DLQItem = {
            jobId: job.id!,
            data: job.data,
            failedReason: error.message,
            timestamp: Date.now(),
            stacktrace: job.stacktrace,
        };
        await this.queueManager.dlqQueue.add('dlq-item', dlqItem);
    }

    // Get items from DLQ
    async getDLQItems(start: number = 0, end: number = DEFAULT_DLQ_FETCH_SIZE): Promise<DLQItem[]> {
        // BullMQ doesn't store job data in the queue directly in a way that we can list easily without fetching jobs
        // But since we are adding 'dlq-item' jobs to dlqQueue, we can fetch them.
        const jobs = await this.queueManager.dlqQueue.getJobs(['waiting', 'active', 'delayed', 'paused'], start, end);
        return jobs.map(j => j.data);
    }

    // Retry a job from DLQ
    async retryDLQItem(dlqJobId: string): Promise<boolean> {
        const dlqJob = await this.queueManager.dlqQueue.getJob(dlqJobId);
        if (!dlqJob) return false;

        // dlqJob.data is DLQItem, which contains .data as NodeJobData
        const dlqItem: DLQItem = dlqJob.data;
        const nodeJobData: NodeJobData = dlqItem.data;

        // Re-queue the original job with correct job name 'process-node'
        // Preserves all original job data fields including sub-workflow state
        await this.queueManager.nodeQueue.add('process-node', nodeJobData, {
            jobId: `${nodeJobData.executionId}-${nodeJobData.nodeId}-retry-${Date.now()}`,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: DEFAULT_RETRY_DELAY_MS,
            },
        });

        // Remove from DLQ
        await dlqJob.remove();
        return true;
    }
}
