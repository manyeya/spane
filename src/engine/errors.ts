/**
 * SPANE Error Classes
 *
 * Standardized error types for workflow execution.
 * All errors should extend from these base classes for proper error handling.
 */

/**
 * Error codes for different failure scenarios
 */
export enum WorkflowErrorCode {
    // Workflow errors
    WORKFLOW_NOT_FOUND = 'WORKFLOW_NOT_FOUND',
    WORKFLOW_VALIDATION_FAILED = 'WORKFLOW_VALIDATION_FAILED',
    WORKFLOW_CYCLE_DETECTED = 'WORKFLOW_CYCLE_DETECTED',
    WORKFLOW_ENTRY_NODE_MISSING = 'WORKFLOW_ENTRY_NODE_MISSING',

    // Node errors
    NODE_NOT_FOUND = 'NODE_NOT_FOUND',
    NODE_NOT_REGISTERED = 'NODE_NOT_REGISTERED',
    NODE_EXECUTION_FAILED = 'NODE_EXECUTION_FAILED',
    NODE_SKIPPED = 'NODE_SKIPPED',
    NODE_TIMEOUT = 'NODE_TIMEOUT',

    // Execution errors
    EXECUTION_NOT_FOUND = 'EXECUTION_NOT_FOUND',
    EXECUTION_TIMEOUT = 'EXECUTION_TIMEOUT',
    EXECUTION_CANCELLED = 'EXECUTION_CANCELLED',
    EXECUTION_PAUSED = 'EXECUTION_PAUSED',
    EXECUTION_MAX_DEPTH_EXCEEDED = 'EXECUTION_MAX_DEPTH_EXCEEDED',

    // Configuration errors
    INVALID_CONFIG = 'INVALID_CONFIG',
    INVALID_PRIORITY = 'INVALID_PRIORITY',
    INVALID_DELAY = 'INVALID_DELAY',

    // State errors
    STATE_CORRUPTION = 'STATE_CORRUPTION',
    STATE_PERSISTENCE_FAILED = 'STATE_PERSISTENCE_FAILED',

    // Queue errors
    QUEUE_ERROR = 'QUEUE_ERROR',
    WORKER_ERROR = 'WORKER_ERROR',

    // Sub-workflow errors
    SUBWORKFLOW_FAILED = 'SUBWORKFLOW_FAILED',
    SUBWORKFLOW_NOT_FOUND = 'SUBWORKFLOW_NOT_FOUND',

    // Rate limiting
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

    // Circuit breaker
    CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',

    // Generic
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Base error class for all workflow errors
 */
export class WorkflowError extends Error {
    public readonly code: WorkflowErrorCode;
    public readonly executionId?: string;
    public readonly nodeId?: string;
    public readonly workflowId?: string;
    public readonly timestamp: Date;
    public readonly originalCause?: Error;

    constructor(
        code: WorkflowErrorCode,
        message: string,
        details?: {
            executionId?: string;
            nodeId?: string;
            workflowId?: string;
            cause?: Error;
        }
    ) {
        super(message);
        this.code = code;
        this.executionId = details?.executionId;
        this.nodeId = details?.nodeId;
        this.workflowId = details?.workflowId;
        this.originalCause = details?.cause;
        this.timestamp = new Date();

        // Maintains proper stack trace for where our error was thrown
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Error thrown when a workflow cannot be found
 */
export class WorkflowNotFoundError extends WorkflowError {
    constructor(workflowId: string, cause?: Error) {
        super(
            WorkflowErrorCode.WORKFLOW_NOT_FOUND,
            `Workflow '${workflowId}' not found`,
            { workflowId, cause }
        );
    }
}

/**
 * Error thrown when workflow validation fails
 */
export class WorkflowValidationError extends WorkflowError {
    constructor(
        workflowId: string,
        message: string,
        details?: { executionId?: string; cause?: Error }
    ) {
        super(
            WorkflowErrorCode.WORKFLOW_VALIDATION_FAILED,
            `Workflow '${workflowId}' validation failed: ${message}`,
            { workflowId, ...details }
        );
    }
}

/**
 * Error thrown when a node execution fails
 */
export class NodeExecutionError extends WorkflowError {
    constructor(
        nodeId: string,
        executionId: string,
        message: string,
        cause?: Error
    ) {
        super(
            WorkflowErrorCode.NODE_EXECUTION_FAILED,
            `Node '${nodeId}' execution failed: ${message}`,
            { nodeId, executionId, cause }
        );
    }
}

/**
 * Error thrown when a node type is not registered
 */
export class NodeNotRegisteredError extends WorkflowError {
    constructor(nodeType: string, workflowId?: string) {
        super(
            WorkflowErrorCode.NODE_NOT_REGISTERED,
            `Node type '${nodeType}' is not registered`,
            { workflowId }
        );
        this.nodeType = nodeType;
    }

    public readonly nodeType: string;
}

/**
 * Error thrown when execution timeout occurs
 */
export class ExecutionTimeoutError extends WorkflowError {
    constructor(executionId: string, workflowId?: string) {
        super(
            WorkflowErrorCode.EXECUTION_TIMEOUT,
            `Execution '${executionId}' timed out`,
            { executionId, workflowId }
        );
    }
}

/**
 * Error thrown when max sub-workflow depth is exceeded
 */
export class MaxDepthExceededError extends WorkflowError {
    constructor(
        executionId: string,
        currentDepth: number,
        maxDepth: number
    ) {
        super(
            WorkflowErrorCode.EXECUTION_MAX_DEPTH_EXCEEDED,
            `Maximum sub-workflow depth (${maxDepth}) exceeded (current: ${currentDepth})`,
            { executionId }
        );
        this.currentDepth = currentDepth;
        this.maxDepth = maxDepth;
    }

    public readonly currentDepth: number;
    public readonly maxDepth: number;
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitError extends WorkflowError {
    constructor(
        nodeType: string,
        limit: number,
        executionId?: string
    ) {
        super(
            WorkflowErrorCode.RATE_LIMIT_EXCEEDED,
            `Rate limit exceeded for node type '${nodeType}' (${limit} requests)`,
            { executionId }
        );
        this.nodeType = nodeType;
        this.limit = limit;
    }

    public readonly nodeType: string;
    public readonly limit: number;
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends WorkflowError {
    constructor(
        nodeType: string,
        executionId?: string,
        cause?: Error
    ) {
        super(
            WorkflowErrorCode.CIRCUIT_BREAKER_OPEN,
            `Circuit breaker is open for node type '${nodeType}'`,
            { executionId, cause }
        );
        this.nodeType = nodeType;
    }

    public readonly nodeType: string;
}

/**
 * Error thrown when state persistence fails
 */
export class StatePersistenceError extends WorkflowError {
    constructor(
        operation: string,
        executionId?: string,
        cause?: Error
    ) {
        super(
            WorkflowErrorCode.STATE_PERSISTENCE_FAILED,
            `State persistence failed for operation '${operation}'`,
            { executionId, cause }
        );
        this.operation = operation;
    }

    public readonly operation: string;
}

/**
 * Check if an error is a WorkflowError
 */
export function isWorkflowError(err: unknown): err is WorkflowError {
    return err instanceof WorkflowError;
}

/**
 * Check if an error is retryable based on its code
 */
export function isRetryableError(error: Error): boolean {
    if (isWorkflowError(error)) {
        switch (error.code) {
            case WorkflowErrorCode.RATE_LIMIT_EXCEEDED:
            case WorkflowErrorCode.CIRCUIT_BREAKER_OPEN:
            case WorkflowErrorCode.NODE_TIMEOUT:
            case WorkflowErrorCode.QUEUE_ERROR:
            case WorkflowErrorCode.WORKER_ERROR:
                return true;
            default:
                return false;
        }
    }
    return false;
}

/**
 * Check if an error should be moved to DLQ (non-retryable after max attempts)
 */
export function shouldMoveToDLQ(error: Error, attemptsMade: number, maxAttempts: number): boolean {
    // Always move to DLQ if max attempts exceeded
    if (attemptsMade >= maxAttempts) {
        return true;
    }

    // Certain errors should go straight to DLQ
    if (isWorkflowError(error)) {
        switch (error.code) {
            case WorkflowErrorCode.WORKFLOW_VALIDATION_FAILED:
            case WorkflowErrorCode.WORKFLOW_CYCLE_DETECTED:
            case WorkflowErrorCode.NODE_NOT_REGISTERED:
            case WorkflowErrorCode.INVALID_CONFIG:
            case WorkflowErrorCode.STATE_CORRUPTION:
                return true;
            default:
                return false;
        }
    }

    return false;
}

/**
 * Extract a user-friendly error message
 */
export function getUserMessage(error: Error): string {
    if (isWorkflowError(error)) {
        // Return a sanitized message for user display
        switch (error.code) {
            case WorkflowErrorCode.WORKFLOW_NOT_FOUND:
                return 'The specified workflow could not be found.';
            case WorkflowErrorCode.WORKFLOW_VALIDATION_FAILED:
                return 'The workflow definition is invalid.';
            case WorkflowErrorCode.EXECUTION_TIMEOUT:
                return 'The workflow execution took too long and timed out.';
            case WorkflowErrorCode.EXECUTION_CANCELLED:
                return 'The workflow execution was cancelled.';
            case WorkflowErrorCode.RATE_LIMIT_EXCEEDED:
                return 'Too many requests. Please try again later.';
            case WorkflowErrorCode.CIRCUIT_BREAKER_OPEN:
                return 'The service is temporarily unavailable. Please try again later.';
            default:
                return error.message;
        }
    }
    return 'An unexpected error occurred.';
}
