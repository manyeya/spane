import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function inspect() {
    const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

    console.log('🔍 Scanning for keys starting with "bullmq"...');
    const bullmqKeys = await redis.keys('bullmq*');
    console.log(`Found ${bullmqKeys.length} "bullmq*" keys:`);
    bullmqKeys.slice(0, 20).forEach(k => console.log(` - ${k}`));

    console.log('\n🔍 Scanning for keys starting with "bull"...');
    const bullKeys = await redis.keys('bull*');
    console.log(`Found ${bullKeys.length} "bull*" keys:`);
    bullKeys.slice(0, 20).forEach(k => console.log(` - ${k}`));

    await redis.quit();
}

inspect().catch(console.error);
