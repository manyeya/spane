/**
 * SPANE Engine Constants
 *
 * Centralized constants for workflow engine configuration.
 * Move magic numbers here for better maintainability.
 */

// ============================================================================
// Workflow Configuration
// ============================================================================

/** Maximum nesting depth for sub-workflows */
export const MAX_SUBWORKFLOW_DEPTH = 10;

/** Default maximum number of workflows to cache */
export const DEFAULT_WORKFLOW_CACHE_SIZE = 500;

/** Default workflow cache TTL in milliseconds (1 hour) */
export const DEFAULT_WORKFLOW_CACHE_TTL_MS = 3600000;

// ============================================================================
// Queue Configuration
// ============================================================================

/** Default number of completed jobs to keep in queue */
export const DEFAULT_REMOVE_ON_COMPLETE_COUNT = 100;

/** Default number of failed jobs to keep in queue for debugging */
export const DEFAULT_REMOVE_ON_FAIL_COUNT = 500;

/** Default workflow queue job retention age in seconds (1 hour) */
export const DEFAULT_WORKFLOW_QUEUE_RETENTION_AGE_SEC = 3600;

/** Default number of completed workflow jobs to keep */
export const DEFAULT_WORKFLOW_QUEUE_REMOVE_ON_COMPLETE = 50;

// ============================================================================
// Timeouts and Delays
// ============================================================================

/** Default delay in milliseconds for retry operations */
export const DEFAULT_RETRY_DELAY_MS = 1000;

/** Default delay in milliseconds for distributed lock acquisition */
export const DEFAULT_LOCK_TIMEOUT_MS = 5000;

/** Default delay node duration in milliseconds (5 seconds) */
export const DEFAULT_DELAY_DURATION_MS = 5000;

/** Default worker concurrency */
export const DEFAULT_WORKER_CONCURRENCY = 5;

// ============================================================================
// Cache Configuration
// ============================================================================

/** Default Redis cache TTL in seconds (1 hour) */
export const DEFAULT_REDIS_CACHE_TTL_SEC = 3600;

// ============================================================================
// Pagination
// ============================================================================

/** Default page size for list operations */
export const DEFAULT_PAGE_SIZE = 100;

/** Default DLQ items to fetch */
export const DEFAULT_DLQ_FETCH_SIZE = 10;

// ============================================================================
// Progress
// ============================================================================

/** Maximum progress percentage */
export const PROGRESS_COMPLETE = 100;

/** Minimum progress percentage */
export const PROGRESS_START = 0;

// ============================================================================
// Time Constants (for readability)
// ============================================================================

/** Milliseconds in one second */
export const ONE_SECOND_MS = 1000;

/** Milliseconds in one minute */
export const ONE_MINUTE_MS = 60000;

/** Milliseconds in one hour */
export const ONE_HOUR_MS = 3600000;

/** Milliseconds in 24 hours */
export const ONE_DAY_MS = 86400000;

/** Milliseconds in 30 seconds */
export const THIRTY_SECONDS_MS = 30000;

// ============================================================================
// Job Priority
// ============================================================================

/** Minimum job priority */
export const PRIORITY_MIN = 1;

/** Maximum job priority */
export const PRIORITY_MAX = 10;

/** Default job priority */
export const PRIORITY_DEFAULT = 5;
