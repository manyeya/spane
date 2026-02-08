import type { Redis } from 'ioredis';

/**
 * Lock options for configuring TTL and renewal behavior
 */
export interface LockOptions {
    /** Initial lock TTL in milliseconds (default: 30000) */
    ttl?: number;
    /** Enable automatic lock renewal for long-running operations (default: true) */
    autoRenew?: boolean;
    /** Renewal interval as ratio of TTL (default: 0.5 = renew at 50% of TTL) */
    renewalRatio?: number;
    /** Maximum number of renewal attempts (default: 10) */
    maxRenewals?: number;
    /** Operation type hint for adaptive TTL (default: 'default') */
    operationType?: 'fast' | 'default' | 'long' | 'very-long';
    /** Callback when lock is about to expire */
    onExpiring?: (timeRemaining: number) => void;
}

/**
 * Adaptive TTL presets for different operation types
 */
const TTL_PRESETS: Record<string, number> = {
    'fast': 10000,      // 10s - quick in-memory operations
    'default': 30000,   // 30s - standard node execution
    'long': 120000,     // 2m - I/O intensive operations
    'very-long': 300000 // 5m - batch/aggregate operations
};

/**
 * Distributed lock implementation using Redis
 * Prevents duplicate node execution in multi-instance deployments
 */
export class DistributedLock {
    private readonly lockPrefix = 'lock:';
    private readonly defaultTTL = 30000; // 30 seconds
    private readonly renewalTimers = new Map<string, NodeJS.Timeout>();

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
     * Supports automatic lock renewal for long-running operations
     *
     * @param key Lock key
     * @param fn Function to execute (receives renew function for manual control)
     * @param options Lock configuration options
     * @returns Function result or null if lock not acquired
     */
    async withLock<T>(
        key: string,
        fn: (renew: (newTtl?: number) => Promise<boolean>) => Promise<T>,
        options?: number | LockOptions
    ): Promise<T | null> {
        // Normalize options to object
        const lockOptions: Required<LockOptions> = this.normalizeOptions(options);

        const lockKey = this.lockPrefix + key;
        const token = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        let renewalCount = 0;

        // Use SET NX (set if not exists) with expiration
        const result = await this.redis.set(
            lockKey,
            token,
            'PX', // milliseconds
            lockOptions.ttl,
            'NX' // only set if not exists
        );

        if (result !== 'OK') {
            // Lock already held by another process
            return null;
        }

        // Setup auto-renewal if enabled
        let renewalTimer: NodeJS.Timeout | undefined;

        if (lockOptions.autoRenew) {
            const renewalInterval = lockOptions.ttl * lockOptions.renewalRatio;

            renewalTimer = setInterval(async () => {
                if (renewalCount >= lockOptions.maxRenewals) {
                    clearInterval(renewalTimer!);
                    return;
                }

                const extended = await this.extend(key, token, lockOptions.ttl);
                if (extended) {
                    renewalCount++;
                } else {
                    // Lock was lost - clear timer to prevent further attempts
                    clearInterval(renewalTimer!);
                }
            }, renewalInterval);

            // Store timer for cleanup
            this.renewalTimers.set(key, renewalTimer);
        }

        // Create renew function for manual renewal control
        const renew = async (newTtl?: number): Promise<boolean> => {
            const ttlToUse = newTtl ?? lockOptions.ttl;
            renewalCount++;
            return this.extend(key, token, ttlToUse);
        };

        // Setup expiration warning if callback provided
        let warningTimer: NodeJS.Timeout | undefined;
        if (lockOptions.onExpiring) {
            const warningThreshold = lockOptions.ttl * 0.8; // Warn at 80% of TTL
            warningTimer = setTimeout(() => {
                lockOptions.onExpiring(lockOptions.ttl - warningThreshold);
            }, warningThreshold);
        }

        try {
            const result = await fn(renew);
            return result;
        } finally {
            // Clear renewal timer
            if (renewalTimer) {
                clearInterval(renewalTimer);
                this.renewalTimers.delete(key);
            }

            // Clear warning timer
            if (warningTimer) {
                clearTimeout(warningTimer);
            }

            // Always release lock, even if function throws
            await this.release(key, token);
        }
    }

    /**
     * Normalize options to LockOptions object
     */
    private normalizeOptions(options?: number | LockOptions): Required<LockOptions> {
        const defaultOptions: Required<LockOptions> = {
            ttl: this.defaultTTL,
            autoRenew: true,
            renewalRatio: 0.5,
            maxRenewals: 10,
            operationType: 'default',
            onExpiring: undefined as never
        };

        if (typeof options === 'number') {
            // Legacy: options is just a TTL number
            return { ...defaultOptions, ttl: options };
        }

        if (!options) {
            return defaultOptions;
        }

        // Apply operation type TTL preset if specified
        let ttl = options.ttl ?? defaultOptions.ttl;
        if (options.operationType) {
            const presetTTL = TTL_PRESETS[options.operationType];
            if (presetTTL !== undefined) {
                ttl = presetTTL;
            }
        }

        return {
            ttl,
            autoRenew: options.autoRenew ?? defaultOptions.autoRenew,
            renewalRatio: options.renewalRatio ?? defaultOptions.renewalRatio,
            maxRenewals: options.maxRenewals ?? defaultOptions.maxRenewals,
            operationType: options.operationType ?? defaultOptions.operationType,
            onExpiring: options.onExpiring ?? defaultOptions.onExpiring
        };
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

    /**
     * Get remaining time to live for a lock
     * @param key Lock key
     * @returns Remaining TTL in milliseconds, or -1 if lock doesn't exist
     */
    async getRemainingTTL(key: string): Promise<number> {
        const lockKey = this.lockPrefix + key;
        return await this.redis.pttl(lockKey);
    }

    /**
     * Cancel all pending renewal timers
     * Useful for cleanup on shutdown
     */
    shutdown(): void {
        for (const timer of this.renewalTimers.values()) {
            clearInterval(timer);
        }
        this.renewalTimers.clear();
    }
}
