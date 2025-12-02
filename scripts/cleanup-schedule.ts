import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

async function cleanup() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
    });

    const workflowQueue = new Queue('workflow-execution', { connection: redis });

    console.log('Cleaning up repeatable jobs...');
    const jobs = await workflowQueue.getRepeatableJobs();

    for (const job of jobs) {
        console.log(`Removing job: ${job.key} (id: ${job.id})`);
        await workflowQueue.removeRepeatableByKey(job.key);
    }

    console.log('Done.');
    await workflowQueue.close();
    await redis.quit();
}

cleanup().catch(console.error);
