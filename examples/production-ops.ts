/**
 * Production Operations Example
 * 
 * Demonstrates:
 * - Health monitoring endpoints
 * - Metrics collection and export
 * - Circuit breaker pattern usage
 * - Graceful shutdown handling
 */

import { WorkflowEngine } from '../workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import { Redis } from 'ioredis';
import { HealthMonitor } from '../health';
import { MetricsCollector } from '../metrics';
import { CircuitBreakerRegistry } from '../circuit-breaker';
import { GracefulShutdown } from '../graceful-shutdown';
import type { WorkflowDefinition, ExecutionContext, ExecutionResult } from '../types';

// Initialize Redis
const redis = new Redis('redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

// Initialize production operations components
const healthMonitor = new HealthMonitor(redis);
const metricsCollector = new MetricsCollector();
const circuitBreakerRegistry = new CircuitBreakerRegistry();
const gracefulShutdown = new GracefulShutdown({
    timeout: 30000,
    forceExit: true,
});

// Initialize workflow engine
const registry = new NodeRegistry();
const stateStore = new InMemoryExecutionStore();
const engine = new WorkflowEngine(
    registry,
    stateStore,
    redis,
    metricsCollector,
    circuitBreakerRegistry
);

// Register cleanup handlers
gracefulShutdown.registerRedis(redis);
gracefulShutdown.registerCleanupHandler(async () => {
    console.log('Cleaning up workflow engine...');
    await engine.close();
});

// Register a node that uses circuit breaker
registry.register('api-call', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const breaker = circuitBreakerRegistry.getOrCreate('external-api', {
            failureThreshold: 3,
            successThreshold: 2,
            timeout: 60000,
            monitoringPeriod: 120000,
        });

        try {
            const result = await breaker.execute(async () => {
                // Simulate API call
                const shouldFail = Math.random() < 0.3; // 30% failure rate

                if (shouldFail) {
                    throw new Error('External API unavailable');
                }

                return { data: 'API response data' };
            });

            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
});

// Register a simple processing node
registry.register('process', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const { inputData } = context;

        // Simulate processing
        await new Promise(resolve => setTimeout(resolve, 100));

        return {
            success: true,
            data: { processed: true, input: inputData },
        };
    }
});

// Define workflow
const workflow: WorkflowDefinition = {
    id: 'production-ops-demo',
    name: 'Production Operations Demo',
    nodes: [
        {
            id: 'api-call-1',
            type: 'api-call',
            inputs: [],
            outputs: ['process-1'],
            config: {},
        },
        {
            id: 'process-1',
            type: 'process',
            inputs: ['api-call-1'],
            outputs: [],
            config: {},
        },
    ],
};

async function demonstrateProductionOps() {
    console.log('🏭 Production Operations Demo\n');

    // Register workflow
    await engine.registerWorkflow(workflow);
    console.log('✅ Workflow registered\n');

    // Start workers
    engine.startWorkers(3);
    console.log('✅ Workers started\n');

    // 1. Health Monitoring
    console.log('📊 1. Health Monitoring');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const health = await healthMonitor.getHealth();
    console.log('Health Status:', JSON.stringify(health, null, 2));

    const liveness = await healthMonitor.getLiveness();
    console.log('Liveness:', liveness);

    const readiness = await healthMonitor.getReadiness();
    console.log('Readiness:', readiness);
    console.log();

    // 2. Execute workflows to generate metrics
    console.log('🚀 2. Executing Workflows');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const executionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
        const execId = await engine.enqueueWorkflow('production-ops-demo', { iteration: i });
        executionIds.push(execId);
        console.log(`Enqueued workflow ${i + 1}: ${execId}`);
    }

    // Wait for workflows to complete
    console.log('\n⏳ Waiting for workflows to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log();

    // 3. Metrics Collection
    console.log('📈 3. Metrics Collection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Update queue metrics
    await metricsCollector.updateQueueMetrics();

    // Get metrics in JSON format
    const metricsJson = metricsCollector.toJSON();
    console.log('Metrics (JSON):', JSON.stringify(metricsJson, null, 2));

    console.log('\nMetrics (Prometheus format):');
    console.log('─────────────────────────────────────────');
    const prometheusMetrics = metricsCollector.toPrometheus();
    console.log(prometheusMetrics.split('\n').slice(0, 20).join('\n')); // Show first 20 lines
    console.log('... (truncated)\n');

    // 4. Circuit Breaker Status
    console.log('🔌 4. Circuit Breaker Status');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const breakerStats = circuitBreakerRegistry.getAllStats();
    console.log('Circuit Breakers:', JSON.stringify(breakerStats, null, 2));
    console.log();

    // 5. Queue Statistics
    console.log('📊 5. Queue Statistics');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const queueStats = await engine.getQueueStats();
    console.log('Queue Stats:', JSON.stringify(queueStats, null, 2));
    console.log();

    // 6. Graceful Shutdown Demo
    console.log('🛑 6. Graceful Shutdown');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Shutdown status:', {
        inProgress: gracefulShutdown.isShutdownInProgress(),
    });
    console.log('\nTo test graceful shutdown, send SIGTERM or SIGINT (Ctrl+C)');
    console.log('The system will:');
    console.log('  1. Stop accepting new jobs');
    console.log('  2. Wait for active jobs to complete');
    console.log('  3. Close all queues and connections');
    console.log('  4. Exit gracefully\n');

    // 7. Production Endpoints
    console.log('🌐 7. Production Endpoints');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('If running with API server, these endpoints are available:');
    console.log('  - GET  /health              - Detailed health check');
    console.log('  - GET  /health/live         - Liveness probe (K8s)');
    console.log('  - GET  /health/ready        - Readiness probe (K8s)');
    console.log('  - GET  /metrics             - Prometheus metrics');
    console.log('  - GET  /metrics/json        - JSON metrics');
    console.log('  - GET  /circuit-breakers    - Circuit breaker status');
    console.log('  - POST /circuit-breakers/:name/reset - Reset circuit breaker');
    console.log('  - GET  /shutdown/status     - Shutdown status\n');

    console.log('✅ Demo completed! Press Ctrl+C to test graceful shutdown.');
}

// Run the demo
demonstrateProductionOps().catch(console.error);
