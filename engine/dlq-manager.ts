import { Job } from 'bullmq';
import { QueueManager } from './queue-manager';
import type { DLQItem, NodeJobData } from './types';

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
    async getDLQItems(start: number = 0, end: number = 10): Promise<DLQItem[]> {
        // BullMQ doesn't store job data in the queue directly in a way that we can list easily without fetching jobs
        // But since we are adding 'dlq-item' jobs to dlqQueue, we can fetch them.
        const jobs = await this.queueManager.dlqQueue.getJobs(['waiting', 'active', 'delayed', 'paused'], start, end);
        return jobs.map(j => j.data);
    }

    // Retry a job from DLQ
    async retryDLQItem(dlqJobId: string): Promise<boolean> {
        const dlqJob = await this.queueManager.dlqQueue.getJob(dlqJobId);
        if (!dlqJob) return false;

        const { data } = dlqJob.data;

        // Re-queue the original job
        await this.queueManager.nodeQueue.add('run-node', data, {
            jobId: data.executionId + '-' + data.nodeId + '-retry-' + Date.now(), // New Job ID to avoid collision
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        });

        // Remove from DLQ
        await dlqJob.remove();
        return true;
    }
}
