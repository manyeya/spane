import { Redis } from 'ioredis';

const DEFAULT_TTL = 86400; // 24 hours in seconds

async function fixRedisTTL() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
    });

    console.log('Scanning for execution keys...');
    
    let cursor = '0';
    let fixed = 0;
    let deleted = 0;
    let orphaned = 0;
    
    // Track all execution IDs that have a main key
    const activeExecutionIds = new Set<string>();
    
    // First pass: find all main execution keys
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'exec:*', 'COUNT', 100);
        cursor = nextCursor;
        
        for (const key of keys) {
            // Only process main execution keys (no colons after exec:)
            if (key.match(/^exec:exec_[^:]+$/)) {
                const executionId = key.replace('exec:', '');
                activeExecutionIds.add(executionId);
            }
        }
    } while (cursor !== '0');
    
    // Second pass: process all keys
    cursor = '0';
    do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'exec:*', 'COUNT', 100);
        cursor = nextCursor;
        
        for (const key of keys) {
            // Check if this is a main execution key
            if (key.match(/^exec:exec_[^:]+$/)) {
                const executionId = key.replace('exec:', '');
                const ttl = await redis.ttl(key);
                const status = await redis.hget(key, 'status');
                
                console.log(`Found: ${executionId} (status: ${status}, TTL: ${ttl}s)`);
                
                if (status === 'completed' || status === 'failed' || status === 'cancelled') {
                    // Terminal status - should have been cleaned up, delete it
                    console.log(`  -> Deleting (terminal status should not be in Redis)`);
                    await redis.del(
                        `exec:${executionId}`,
                        `exec:${executionId}:results`,
                        `exec:${executionId}:logs`,
                        `exec:${executionId}:spans`
                    );
                    deleted++;
                } else if (ttl === -1) {
                    // Active execution with no TTL - set TTL
                    console.log(`  -> Setting TTL (was unlimited)`);
                    await redis.expire(key, DEFAULT_TTL);
                    await redis.expire(`exec:${executionId}:results`, DEFAULT_TTL);
                    await redis.expire(`exec:${executionId}:logs`, DEFAULT_TTL);
                    await redis.expire(`exec:${executionId}:spans`, DEFAULT_TTL);
                    fixed++;
                }
            } else {
                // This is a sub-key (results, logs, spans)
                // Check if the main execution key exists
                const match = key.match(/^exec:(exec_[^:]+):/);
                if (match) {
                    const executionId = match[1];
                    if (!activeExecutionIds.has(executionId!)) {
                        // Orphaned sub-key - main execution key doesn't exist
                        console.log(`Orphaned key: ${key} (main key missing)`);
                        await redis.del(key);
                        orphaned++;
                    }
                }
            }
        }
    } while (cursor !== '0');

    console.log(`\nDone. Fixed TTL on ${fixed} keys, deleted ${deleted} completed executions, removed ${orphaned} orphaned keys.`);
    await redis.quit();
}

fixRedisTTL().catch(console.error);
