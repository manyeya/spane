import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function cleanup() {
    console.log(`🔌 Connecting to Redis at ${REDIS_URL}...`);
    const redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null,
    });

    const queues = [
        new Queue('node-execution', { connection: redis, prefix: 'spane' }),
        new Queue('workflow-execution', { connection: redis, prefix: 'spane' }),
        new Queue('dlq-execution', { connection: redis, prefix: 'spane' }),
    ];

    console.log('🧹 Starting cleanup of old jobs from queues...');

    for (const queue of queues) {
        console.log(`\n📂 Queue: ${queue.name}`);

        // Clean completed jobs
        // 0 grace period means remove ALL completed jobs (except those protected by lock duration? no, just all)
        // Adjust grace period if needed. For "obliterate indefinitely remaining stuff", 0 or small is good.
        // But let's use a small grace period (e.g., 10 seconds) just in case users are looking at very recent stuff.
        // Actually, user wants to clean 'indefinite' stuff.
        // clean() removes jobs that have finished > grace period ago.

        try {
            console.log('   - Cleaning completed jobs older than 1 hour...');
            const completed = await queue.clean(3600 * 1000, 1000, 'completed'); // 1 hour grace, max 1000 per batch
            console.log(`     ✅ Removed ${completed.length} completed jobs.`);

            // If there are many, we might need loop, but clean() is often one-shot. 
            // BullMQ docs say: "Cleans jobs from a queue. Wrapper around cleanJobs"

            console.log('   - Cleaning failed jobs older than 24 hours...');
            const failed = await queue.clean(86400 * 1000, 1000, 'failed');
            console.log(`     ✅ Removed ${failed.length} failed jobs.`);

            // Also check counts
            const counts = await queue.getJobCounts('completed', 'failed', 'active', 'waiting', 'delayed');
            console.log('   - Current Status:', counts);


            const completedCount = counts.completed || 0;
            const failedCount = counts.failed || 0;

            if (completedCount > 1000 || failedCount > 1000) {
                console.log('     ⚠️  High volume of jobs remaining. You may need to run this script again or reduce retention window.');
            }

        } catch (error) {
            console.error(`   ❌ Error cleaning queue ${queue.name}:`, error);
        }
    }

    console.log('\n✨ Cleanup complete.');

    // Close connections
    for (const queue of queues) {
        await queue.close();
    }
    await redis.quit();
}

cleanup().catch((err) => {
    console.error('Fatal error during cleanup:', err);
    process.exit(1);
});
