/**
 * Engine Configuration Interface
 * 
 * Provides feature flags and configuration options for the BullMQ workflow engine.
 * Each feature can be enabled/disabled independently for gradual rollout.
 */

/**
 * Rate limiter configuration for BullMQ Worker
 */
export interface RateLimiterConfig {
    /** Maximum number of jobs to process within the duration window */
    max: number;
    /** Duration window in milliseconds */
    duration: number;
}

/**
 * Main engine configuration interface
 * 
 * All feature flags default to false to maintain backward compatibility.
 * Enable features incrementally as they are tested and validated.
 */
export interface EngineConfig {
    /**
     * Use FlowProducer for sub-workflow execution instead of checkpoint/resume pattern.
     * When enabled, sub-workflows use BullMQ's native parent-child job dependencies.
     * @default false
     */
    useFlowProducerForSubWorkflows?: boolean;

    /**
     * Use BullMQ's native Worker rate limiting instead of custom Redis INCR/EXPIRE.
     * When enabled, rate limits are applied at the Worker level.
     * @default false
     */
    useNativeRateLimiting?: boolean;

    /**
     * Use upsertJobScheduler for schedule management instead of manual repeatable jobs.
     * When enabled, schedule registration becomes idempotent without manual cleanup.
     * @default false
     */
    useJobSchedulers?: boolean;



    /**
     * Use simplified event streaming via job.updateProgress() instead of QueueEventsProducer.
     * When enabled, events flow through native BullMQ progress events.
     * @default false
     */
    useSimplifiedEventStream?: boolean;

    /**
     * Global rate limiter configuration for the node execution worker.
     * Only applies when useNativeRateLimiting is enabled.
     */
    rateLimiter?: RateLimiterConfig;

    /**
     * Worker concurrency - number of jobs to process in parallel.
     * @default 5
     */
    workerConcurrency?: number;


}

/**
 * Default engine configuration
 * All feature flags disabled for backward compatibility except useJobSchedulers
 * which is now the only implementation (legacy repeatable jobs code removed)
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
    useFlowProducerForSubWorkflows: false,
    useNativeRateLimiting: false,
    useJobSchedulers: true, // Always true - legacy repeatable jobs code removed

    useSimplifiedEventStream: false,
    workerConcurrency: 5,
};

/**
 * Merge user config with defaults
 */
export function mergeEngineConfig(userConfig?: Partial<EngineConfig>): EngineConfig {
    return {
        ...DEFAULT_ENGINE_CONFIG,
        ...userConfig,
    };
}
