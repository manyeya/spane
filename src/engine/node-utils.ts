/**
 * Node Execution Utilities
 * 
 * This module contains pure, stateless functions used by the NodeProcessor
 * for task execution logic such as delay resolution, input/output mapping,
 * and result aggregation.
 */

import type { ExecutionResult, DelayNodeConfig } from '../types';



// ============================================================================
// DURATION RESOLUTION
// ============================================================================

/**
 * Resolves the delay duration from a DelayNodeConfig.
 * 
 * Duration precedence (first found is used):
 * 1. duration (milliseconds) - highest priority
 * 2. durationSeconds (converted to milliseconds)
 * 3. durationMinutes (converted to milliseconds)
 * 
 * @param config - The delay node configuration
 * @returns The resolved duration in milliseconds, or null if no valid duration is configured
 */
export function resolveDuration(config: DelayNodeConfig | undefined): number | null {
    if (!config) {
        return null;
    }

    if (typeof config.duration === 'number') {
        return config.duration;
    }
    if (typeof config.durationSeconds === 'number') {
        return config.durationSeconds * 1000;
    }
    if (typeof config.durationMinutes === 'number') {
        return config.durationMinutes * 60000;
    }
    return null;
}

/**
 * Validates a delay duration value.
 * 
 * @param duration - The duration in milliseconds
 * @returns Object with validation result and optional error message
 */
export function validateDuration(duration: number | null): { valid: boolean; error?: string; warning?: string } {
    if (duration === null) {
        return { valid: false, error: 'Delay node missing duration configuration' };
    }

    if (duration < 0) {
        return { valid: false, error: 'Delay duration must be positive' };
    }

    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    if (duration > TWENTY_FOUR_HOURS_MS) {
        return { valid: true, warning: `Delay duration exceeds 24 hours: ${duration}ms` };
    }

    return { valid: true };
}



// ============================================================================
// INPUT DATA PROCESSING
// ============================================================================

/**
 * Validates that input data is safe to process (no circular references).
 *
 * @param data - The data to validate
 * @param seen - WeakSet for tracking seen objects (for circular reference detection)
 * @returns Object with validation result and optional error message
 */
function validateInputData(data: unknown, seen = new WeakSet()): { valid: boolean; error?: string } {
    // Primitive types and null are always valid
    if (data === null || typeof data !== 'object') {
        return { valid: true };
    }

    // Check for circular reference
    if (seen.has(data as object)) {
        return {
            valid: false,
            error: 'Circular reference detected in input data. This can cause infinite loops during processing.'
        };
    }

    // Add current object to seen set
    seen.add(data as object);

    // Recursively validate object properties (for plain objects)
    if (!Array.isArray(data)) {
        for (const value of Object.values(data as Record<string, unknown>)) {
            const validation = validateInputData(value, seen);
            if (!validation.valid) {
                return validation;
            }
        }
    } else {
        // Validate array elements
        for (const item of data as unknown[]) {
            const validation = validateInputData(item, seen);
            if (!validation.valid) {
                return validation;
            }
        }
    }

    return { valid: true };
}

/**
 * Merges input data from multiple parent nodes with validation.
 *
 * Data merging strategy:
 * - Single parent: Returns the parent's data directly
 * - Multiple parents: Returns an object keyed by parent node ID
 * - No parents: Returns the original input data
 *
 * @param inputData - The original input data (for entry nodes)
 * @param parentIds - Array of parent node IDs
 * @param previousResults - Map of parent node ID to their execution results
 * @returns Merged input data for the node
 * @throws {Error} If input validation fails with a descriptive error message
 */
export function mergeParentInputs(
    inputData: unknown,
    parentIds: string[],
    previousResults: Record<string, ExecutionResult>
): unknown {
    // Validate parentIds is an array
    if (!Array.isArray(parentIds)) {
        throw new Error(
            `Invalid parentIds: expected array, got '${typeof parentIds}'. ` +
            `This indicates a configuration error in the workflow definition.`
        );
    }

    // Validate previousResults is an object
    if (typeof previousResults !== 'object' || previousResults === null) {
        throw new Error(
            `Invalid previousResults: expected object, got '${typeof previousResults}'. ` +
            `This indicates an internal state management error.`
        );
    }

    // No parents: validate and return input data directly
    if (parentIds.length === 0) {
        const validation = validateInputData(inputData);
        if (!validation.valid) {
            throw new Error(
                `Input data validation failed for entry node: ${validation.error}`
            );
        }
        return inputData;
    }

    // Validate all parent IDs are non-empty strings
    for (const parentId of parentIds) {
        if (typeof parentId !== 'string' || parentId.trim() === '') {
            throw new Error(
                `Invalid parent ID in parentIds array: expected non-empty string, ` +
                `got '${typeof parentId}'${typeof parentId === 'string' ? ` with value '${parentId}'` : ''}. ` +
                `This indicates a workflow definition error where a node has an invalid parent reference.`
            );
        }
    }

    // Single parent: Pass data directly
    if (parentIds.length === 1) {
        const parentId = parentIds[0];
        const parentResult = previousResults[parentId];

        if (!parentResult) {
            throw new Error(
                `Parent node '${parentId}' not found in previous results. ` +
                `This may indicate the parent node has not yet completed or failed without producing a result.`
            );
        }

        if (!parentResult.success) {
            throw new Error(
                `Parent node '${parentId}' did not complete successfully. ` +
                `Cannot merge data from a failed parent node. Error: ${parentResult.error || 'Unknown error'}`
            );
        }

        const validation = validateInputData(parentResult.data);
        if (!validation.valid) {
            throw new Error(
                `Data validation failed for parent node '${parentId}': ${validation.error}`
            );
        }

        return parentResult.data;
    }

    // Multiple parents: Merge data into an object keyed by parent node ID
    const mergedData: Record<string, unknown> = {};
    const missingParents: string[] = [];
    const failedParents: string[] = [];

    for (const parentId of parentIds) {
        const parentResult = previousResults[parentId];

        if (!parentResult) {
            missingParents.push(parentId);
            continue;
        }

        if (!parentResult.success) {
            failedParents.push(parentId);
            continue;
        }

        // Validate each parent's data before adding to merged result
        const validation = validateInputData(parentResult.data);
        if (!validation.valid) {
            throw new Error(
                `Data validation failed for parent node '${parentId}': ${validation.error}`
            );
        }

        if (parentResult.data !== undefined) {
            mergedData[parentId] = parentResult.data;
        }
    }

    // Report any missing or failed parents
    if (missingParents.length > 0 || failedParents.length > 0) {
        const errors: string[] = [];
        if (missingParents.length > 0) {
            errors.push(`missing parents: ${missingParents.map(p => `'${p}'`).join(', ')}`);
        }
        if (failedParents.length > 0) {
            errors.push(`failed parents: ${failedParents.map(p => `'${p}'`).join(', ')}`);
        }
        throw new Error(
            `Cannot merge parent inputs: ${errors.join('; ')}. ` +
            `All parent nodes must complete successfully before merging.`
        );
    }

    return mergedData;
}

// ============================================================================
// OUTPUT MAPPING
// ============================================================================

/**
 * Applies input mapping to transform data before passing to a sub-workflow.
 * 
 * @param inputData - The original input data
 * @param inputMapping - Map of target keys to source keys
 * @returns Mapped input data, or original if no mapping specified
 */
export function applyInputMapping(
    inputData: any,
    inputMapping?: Record<string, string>
): any {
    if (!inputMapping || typeof inputData !== 'object' || inputData === null) {
        return inputData;
    }

    const mappedInput: Record<string, any> = {};
    for (const [targetKey, sourceKey] of Object.entries(inputMapping)) {
        if (sourceKey in inputData) {
            mappedInput[targetKey] = inputData[sourceKey];
        }
    }
    return mappedInput;
}

/**
 * Applies output mapping to transform aggregated sub-workflow results.
 * 
 * @param aggregatedResult - The aggregated result from sub-workflow
 * @param outputMapping - Map of target keys to source keys
 * @returns Mapped output data, or original if no mapping specified
 */
export function applyOutputMapping(
    aggregatedResult: any,
    outputMapping?: Record<string, string>
): any {
    if (!outputMapping || typeof aggregatedResult !== 'object' || aggregatedResult === null) {
        return aggregatedResult;
    }

    const mappedOutput: Record<string, any> = {};
    for (const [targetKey, sourceKey] of Object.entries(outputMapping)) {
        if (sourceKey in aggregatedResult) {
            mappedOutput[targetKey] = aggregatedResult[sourceKey];
        }
    }
    return mappedOutput;
}

// ============================================================================
// RESULT AGGREGATION
// ============================================================================

/**
 * Aggregates results from child jobs in a FlowProducer flow.
 * 
 * The childrenValues from BullMQ's getChildrenValues() are keyed by job key
 * (format: "queue:jobId"). This function extracts and aggregates the results.
 * 
 * @param childrenValues - Map of job keys to execution results
 * @param executionId - The execution ID (used to extract node IDs from job keys)
 * @returns Aggregated result data
 */
export function aggregateChildResults(
    childrenValues: Record<string, unknown>,
    executionId: string
): any {
    const childResults = Object.values(childrenValues);

    if (childResults.length === 0) {
        return {};
    }

    if (childResults.length === 1) {
        // Single final node: use its result directly
        const result = childResults[0] as ExecutionResult | undefined;
        return result?.data;
    }

    // Multiple final nodes: merge results by extracting data from each
    const aggregatedResult: Record<string, any> = {};

    for (const [key, value] of Object.entries(childrenValues)) {
        const result = value as ExecutionResult | undefined;
        if (result?.success && result.data !== undefined) {
            // Extract node ID from job key (format: "node-execution:executionId-nodeId")
            const jobId = key.split(':')[1] || key;
            // Remove the executionId prefix and the separator dash to get the node ID
            const prefix = `${executionId}-`;
            const nodeId = jobId.startsWith(prefix)
                ? jobId.slice(prefix.length)
                : jobId;
            aggregatedResult[nodeId] = result.data;
        }
    }

    return aggregatedResult;
}

// ============================================================================
// CONTINUE ON FAIL HANDLING
// ============================================================================

/**
 * Creates a safe result for nodes with continueOnFail enabled.
 * 
 * When a node fails but has continueOnFail=true, we create a success result
 * that includes error information in the data, allowing downstream nodes to execute.
 * 
 * @param errorMessage - The original error message
 * @returns ExecutionResult marked as success with error metadata
 */
export function createContinueOnFailResult(errorMessage: string): ExecutionResult {
    return {
        success: true,
        data: {
            error: errorMessage,
            _metadata: {
                continuedOnFail: true,
                originalError: errorMessage
            }
        },
        error: errorMessage // Keep error string for UI visibility
    };
}

// ============================================================================
// IDEMPOTENCY HELPERS
// ============================================================================

/**
 * Checks if a node result indicates the node was already processed.
 * Used for idempotency checks to skip re-execution.
 * 
 * @param result - The existing execution result
 * @returns true if the node was already successfully processed or skipped
 */
export function isNodeAlreadyProcessed(result: ExecutionResult | undefined): boolean {
    if (!result) {
        return false;
    }
    return result.success || result.skipped === true;
}

/**
 * Generates a deterministic job ID for node execution.
 * 
 * Job ID formats:
 * - Regular nodes: `${executionId}-node-${nodeId}`
 * - Delay resume jobs: `${executionId}-node-${nodeId}-delay-resumed`
 * 
 * @param executionId - The workflow execution ID
 * @param nodeId - The node ID
 * @param delayStep - Optional delay step ('resumed' for delay node resume jobs)
 * @returns Deterministic job ID string
 */
export function generateNodeJobId(
    executionId: string,
    nodeId: string,
    delayStep?: 'initial' | 'resumed'
): string {
    if (delayStep === 'resumed') {
        return `${executionId}-node-${nodeId}-delay-resumed`;
    }
    return `${executionId}-node-${nodeId}`;
}

// ============================================================================
// RETRY POLICY EXTRACTION
// ============================================================================

/**
 * Default retry configuration values.
 */
export const DEFAULT_RETRY_CONFIG = {
    attempts: 3,
    backoff: {
        type: 'exponential' as 'fixed' | 'exponential',
        delay: 1000
    }
};

/**
 * Extracts retry configuration from a node's retry policy.
 * 
 * @param retryPolicy - The node's retry policy configuration
 * @returns BullMQ-compatible retry configuration
 */
export function extractRetryConfig(retryPolicy?: {
    maxAttempts?: number;
    backoff?: {
        type: 'fixed' | 'exponential';
        delay: number;
    };
}): { attempts: number; backoff: { type: 'fixed' | 'exponential'; delay: number } } {
    let attempts = DEFAULT_RETRY_CONFIG.attempts;
    let backoff: { type: 'fixed' | 'exponential'; delay: number } = { ...DEFAULT_RETRY_CONFIG.backoff };

    if (retryPolicy) {
        if (typeof retryPolicy.maxAttempts === 'number') {
            attempts = retryPolicy.maxAttempts;
        }
        if (retryPolicy.backoff) {
            backoff = {
                type: retryPolicy.backoff.type,
                delay: retryPolicy.backoff.delay
            };
        }
    }

    return { attempts, backoff };
}
