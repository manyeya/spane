/**
 * Sandboxed Processor Setup Guide
 * 
 * This file documents how to configure and use BullMQ's sandboxed worker threads
 * for node execution in the workflow engine. Sandboxed processors provide CPU
 * isolation by running node execution in separate worker threads.
 * 
 * Key benefits:
 * 1. CPU Isolation - Long-running or CPU-intensive nodes don't block the main event loop
 * 2. Process Stability - A crash in one node execution doesn't affect other jobs
 * 3. Memory Isolation - Each worker thread has its own memory space
 * 4. Better Resource Utilization - True parallelism on multi-core systems
 * 
 * Requirements covered:
 * - FR-5.1: Create separate processor file for node execution
 * - FR-5.2: Support `useWorkerThreads` option for CPU isolation
 * - FR-5.3: Maintain compatibility with current inline processor
 * - FR-5.4: Configuration flag to enable/disable sandboxing
 */

import { Redis } from 'ioredis';
import * as path from 'path';
import { NodeRegistry } from '../engine/registry';
import { WorkflowEngine } from '../engine/workflow-engine';
import { InMemoryExecutionStore } from '../db/inmemory-store';
import type { EngineConfig } from '../engine/config';
import type { WorkflowDefinition, INodeExecutor, ExecutionContext, ExecutionResult } from '../types';

// ============================================================================
// ARCHITECTURE OVERVIEW
// ============================================================================

/**
 * Sandboxed Processor Architecture
 * 
 * When `useWorkerThreads: true` is enabled, the workflow engine uses BullMQ's
 * sandboxed processor feature. Instead of running node execution inline in the
 * main worker process, jobs are processed in separate worker threads.
 * 
 * File Structure:
 * ```
 * engine/
 * ├── processors/
 * │   ├── node-processor.sandbox.ts   # Sandboxed processor entry point
 * │   ├── node-processor.sandbox.js   # Compiled JavaScript (required by BullMQ)
 * │   ├── serialization.ts            # Data serialization utilities
 * │   └── stateless-utils.ts          # Pure processing functions
 * ├── node-processor.ts               # Main processor (inline or delegates)
 * └── worker-manager.ts               # Configures sandboxing
 * ```
 * 
 * Data Flow:
 * ```
 * Main Thread                          Worker Thread
 * ┌─────────────────┐                  ┌─────────────────┐
 * │  WorkerManager  │                  │ Sandbox Processor│
 * │                 │  serialize       │                 │
 * │  Job Data ──────┼─────────────────►│  deserialize    │
 * │                 │                  │       │         │
 * │                 │                  │       ▼         │
 * │                 │                  │  Process Node   │
 * │                 │                  │       │         │
 * │                 │  deserialize     │       ▼         │
 * │  Result ◄───────┼─────────────────┤  serialize      │
 * └─────────────────┘                  └─────────────────┘
 * ```
 */

// ============================================================================
// Example 1: Basic Sandboxed Processor Setup
// ============================================================================

/**
 * Enable sandboxed processor with default configuration.
 * 
 * IMPORTANT: Before enabling sandboxed processors, ensure the TypeScript
 * processor file has been compiled to JavaScript:
 * 
 * ```bash
 * # Compile the sandbox processor
 * bun build engine/processors/node-processor.sandbox.ts \
 *   --outdir engine/processors \
 *   --target node
 * ```
 */
async function basicSandboxedSetup() {
    console.log('📦 Example 1: Basic Sandboxed Processor Setup\n');

    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    const stateStore = new InMemoryExecutionStore();

    // Enable sandboxed worker threads
    const engineConfig: EngineConfig = {
        useWorkerThreads: true,
        workerConcurrency: 5,
    };

    const engine = new WorkflowEngine(
        registry,
        stateStore,
        redis,
        undefined, // metricsCollector
        undefined, // circuitBreakerRegistry
        undefined, // cacheOptions
        undefined, // payloadManager
        engineConfig
    );

    console.log('✅ Engine configured with sandboxed processors:');
    console.log('   - useWorkerThreads: true');
    console.log('   - Default processor: engine/processors/node-processor.sandbox.js');
    console.log('   - Worker concurrency: 5\n');

    await engine.close();
    await redis.quit();
}

// ============================================================================
// Example 2: Custom Processor File Path
// ============================================================================

/**
 * Use a custom processor file for sandboxed execution.
 * 
 * This is useful when you need to:
 * - Use a different processor implementation
 * - Load additional dependencies in the worker thread
 * - Customize the sandboxed execution environment
 */
async function customProcessorPath() {
    console.log('📦 Example 2: Custom Processor File Path\n');

    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    const stateStore = new InMemoryExecutionStore();

    // Specify a custom processor file path
    const engineConfig: EngineConfig = {
        useWorkerThreads: true,
        processorFile: path.join(__dirname, '../engine/processors/node-processor.sandbox.js'),
        workerConcurrency: 10,
    };

    const engine = new WorkflowEngine(
        registry,
        stateStore,
        redis,
        undefined,
        undefined,
        undefined,
        undefined,
        engineConfig
    );

    console.log('✅ Engine configured with custom processor path:');
    console.log(`   - processorFile: ${engineConfig.processorFile}`);
    console.log('   - Worker concurrency: 10\n');

    await engine.close();
    await redis.quit();
}

// ============================================================================
// Example 3: Serialization Considerations
// ============================================================================

/**
 * Understanding data serialization for sandboxed processors.
 * 
 * When job data passes between the main thread and worker threads, certain
 * types require special handling. The engine automatically handles:
 * 
 * ✅ Supported Types:
 * - Primitives (string, number, boolean, null)
 * - Plain objects and arrays
 * - Date objects (serialized as ISO strings)
 * - Error objects (serialized with message/stack)
 * - BigInt (serialized as string with type marker)
 * - Buffer/Uint8Array (serialized as base64)
 * - Map and Set (serialized with type markers)
 * 
 * ❌ Not Supported:
 * - Functions (removed with warning)
 * - Symbols (removed with warning)
 * - WeakMap/WeakSet (cannot be serialized)
 * - Circular references (replaced with null)
 */
function serializationConsiderations() {
    console.log('📦 Example 3: Serialization Considerations\n');

    // Example of data that serializes correctly
    const validJobData = {
        executionId: 'exec_123',
        workflowId: 'my-workflow',
        nodeId: 'process-data',
        inputData: {
            userId: 123,
            createdAt: new Date(),           // ✅ Serialized as ISO string
            metadata: {
                tags: ['important', 'urgent'],
                count: BigInt(9007199254740991), // ✅ Serialized as string
            },
            binaryData: Buffer.from('hello'), // ✅ Serialized as base64
        },
    };

    console.log('✅ Valid job data structure:');
    console.log(JSON.stringify(validJobData, (key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
        if (value instanceof Date) return value.toISOString();
        return value;
    }, 2));

    // Example of data that will cause issues
    console.log('\n⚠️  Data types that cannot be serialized:');
    console.log('   - Functions: () => {} (removed)');
    console.log('   - Symbols: Symbol("id") (removed)');
    console.log('   - WeakMap/WeakSet (throws error)');
    console.log('   - Circular references (replaced with null)\n');
}

// ============================================================================
// Example 4: Environment Variables for Sandboxed Processors
// ============================================================================

/**
 * Environment variables required for sandboxed processor execution.
 * 
 * When running in a worker thread, the sandboxed processor needs to
 * establish its own connections to Redis and optionally the database.
 */
function environmentVariables() {
    console.log('📦 Example 4: Environment Variables\n');

    console.log('Required environment variables for sandboxed processors:\n');

    console.log('SPANE_REDIS_URL or REDIS_URL');
    console.log('   Redis connection URL for the worker thread');
    console.log('   Example: redis://localhost:6379\n');

    console.log('Optional environment variables:\n');

    console.log('SPANE_DATABASE_URL or DATABASE_URL');
    console.log('   Database URL for DrizzleExecutionStateStore');
    console.log('   If not provided, InMemoryExecutionStore is used');
    console.log('   Example: postgresql://user:pass@localhost:5432/spane\n');

    console.log('SPANE_ENGINE_CONFIG');
    console.log('   JSON string of EngineConfig options');
    console.log('   Example: {"workerConcurrency":10,"useNativeRateLimiting":true}\n');

    console.log('NODE_ENV');
    console.log('   Set to "production" to disable serialization warnings');
    console.log('   Example: production\n');
}

// ============================================================================
// Example 5: Error Handling in Sandboxed Processors
// ============================================================================

/**
 * How errors are handled in sandboxed processor execution.
 * 
 * The WorkerManager includes comprehensive error handling for:
 * - Worker thread crashes
 * - Serialization failures
 * - Stalled jobs (when worker crashes mid-execution)
 */
async function errorHandling() {
    console.log('📦 Example 5: Error Handling\n');

    console.log('The engine handles sandboxed processor errors automatically:\n');

    console.log('1. Worker Thread Crashes');
    console.log('   - Detected via worker.on("error") event');
    console.log('   - Logged with stack trace and context');
    console.log('   - BullMQ automatically recovers the worker');
    console.log('   - Affected jobs are moved to stalled state\n');

    console.log('2. Stalled Jobs');
    console.log('   - Detected via worker.on("stalled") event');
    console.log('   - Indicates worker crashed mid-execution');
    console.log('   - Jobs are automatically retried by BullMQ');
    console.log('   - Logged with job ID and previous state\n');

    console.log('3. Serialization Errors');
    console.log('   - Caught in the sandbox processor');
    console.log('   - Returns failure result instead of throwing');
    console.log('   - Error message is sanitized for serialization');
    console.log('   - Logged with node and execution context\n');

    console.log('4. Processor File Not Found');
    console.log('   - Detected at worker startup');
    console.log('   - Throws descriptive error with file path');
    console.log('   - Prevents cryptic runtime errors\n');
}

// ============================================================================
// Example 6: Combining Sandboxed Processors with Other Features
// ============================================================================

/**
 * Using sandboxed processors alongside other engine features.
 */
async function combinedFeatures() {
    console.log('📦 Example 6: Combined Features\n');

    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    const stateStore = new InMemoryExecutionStore();

    // Full-featured configuration with sandboxed processors
    const engineConfig: EngineConfig = {
        // Sandboxed execution
        useWorkerThreads: true,
        workerConcurrency: 10,

        // Rate limiting (works with sandboxed processors)
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 100,
            duration: 1000,
        },

        // Sub-workflow handling
        useFlowProducerForSubWorkflows: true,

        // Simplified event streaming
        useSimplifiedEventStream: true,
    };

    const engine = new WorkflowEngine(
        registry,
        stateStore,
        redis,
        undefined,
        undefined,
        undefined,
        undefined,
        engineConfig
    );

    console.log('✅ Engine configured with all features:');
    console.log('   - Sandboxed worker threads: enabled');
    console.log('   - Worker concurrency: 10');
    console.log('   - Native rate limiting: 100 jobs/second');
    console.log('   - FlowProducer for sub-workflows: enabled');
    console.log('   - Simplified event streaming: enabled\n');

    await engine.close();
    await redis.quit();
}

// ============================================================================
// Example 7: Monitoring Sandboxed Processor Performance
// ============================================================================

/**
 * Monitoring and debugging sandboxed processor execution.
 */
function monitoringAndDebugging() {
    console.log('📦 Example 7: Monitoring and Debugging\n');

    console.log('Monitoring sandboxed processor execution:\n');

    console.log('1. Worker Events');
    console.log('   worker.on("completed", (job) => { ... })');
    console.log('   worker.on("failed", (job, err) => { ... })');
    console.log('   worker.on("error", (err) => { ... })');
    console.log('   worker.on("stalled", (jobId) => { ... })\n');

    console.log('2. Log Messages');
    console.log('   🧵 Worker threads enabled with sandboxed processor');
    console.log('   💥 Sandbox processor crashed - worker thread error detected');
    console.log('   ⚠️ Job stalled - may indicate sandbox crash');
    console.log('   🔄 Stalled job will be automatically retried\n');

    console.log('3. Prometheus Metrics (if enabled)');
    console.log('   - spane_nodes_executed_total');
    console.log('   - spane_nodes_failed_total');
    console.log('   - spane_dlq_items_total\n');

    console.log('4. Development Mode Warnings');
    console.log('   - Serialization issues logged to console');
    console.log('   - Non-serializable data types identified');
    console.log('   - Set NODE_ENV=production to disable\n');
}

// ============================================================================
// Example 8: Creating a Custom Sandboxed Processor
// ============================================================================

/**
 * How to create a custom sandboxed processor file.
 * 
 * If you need to customize the sandboxed execution environment, you can
 * create your own processor file following this pattern.
 */
function customProcessorExample() {
    console.log('📦 Example 8: Custom Sandboxed Processor\n');

    console.log('To create a custom sandboxed processor:\n');

    console.log('1. Create a new TypeScript file:');
    console.log('   engine/processors/my-custom-processor.sandbox.ts\n');

    console.log('2. Use the module.exports pattern (required by BullMQ):');
    console.log(`
   import type { SandboxedJob } from 'bullmq';
   import type { NodeJobData } from '../types';
   import type { ExecutionResult } from '../../types';
   import { deserializeJobData, serializeExecutionResult } from './serialization';

   module.exports = async (job: SandboxedJob<NodeJobData>): Promise<ExecutionResult> => {
       // Deserialize job data
       const data = deserializeJobData(job.data);
       
       // Your custom processing logic here
       const result = await processNode(data);
       
       // Serialize result for return
       return serializeExecutionResult(result);
   };
`);

    console.log('3. Compile to JavaScript:');
    console.log('   bun build engine/processors/my-custom-processor.sandbox.ts \\');
    console.log('     --outdir engine/processors --target node\n');

    console.log('4. Configure the engine to use your processor:');
    console.log(`
   const engineConfig: EngineConfig = {
       useWorkerThreads: true,
       processorFile: path.join(__dirname, 'processors/my-custom-processor.sandbox.js'),
   };
`);
}

// ============================================================================
// Example 9: Inline vs Sandboxed Processor Comparison
// ============================================================================

/**
 * Comparison between inline and sandboxed processor modes.
 */
function inlineVsSandboxed() {
    console.log('📦 Example 9: Inline vs Sandboxed Comparison\n');

    console.log('┌─────────────────────┬──────────────────────┬──────────────────────┐');
    console.log('│ Feature             │ Inline Processor     │ Sandboxed Processor  │');
    console.log('├─────────────────────┼──────────────────────┼──────────────────────┤');
    console.log('│ CPU Isolation       │ ❌ Shared event loop │ ✅ Separate thread   │');
    console.log('│ Memory Isolation    │ ❌ Shared memory     │ ✅ Separate heap     │');
    console.log('│ Crash Recovery      │ ⚠️ May affect others │ ✅ Isolated crashes  │');
    console.log('│ Startup Time        │ ✅ Instant           │ ⚠️ Thread spawn time │');
    console.log('│ Data Serialization  │ ✅ Not needed        │ ⚠️ Required          │');
    console.log('│ Debugging           │ ✅ Easy              │ ⚠️ More complex      │');
    console.log('│ Resource Usage      │ ✅ Lower             │ ⚠️ Higher per thread │');
    console.log('│ True Parallelism    │ ❌ Single-threaded   │ ✅ Multi-core        │');
    console.log('└─────────────────────┴──────────────────────┴──────────────────────┘\n');

    console.log('When to use sandboxed processors:');
    console.log('   ✅ CPU-intensive node operations');
    console.log('   ✅ Long-running synchronous code');
    console.log('   ✅ Untrusted or third-party node executors');
    console.log('   ✅ High-throughput multi-core systems\n');

    console.log('When to use inline processors:');
    console.log('   ✅ I/O-bound operations (HTTP, database)');
    console.log('   ✅ Simple, fast node operations');
    console.log('   ✅ Development and debugging');
    console.log('   ✅ Resource-constrained environments\n');
}

// ============================================================================
// Main: Run all examples
// ============================================================================

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           Sandboxed Processor Setup Guide');
    console.log('═══════════════════════════════════════════════════════════════\n');

    try {
        await basicSandboxedSetup();
        console.log('───────────────────────────────────────────────────────────────\n');

        await customProcessorPath();
        console.log('───────────────────────────────────────────────────────────────\n');

        serializationConsiderations();
        console.log('───────────────────────────────────────────────────────────────\n');

        environmentVariables();
        console.log('───────────────────────────────────────────────────────────────\n');

        await errorHandling();
        console.log('───────────────────────────────────────────────────────────────\n');

        await combinedFeatures();
        console.log('───────────────────────────────────────────────────────────────\n');

        monitoringAndDebugging();
        console.log('───────────────────────────────────────────────────────────────\n');

        customProcessorExample();
        console.log('───────────────────────────────────────────────────────────────\n');

        inlineVsSandboxed();

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('                    Guide Complete!');
        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Example failed:', error);
        process.exit(1);
    }
}

// Run if executed directly
main();
