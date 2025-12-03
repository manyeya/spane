import type { Redis } from 'ioredis';

/**
 * Distributed lock implementation using Redis
 * Prevents duplicate node execution in multi-instance deployments
 */
export class DistributedLock {
    private readonly lockPrefix = 'lock:';
    private readonly defaultTTL = 30000; // 30 seconds

    constructor(private redis: Redis) { }

    /**
     * Acquire a distributed lock
     * @param key Lock key (e.g., 'node:executionId:nodeId')
     * @param ttl Lock TTL in milliseconds (default: 30s)
     * @returns Lock token if acquired, null if lock already held
     */
    async acquire(key: string, ttl: number = this.defaultTTL): Promise<string | null> {
        const lockKey = this.lockPrefix + key;
        const token = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Use SET NX (set if not exists) with expiration
        const result = await this.redis.set(
            lockKey,
            token,
            'PX', // milliseconds
            ttl,
            'NX' // only set if not exists
        );

        return result === 'OK' ? token : null;
    }

    /**
     * Release a distributed lock
     * @param key Lock key
     * @param token Lock token (from acquire)
     * @returns true if released, false if lock not held or token mismatch
     */
    async release(key: string, token: string): Promise<boolean> {
        const lockKey = this.lockPrefix + key;

        // Lua script for atomic check-and-delete
        const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

        const result = await this.redis.eval(script, 1, lockKey, token);
        return result === 1;
    }

    /**
     * Extend lock TTL (for long-running operations)
     * @param key Lock key
     * @param token Lock token
     * @param ttl New TTL in milliseconds
     * @returns true if extended, false if lock not held or token mismatch
     */
    async extend(key: string, token: string, ttl: number): Promise<boolean> {
        const lockKey = this.lockPrefix + key;

        // Lua script for atomic check-and-extend
        const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

        const result = await this.redis.eval(script, 1, lockKey, token, ttl);
        return result === 1;
    }

    /**
     * Execute a function with a distributed lock
     * Automatically acquires lock, executes function, and releases lock
     * @param key Lock key
     * @param fn Function to execute
     * @param ttl Lock TTL in milliseconds
     * @returns Function result or null if lock not acquired
     */
    async withLock<T>(
        key: string,
        fn: () => Promise<T>,
        ttl: number = this.defaultTTL
    ): Promise<T | null> {
        const token = await this.acquire(key, ttl);

        if (!token) {
            // Lock already held by another process
            return null;
        }

        try {
            const result = await fn();
            return result;
        } finally {
            // Always release lock, even if function throws
            await this.release(key, token);
        }
    }

    /**
     * Check if a lock is currently held
     * @param key Lock key
     * @returns true if lock exists
     */
    async isLocked(key: string): Promise<boolean> {
        const lockKey = this.lockPrefix + key;
        const exists = await this.redis.exists(lockKey);
        return exists === 1;
    }
}
