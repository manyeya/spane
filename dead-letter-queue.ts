import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { DLQJobData, IDeadLetterQueueManager, RetryPolicy } from './types';

export class DeadLetterQueueManager implements IDeadLetterQueueManager {
  private dlqQueue: Queue<DLQJobData>;
  private dlqWorker?: Worker<DLQJobData>;

  constructor(
    private redisConnection: Redis,
    private retryPolicy: RetryPolicy = {
      maxRetries: 3,
      backoffStrategy: 'exponential',
      baseDelay: 1000,
      maxDelay: 30000,
    },
    private nodeQueue?: Queue<any>
  ) {
    this.dlqQueue = new Queue<DLQJobData>('dead-letter-queue', {
      connection: redisConnection,
    });
  }

  setNodeQueue(nodeQueue: Queue<any>): void {
    this.nodeQueue = nodeQueue;
  }

  async addToDLQ(jobData: DLQJobData): Promise<void> {
    const job = await this.dlqQueue.add(
      'dlq-job',
      jobData,
      {
        jobId: `${jobData.executionId}-${jobData.nodeId}-dlq`,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );

    console.log(`📨 Job ${jobData.executionId}-${jobData.nodeId} added to DLQ (job ID: ${job.id})`);
  }

  async retryFromDLQ(executionId: string, nodeId: string): Promise<boolean> {
    const dlqJobId = `${executionId}-${nodeId}-dlq`;
    
    try {
      const job = await this.dlqQueue.getJob(dlqJobId);
      if (!job) {
        console.log(`❌ No DLQ job found for ${executionId}-${nodeId}`);
        return false;
      }

      const jobData = job.data as DLQJobData;
      
      // Allow one retry from DLQ even if max retries was exceeded
      // This gives manual intervention capability
      console.log(`🔄 Retrying job ${executionId}-${nodeId} from DLQ (previous failures: ${jobData.failureCount})`);

      if (!this.nodeQueue) {
        console.error(`❌ Node queue not available for retry - cannot re-queue job ${executionId}-${nodeId}`);
        return false;
      }

      // Calculate retry delay (shorter for DLQ retries)
      const delay = 1000; // Fixed 1 second delay for DLQ retries
      
      // Re-queue to original node queue with delay before removing from DLQ
      const retryJob = await this.nodeQueue.add(
        'run-node',
        jobData.originalJobData,
        {
          jobId: `${executionId}-${nodeId}-dlq-retry-${Date.now()}`,
          delay,
          attempts: 1, // Single attempt for DLQ retry
        }
      );
      
      // Remove from DLQ only after successfully re-queuing
      await job.remove();
      
      console.log(`🔄 Retried job ${executionId}-${nodeId} from DLQ with new job ID: ${retryJob.id}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to retry DLQ job ${executionId}-${nodeId}:`, error);
      return false;
    }
  }

  async getDLQJobs(executionId?: string): Promise<DLQJobData[]> {
    const jobs = await this.dlqQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
    
    const dlqJobs: DLQJobData[] = [];
    
    for (const job of jobs) {
      const jobData = job.data as DLQJobData;
      
      if (!executionId || jobData.executionId === executionId) {
        dlqJobs.push(jobData);
      }
    }
    
    return dlqJobs;
  }

  async purgeDLQJob(executionId: string, nodeId: string): Promise<boolean> {
    const dlqJobId = `${executionId}-${nodeId}-dlq`;
    
    try {
      const job = await this.dlqQueue.getJob(dlqJobId);
      if (job) {
        await job.remove();
        console.log(`🗑️  DLQ job ${executionId}-${nodeId} purged`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ Failed to purge DLQ job ${executionId}-${nodeId}:`, error);
      return false;
    }
  }

  private calculateRetryDelay(failureCount: number): number {
    const { baseDelay, maxDelay, backoffStrategy } = this.retryPolicy;
    
    let delay: number;
    
    switch (backoffStrategy) {
      case 'exponential':
        delay = baseDelay * Math.pow(2, failureCount);
        break;
      case 'linear':
        delay = baseDelay * (failureCount + 1);
        break;
      case 'fixed':
      default:
        delay = baseDelay;
        break;
    }
    
    return maxDelay ? Math.min(delay, maxDelay) : delay;
  }

  async startDLQWorker(): Promise<void> {
    this.dlqWorker = new Worker<DLQJobData>(
      'dead-letter-queue',
      async (job: Job<DLQJobData>) => {
        const jobData = job.data;
        console.log(`🔍 Processing DLQ job: ${jobData.executionId}-${jobData.nodeId}`);
        
        // This worker can be used for automatic retry processing,
        // monitoring, or manual intervention workflows
        
        await job.updateProgress(100);
        return { processed: true };
      },
      {
        connection: this.redisConnection,
        concurrency: 1,
      }
    );

    this.dlqWorker.on('completed', (job) => {
      console.log(`✓ DLQ worker completed job ${job.id}`);
    });

    this.dlqWorker.on('failed', (job, err) => {
      console.error(`✗ DLQ worker failed job ${job?.id}:`, err.message);
    });

    console.log('👷 DLQ worker started');
  }

  async getDLQStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.dlqQueue.getWaitingCount(),
      this.dlqQueue.getActiveCount(),
      this.dlqQueue.getCompletedCount(),
      this.dlqQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }

  async close(): Promise<void> {
    console.log('🛑 Shutting down DLQ manager...');
    
    await this.dlqWorker?.close();
    await this.dlqQueue.close();
    
    console.log('✓ DLQ manager shutdown complete');
  }
}
