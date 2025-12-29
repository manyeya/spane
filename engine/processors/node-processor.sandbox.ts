/**
 * Sandboxed Node Processor for BullMQ Worker Threads
 * 
 * This file is designed to run in a separate worker thread when BullMQ's
 * `useWorkerThreads` option is enabled. It provides CPU isolation for
 * node execution, preventing long-running or CPU-intensive nodes from
 * blocking the main event loop.
 * 
 * Key characteristics:
 * - Uses CommonJS module.exports pattern (required by BullMQ sandboxed workers)
 * - Dynamically imports dependencies to avoid module loading issues in worker threads
 * - Stateless design - all state is passed via job data or fetched from external stores
 * - Uses stateless-utils.ts for pure processing functions
 * - Uses serialization.ts for safe data transfer between threads
 * 
 * Serialization Handling:
 * When job data passes between the main thread and worker threads, certain types
 * require special handling:
 * - Date objects: Serialized as ISO strings, reconstructed on deserialization
 * - Error objects: Serialized with message/stack, reconstructed as Error
 * - BigInt: Serialized as string with type marker
 * - Buffer/Uint8Array: Serialized as base64 string
 * - Functions/Symbols: Cannot be serialized (removed with warning)
 * - Circular references: Detected and handled gracefully
 * 
 * Environment Variables Required:
 * - SPANE_REDIS_URL or REDIS_URL: Redis connection URL (e.g., redis://localhost:6379)
 * 
 * Optional Environment Variables:
 * - SPANE_DATABASE_URL or DATABASE_URL: Database URL for DrizzleExecutionStateStore
 *   (if not provided, InMemoryExecutionStore is used)
 * - SPANE_ENGINE_CONFIG: JSON string of EngineConfig options
 * 
 * Usage:
 * When WorkerManager is configured with `useWorkerThreads: true`, it will
 * use this file as the processor instead of the inline processor function.
 * 
 * Note: This file must be compiled to JavaScript before use. The compiled
 * output (node-processor.sandbox.js) is what BullMQ actually loads.
 * 
 * @see engine/worker-manager.ts for worker configuration
 * @see engine/node-processor.ts for the main processor implementation
 * @see engine/processors/stateless-utils.ts for pure processing utilities
 * @see engine/processors/serialization.ts for serialization utilities
 */

import type { SandboxedJob } from 'bullmq';
import type { NodeJobData } from '../types';
import type { ExecutionResult } from '../../types';

// Import stateless utilities that can safely run in worker threads
import {
    resolveDuration,
    validateDuration,
    mergeParentInputs,
    applyInputMapping,
    applyOutputMapping,
    aggregateChildResults,
    createContinueOnFailResult,
    isNodeAlreadyProcessed,
    generateNodeJobId,
    extractRetryConfig,
    getCircuitBreakerOptions,
    DEFAULT_CIRCUIT_BREAKER_OPTIONS,
    DEFAULT_RETRY_CONFIG,
} from './stateless-utils';

// Import serialization utilities for safe data transfer between threads
import {
    deserializeJobData,
    serializeExecutionResult,
    validateSerializable,
    isSerializable,
    sanitizeForSerialization,
} from './serialization';

// Re-export stateless utilities for use by the main processor
export {
    resolveDuration,
    validateDuration,
    mergeParentInputs,
    applyInputMapping,
    applyOutputMapping,
    aggregateChildResults,
    createContinueOnFailResult,
    isNodeAlreadyProcessed,
    generateNodeJobId,
    extractRetryConfig,
    getCircuitBreakerOptions,
    DEFAULT_CIRCUIT_BREAKER_OPTIONS,
    DEFAULT_RETRY_CONFIG,
};

// Re-export serialization utilities for use by other modules
export {
    deserializeJobData,
    serializeExecutionResult,
    validateSerializable,
    isSerializable,
    sanitizeForSerialization,
};

/**
 * Sandboxed processor function for BullMQ worker threads.
 * 
 * This function is called by BullMQ for each job when running in sandboxed mode.
 * It dynamically imports the processor factory to create a sandboxed processor
 * instance, then delegates job processing to it.
 * 
 * Serialization Handling:
 * - Job data is deserialized on entry to reconstruct special types (Date, Error, etc.)
 * - Execution results are serialized before returning to ensure safe transfer
 * - Validation warnings are logged for non-serializable data in development mode
 * 
 * The processor uses stateless utilities from stateless-utils.ts for:
 * - Duration resolution and validation
 * - Input data merging from parent nodes
 * - Output mapping for sub-workflows
 * - Result aggregation for FlowProducer flows
 * - Retry configuration extraction
 * - Circuit breaker options
 * 
 * @param job - The BullMQ SandboxedJob containing node execution data
 * @returns ExecutionResult from the node processor (serialized for thread transfer)
 */
module.exports = async (job: SandboxedJob<NodeJobData>): Promise<ExecutionResult> => {
    // Deserialize job data to reconstruct special types (Date, Error, BigInt, etc.)
    // This handles data that was serialized when passing from main thread to worker
    const deserializedData = deserializeJobData(job.data);
    const { executionId, workflowId, nodeId } = deserializedData;

    try {
        // Validate job data in development mode to catch serialization issues early
        if (process.env.NODE_ENV !== 'production') {
            const issues = validateSerializable(job.data);
            if (issues.length > 0) {
                console.warn(
                    `[Sandbox] Job data serialization issues for node ${nodeId}:`,
                    issues
                );
            }
        }

        // Dynamic import to avoid module loading issues in worker threads
        // The factory function handles dependency injection for the sandboxed context
        const { createSandboxedProcessor } = await import('../node-processor');

        // Create a processor instance configured for sandboxed execution
        const processor = await createSandboxedProcessor();

        // Process the node job with deserialized data
        // Note: In sandboxed mode, the job object has limited functionality
        // compared to the full Job class, but processNodeJob handles this
        const result = await processor.processNodeJob(deserializedData, job as any);

        // Serialize the result before returning to ensure safe transfer back to main thread
        // This handles any special types in the result data (Date, Error, etc.)
        const serializedResult = serializeExecutionResult(result);

        // Validate result serialization in development mode
        if (process.env.NODE_ENV !== 'production' && !isSerializable(result)) {
            console.warn(
                `[Sandbox] Result contains non-serializable data for node ${nodeId}:`,
                validateSerializable(result)
            );
        }

        return serializedResult;
    } catch (error) {
        // Log error for debugging (will appear in worker thread logs)
        console.error(
            `[Sandbox] Failed to process node ${nodeId} in workflow ${workflowId} (execution: ${executionId}):`,
            error
        );

        // Return a failure result instead of throwing to ensure proper error handling
        // Sanitize the error message to ensure it's serializable
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result: ExecutionResult = {
            success: false,
            error: sanitizeForSerialization(errorMessage),
        };

        return serializeExecutionResult(result);
    }
};
