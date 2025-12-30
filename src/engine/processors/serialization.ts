/**
 * Serialization Utilities for Sandboxed Node Execution
 * 
 * This module provides serialization and deserialization functions for job data
 * that needs to pass between the main thread and BullMQ worker threads.
 * 
 * When BullMQ runs processors in worker threads (sandboxed mode), job data is
 * passed via the structured clone algorithm. While this handles most JavaScript
 * types, some data requires special handling:
 * 
 * - Date objects: Serialized as ISO strings, reconstructed on deserialization
 * - Error objects: Serialized with message and stack, reconstructed as Error
 * - Circular references: Detected and handled gracefully
 * - Functions: Cannot be serialized (removed with warning)
 * - Symbols: Cannot be serialized (removed with warning)
 * - BigInt: Serialized as string with type marker
 * - Buffer/Uint8Array: Serialized as base64 string with type marker
 * 
 * Usage:
 * - Call serializeJobData() before passing data to worker threads
 * - Call deserializeJobData() when receiving data in worker threads
 * 
 * @see engine/processors/node-processor.sandbox.ts for sandboxed execution
 * @see engine/worker-manager.ts for worker configuration
 */

import type { NodeJobData } from '../types';
import type { ExecutionResult } from '../../types';

// ============================================================================
// TYPE MARKERS FOR SPECIAL SERIALIZATION
// ============================================================================

/**
 * Type markers used to identify serialized special types during deserialization.
 * These markers are prefixed to serialized values to indicate their original type.
 */
const TYPE_MARKERS = {
    DATE: '__SERIALIZED_DATE__',
    ERROR: '__SERIALIZED_ERROR__',
    BIGINT: '__SERIALIZED_BIGINT__',
    BUFFER: '__SERIALIZED_BUFFER__',
    UNDEFINED: '__SERIALIZED_UNDEFINED__',
} as const;

/**
 * Interface for serialized error objects.
 */
interface SerializedError {
    __type: typeof TYPE_MARKERS.ERROR;
    name: string;
    message: string;
    stack?: string;
}

/**
 * Interface for serialized buffer objects.
 */
interface SerializedBuffer {
    __type: typeof TYPE_MARKERS.BUFFER;
    data: string; // base64 encoded
}

// ============================================================================
// SERIALIZATION FUNCTIONS
// ============================================================================

/**
 * Serializes job data for safe passage to worker threads.
 * 
 * This function recursively processes the job data, converting special types
 * to serializable representations that can be reconstructed on the other side.
 * 
 * @param data - The NodeJobData to serialize
 * @returns Serialized job data safe for worker thread transfer
 */
export function serializeJobData(data: NodeJobData): NodeJobData {
    return serializeValue(data, new WeakSet()) as NodeJobData;
}

/**
 * Serializes an ExecutionResult for safe passage to/from worker threads.
 * 
 * @param result - The ExecutionResult to serialize
 * @returns Serialized result safe for worker thread transfer
 */
export function serializeExecutionResult(result: ExecutionResult): ExecutionResult {
    return serializeValue(result, new WeakSet()) as ExecutionResult;
}

/**
 * Recursively serializes a value, handling special types.
 * 
 * @param value - The value to serialize
 * @param seen - WeakSet to track circular references
 * @returns Serialized value
 */
function serializeValue(value: unknown, seen: WeakSet<object>): unknown {
    // Handle null and undefined
    if (value === null) {
        return null;
    }
    if (value === undefined) {
        return TYPE_MARKERS.UNDEFINED;
    }

    // Handle primitive types (pass through)
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') {
        return value;
    }

    // Handle BigInt
    if (type === 'bigint') {
        return `${TYPE_MARKERS.BIGINT}${value.toString()}`;
    }

    // Handle functions (cannot be serialized)
    if (type === 'function') {
        // Log warning in development
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[Serialization] Functions cannot be serialized for worker threads');
        }
        return undefined;
    }

    // Handle symbols (cannot be serialized)
    if (type === 'symbol') {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[Serialization] Symbols cannot be serialized for worker threads');
        }
        return undefined;
    }

    // Handle objects
    if (type === 'object') {
        // Check for circular references
        if (seen.has(value as object)) {
            if (process.env.NODE_ENV !== 'production') {
                console.warn('[Serialization] Circular reference detected, replacing with null');
            }
            return null;
        }
        seen.add(value as object);

        // Handle Date objects
        if (value instanceof Date) {
            return `${TYPE_MARKERS.DATE}${value.toISOString()}`;
        }

        // Handle Error objects
        if (value instanceof Error) {
            return {
                __type: TYPE_MARKERS.ERROR,
                name: value.name,
                message: value.message,
                stack: value.stack,
            } as SerializedError;
        }

        // Handle Buffer/Uint8Array
        if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
            const base64 = typeof Buffer !== 'undefined' 
                ? Buffer.from(value).toString('base64')
                : btoa(String.fromCharCode(...value));
            return {
                __type: TYPE_MARKERS.BUFFER,
                data: base64,
            } as SerializedBuffer;
        }

        // Handle Arrays
        if (Array.isArray(value)) {
            return value.map(item => serializeValue(item, seen));
        }

        // Handle Map
        if (value instanceof Map) {
            const obj: Record<string, unknown> = { __type: '__SERIALIZED_MAP__' };
            const entries = Array.from(value.entries());
            for (const entry of entries) {
                const [k, v] = entry;
                if (typeof k === 'string') {
                    obj[k] = serializeValue(v, seen);
                }
            }
            return obj;
        }

        // Handle Set
        if (value instanceof Set) {
            return {
                __type: '__SERIALIZED_SET__',
                values: Array.from(value).map(item => serializeValue(item, seen)),
            };
        }

        // Handle plain objects
        const serialized: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            const serializedVal = serializeValue(val, seen);
            // Only include if not undefined (functions/symbols are removed)
            if (serializedVal !== undefined) {
                serialized[key] = serializedVal;
            }
        }
        return serialized;
    }

    // Fallback: return as-is
    return value;
}

// ============================================================================
// DESERIALIZATION FUNCTIONS
// ============================================================================

/**
 * Deserializes job data received from the main thread in a worker.
 * 
 * This function reconstructs special types from their serialized representations.
 * 
 * @param data - The serialized NodeJobData
 * @returns Deserialized job data with reconstructed types
 */
export function deserializeJobData(data: NodeJobData): NodeJobData {
    return deserializeValue(data) as NodeJobData;
}

/**
 * Deserializes an ExecutionResult received from a worker thread.
 * 
 * @param result - The serialized ExecutionResult
 * @returns Deserialized result with reconstructed types
 */
export function deserializeExecutionResult(result: ExecutionResult): ExecutionResult {
    return deserializeValue(result) as ExecutionResult;
}

/**
 * Recursively deserializes a value, reconstructing special types.
 * 
 * @param value - The value to deserialize
 * @returns Deserialized value with reconstructed types
 */
function deserializeValue(value: unknown): unknown {
    // Handle null
    if (value === null) {
        return null;
    }

    // Handle undefined marker
    if (value === TYPE_MARKERS.UNDEFINED) {
        return undefined;
    }

    // Handle primitive types
    const type = typeof value;
    if (type === 'number' || type === 'boolean') {
        return value;
    }

    // Handle string types (may contain type markers)
    if (type === 'string') {
        const str = value as string;

        // Check for Date marker
        if (str.startsWith(TYPE_MARKERS.DATE)) {
            return new Date(str.slice(TYPE_MARKERS.DATE.length));
        }

        // Check for BigInt marker
        if (str.startsWith(TYPE_MARKERS.BIGINT)) {
            return BigInt(str.slice(TYPE_MARKERS.BIGINT.length));
        }

        return str;
    }

    // Handle objects
    if (type === 'object') {
        // Handle Arrays
        if (Array.isArray(value)) {
            return value.map(item => deserializeValue(item));
        }

        const obj = value as Record<string, unknown>;

        // Check for serialized Error
        if (obj.__type === TYPE_MARKERS.ERROR) {
            const serializedError = obj as unknown as SerializedError;
            const error = new Error(serializedError.message);
            error.name = serializedError.name;
            if (serializedError.stack) {
                error.stack = serializedError.stack;
            }
            return error;
        }

        // Check for serialized Buffer
        if (obj.__type === TYPE_MARKERS.BUFFER) {
            const serializedBuffer = obj as unknown as SerializedBuffer;
            if (typeof Buffer !== 'undefined') {
                return Buffer.from(serializedBuffer.data, 'base64');
            }
            // Fallback for environments without Buffer
            const binary = atob(serializedBuffer.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        }

        // Check for serialized Map
        if (obj.__type === '__SERIALIZED_MAP__') {
            const map = new Map<string, unknown>();
            for (const [key, val] of Object.entries(obj)) {
                if (key !== '__type') {
                    map.set(key, deserializeValue(val));
                }
            }
            return map;
        }

        // Check for serialized Set
        if (obj.__type === '__SERIALIZED_SET__' && Array.isArray(obj.values)) {
            return new Set((obj.values as unknown[]).map(item => deserializeValue(item)));
        }

        // Handle plain objects
        const deserialized: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(obj)) {
            deserialized[key] = deserializeValue(val);
        }
        return deserialized;
    }

    // Fallback: return as-is
    return value;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates that job data is safe for serialization to worker threads.
 * 
 * This function checks for types that cannot be serialized and returns
 * a list of issues found. Use this for debugging serialization problems.
 * 
 * @param data - The data to validate
 * @param path - Current path in the object (for error messages)
 * @returns Array of validation issues found
 */
export function validateSerializable(data: unknown, path: string = 'root'): string[] {
    const issues: string[] = [];
    validateSerializableRecursive(data, path, issues, new WeakSet());
    return issues;
}

/**
 * Recursive helper for validateSerializable.
 */
function validateSerializableRecursive(
    value: unknown,
    path: string,
    issues: string[],
    seen: WeakSet<object>
): void {
    if (value === null || value === undefined) {
        return;
    }

    const type = typeof value;

    if (type === 'function') {
        issues.push(`${path}: Functions cannot be serialized`);
        return;
    }

    if (type === 'symbol') {
        issues.push(`${path}: Symbols cannot be serialized`);
        return;
    }

    if (type === 'object') {
        if (seen.has(value as object)) {
            issues.push(`${path}: Circular reference detected`);
            return;
        }
        seen.add(value as object);

        // Check for WeakMap/WeakSet (cannot be serialized)
        if (value instanceof WeakMap) {
            issues.push(`${path}: WeakMap cannot be serialized`);
            return;
        }
        if (value instanceof WeakSet) {
            issues.push(`${path}: WeakSet cannot be serialized`);
            return;
        }

        // Recursively check arrays
        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                validateSerializableRecursive(item, `${path}[${index}]`, issues, seen);
            });
            return;
        }

        // Recursively check objects
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            validateSerializableRecursive(val, `${path}.${key}`, issues, seen);
        }
    }
}

/**
 * Checks if a value is safe for serialization without modifications.
 * 
 * @param data - The data to check
 * @returns true if the data can be serialized without issues
 */
export function isSerializable(data: unknown): boolean {
    return validateSerializable(data).length === 0;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Deep clones data using serialization/deserialization.
 * 
 * This is useful for creating isolated copies of job data that can be
 * safely modified without affecting the original.
 * 
 * @param data - The data to clone
 * @returns Deep cloned copy of the data
 */
export function cloneJobData<T>(data: T): T {
    const serialized = serializeValue(data, new WeakSet());
    return deserializeValue(serialized) as T;
}

/**
 * Sanitizes job data by removing non-serializable values.
 * 
 * This function removes functions, symbols, and other non-serializable
 * values from the data, making it safe for worker thread transfer.
 * 
 * @param data - The data to sanitize
 * @returns Sanitized data safe for serialization
 */
export function sanitizeForSerialization<T>(data: T): T {
    return serializeValue(data, new WeakSet()) as T;
}
