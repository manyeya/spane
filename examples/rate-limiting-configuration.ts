/**
 * Rate Limiting Configuration Examples
 * 
 * This file demonstrates how to configure and use BullMQ's native rate limiting
 * in the workflow engine. Rate limiting helps prevent overwhelming external APIs
 * and ensures fair resource usage across workflows.
 * 
 * Key concepts:
 * 1. Global rate limiting - Applied at the Worker level to all node executions
 * 2. Manual rate limiting - For handling 429 responses from external APIs
 * 
 * Requirements covered:
 * - FR-2.1: BullMQ Worker limiter replaces custom Redis INCR/EXPIRE
 * - FR-2.2: Per-node-type rate limits via worker configuration
 * - FR-2.3: Manual rate limiting with worker.rateLimit() for external API responses
 */

import { Redis } from 'ioredis';
import { NodeRegistry, WorkflowEngine, InMemoryExecutionStore } from 'spane';
import type { EngineConfig, WorkflowDefinition, INodeExecutor, ExecutionContext, ExecutionResult } from 'spane';

// ============================================================================
// Example 1: Basic Global Rate Limiting
// ============================================================================

/**
 * Configure global rate limiting for all node executions.
 * This limits the total number of jobs processed per time window.
 */
async function basicRateLimitingExample() {
    console.log('📊 Example 1: Basic Global Rate Limiting\n');

    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    const stateStore = new InMemoryExecutionStore();

    // Configure rate limiting: max 100 jobs per second
    const engineConfig: EngineConfig = {
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 100,      // Maximum number of jobs
            duration: 1000, // Time window in milliseconds (1 second)
        },
        workerConcurrency: 10,
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

    console.log('✅ Engine configured with rate limiting:');
    console.log(`   - Max jobs: ${engineConfig.rateLimiter?.max}`);
    console.log(`   - Duration: ${engineConfig.rateLimiter?.duration}ms`);
    console.log(`   - Effective rate: ${engineConfig.rateLimiter?.max} jobs/second\n`);

    await engine.close();
    await redis.quit();
}

// ============================================================================
// Example 2: Different Rate Limiting Configurations
// ============================================================================

/**
 * Examples of different rate limiting configurations for various use cases.
 */
function rateLimitingConfigurations() {
    console.log('📊 Example 2: Rate Limiting Configuration Patterns\n');

    // High-throughput internal processing
    const highThroughputConfig: EngineConfig = {
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 1000,     // 1000 jobs
            duration: 1000, // per second
        },
        workerConcurrency: 50,
    };
    console.log('🚀 High-throughput config: 1000 jobs/second, 50 concurrent workers');

    // Conservative external API calls
    const conservativeConfig: EngineConfig = {
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 10,       // 10 jobs
            duration: 1000, // per second
        },
        workerConcurrency: 5,
    };
    console.log('🐢 Conservative config: 10 jobs/second, 5 concurrent workers');

    // Burst-friendly configuration (allows bursts, then throttles)
    const burstFriendlyConfig: EngineConfig = {
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 50,       // 50 jobs
            duration: 5000, // per 5 seconds (10 jobs/second average)
        },
        workerConcurrency: 20,
    };
    console.log('💥 Burst-friendly config: 50 jobs per 5 seconds (allows bursts)');

    // Minute-based rate limiting
    const minuteBasedConfig: EngineConfig = {
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 60,        // 60 jobs
            duration: 60000, // per minute
        },
        workerConcurrency: 5,
    };
    console.log('⏱️  Minute-based config: 60 jobs/minute\n');

    return {
        highThroughputConfig,
        conservativeConfig,
        burstFriendlyConfig,
        minuteBasedConfig,
    };
}

// ============================================================================
// Example 3: Manual Rate Limiting for External APIs
// ============================================================================

/**
 * Custom HTTP executor that handles 429 (Too Many Requests) responses
 * using manual rate limiting.
 * 
 * When an external API returns a 429 response with a Retry-After header,
 * the executor can use the rateLimit function to pause processing.
 */
class RateLimitAwareHttpExecutor implements INodeExecutor {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const { url, method = 'GET', headers = {} } = context.nodeConfig || {};

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: method !== 'GET' ? JSON.stringify(context.inputData) : undefined,
            });

            // Handle rate limiting response from external API
            if (response.status === 429) {
                // Get retry delay from Retry-After header (in seconds)
                const retryAfter = response.headers.get('Retry-After');
                const delayMs = retryAfter 
                    ? parseInt(retryAfter) * 1000 
                    : 60000; // Default to 60 seconds if no header

                console.log(`⏳ Rate limited by API. Waiting ${delayMs}ms before retry.`);

                // Use manual rate limiting if available (provided by engine for external nodes)
                if (context.rateLimit) {
                    // This pauses the worker for the specified duration
                    // and throws a RateLimitError to move the job back to waiting
                    throw await context.rateLimit(delayMs);
                }

                // Fallback: return error if rateLimit not available
                return {
                    success: false,
                    error: `Rate limited. Retry after ${delayMs}ms`,
                };
            }

            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                };
            }

            const data = await response.json();
            return { success: true, data };

        } catch (error: any) {
            // Re-throw RateLimitError to let BullMQ handle it
            if (error.name === 'RateLimitError') {
                throw error;
            }

            return {
                success: false,
                error: error.message,
            };
        }
    }
}

/**
 * Example workflow using the rate-limit-aware HTTP executor.
 */
async function manualRateLimitingExample() {
    console.log('📊 Example 3: Manual Rate Limiting for External APIs\n');

    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    
    // Register the rate-limit-aware HTTP executor
    registry.register('http-rate-aware', new RateLimitAwareHttpExecutor());

    const stateStore = new InMemoryExecutionStore();

    // Enable native rate limiting to get the rateLimit function in context
    const engineConfig: EngineConfig = {
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 50,
            duration: 1000,
        },
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

    // Define a workflow that calls an external API
    const workflow: WorkflowDefinition = {
        id: 'api-caller-workflow',
        name: 'API Caller with Rate Limit Handling',
        entryNodeId: 'fetch-data',
        nodes: [
            {
                id: 'fetch-data',
                type: 'http-rate-aware',
                config: {
                    url: 'https://api.example.com/data',
                    method: 'GET',
                },
                inputs: [],
                outputs: ['process-data'],
            },
            {
                id: 'process-data',
                type: 'transform',
                config: {},
                inputs: ['fetch-data'],
                outputs: [],
            },
        ],
    };

    await engine.registerWorkflow(workflow);
    console.log('✅ Workflow registered with rate-limit-aware HTTP executor');
    console.log('   When the API returns 429, the job will be automatically retried\n');

    await engine.close();
    await redis.quit();
}

// ============================================================================
// Example 4: Combining Rate Limiting with Other Features
// ============================================================================

/**
 * Example showing rate limiting combined with other engine features.
 */
async function combinedFeaturesExample() {
    console.log('📊 Example 4: Rate Limiting with Other Features\n');

    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    registry.registerDefaultExternalNodes(); // Includes circuit breaker support

    const stateStore = new InMemoryExecutionStore();

    // Full-featured configuration
    const engineConfig: EngineConfig = {
        // Rate limiting
        useNativeRateLimiting: true,
        rateLimiter: {
            max: 100,
            duration: 1000,
        },

        // Worker configuration
        workerConcurrency: 10,

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

    console.log('✅ Engine configured with multiple features:');
    console.log('   - Native rate limiting: 100 jobs/second');
    console.log('   - Worker concurrency: 10');
    console.log('   - FlowProducer for sub-workflows: enabled');
    console.log('   - Simplified event streaming: enabled\n');

    // Example workflow with retry policy and rate limiting
    const workflow: WorkflowDefinition = {
        id: 'robust-api-workflow',
        name: 'Robust API Workflow',
        entryNodeId: 'call-api',
        nodes: [
            {
                id: 'call-api',
                type: 'http',
                config: {
                    url: 'https://api.example.com/endpoint',
                    method: 'POST',
                    // Retry policy works alongside rate limiting
                    retryPolicy: {
                        maxAttempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 1000,
                        },
                        continueOnFail: false,
                    },
                },
                inputs: [],
                outputs: [],
            },
        ],
    };

    await engine.registerWorkflow(workflow);
    console.log('✅ Workflow registered with retry policy');
    console.log('   Rate limiting + retries = resilient API calls\n');

    await engine.close();
    await redis.quit();
}

// ============================================================================
// Example 5: Monitoring Rate Limiting
// ============================================================================

/**
 * Example showing how to monitor rate limiting behavior.
 */
function monitoringExample() {
    console.log('📊 Example 5: Monitoring Rate Limiting\n');

    console.log('Rate limiting events can be monitored through:');
    console.log('');
    console.log('1. Worker events:');
    console.log('   worker.on("stalled", (jobId) => { ... })');
    console.log('   worker.on("waiting", (jobId) => { ... })');
    console.log('');
    console.log('2. Queue metrics:');
    console.log('   const waiting = await queue.getWaitingCount();');
    console.log('   const delayed = await queue.getDelayedCount();');
    console.log('');
    console.log('3. Prometheus metrics (if enabled):');
    console.log('   - spane_nodes_executed_total');
    console.log('   - spane_nodes_failed_total');
    console.log('   - spane_dlq_items_total');
    console.log('');
    console.log('4. Application logs:');
    console.log('   🚦 Native rate limiting enabled');
    console.log('   ⏳ Job rate limited, will be retried\n');
}

// ============================================================================
// Main: Run all examples
// ============================================================================

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           Rate Limiting Configuration Examples');
    console.log('═══════════════════════════════════════════════════════════════\n');

    try {
        await basicRateLimitingExample();
        console.log('───────────────────────────────────────────────────────────────\n');

        rateLimitingConfigurations();
        console.log('───────────────────────────────────────────────────────────────\n');

        await manualRateLimitingExample();
        console.log('───────────────────────────────────────────────────────────────\n');

        await combinedFeaturesExample();
        console.log('───────────────────────────────────────────────────────────────\n');

        monitoringExample();

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('                    Examples Complete!');
        console.log('═══════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Example failed:', error);
        process.exit(1);
    }
}

// Run if executed directly
main();
