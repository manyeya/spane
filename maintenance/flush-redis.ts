import { Redis } from 'ioredis';

async function flush() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
    });

    console.log('Flushing Redis...');
    await redis.flushall();
    console.log('Done.');
    await redis.quit();
}

flush().catch(console.error);
