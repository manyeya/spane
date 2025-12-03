import { WorkflowEngine } from './engine/workflow-engine';
import { WorkflowAPIController } from './api';
import { InMemoryExecutionStore } from './db/inmemory-store';
import { DrizzleExecutionStateStore } from './db/drizzle-store';
import { NodeRegistry } from './engine/registry';
import { Redis } from 'ioredis';
import { HealthMonitor } from './utils/health';
import { MetricsCollector } from './utils/metrics';
import { CircuitBreakerRegistry } from './utils/circuit-breaker';
import { GracefulShutdown } from './utils/graceful-shutdown';

// Initialize Redis connection
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Initialize components
const nodeRegistry = new NodeRegistry();

// Choose state store based on DATABASE_URL environment variable
const stateStore = process.env.DATABASE_URL
  ? new DrizzleExecutionStateStore(process.env.DATABASE_URL, redis)
  : new InMemoryExecutionStore();

console.log(`📦 Using ${process.env.DATABASE_URL ? 'Postgres' : 'in-memory'} state store`);

// Initialize production operations features (optional)
const enableProductionOps = process.env.ENABLE_PRODUCTION_OPS !== 'false'; // Enabled by default

let healthMonitor: HealthMonitor | undefined;
let metricsCollector: MetricsCollector | undefined;
let circuitBreakerRegistry: CircuitBreakerRegistry | undefined;
let gracefulShutdown: GracefulShutdown | undefined;

if (enableProductionOps) {
  console.log('🏥 Enabling production operations features...');

  healthMonitor = new HealthMonitor(redis);
  metricsCollector = new MetricsCollector();
  circuitBreakerRegistry = new CircuitBreakerRegistry();
  gracefulShutdown = new GracefulShutdown({
    timeout: parseInt(process.env.SHUTDOWN_TIMEOUT || '30000'),
    forceExit: true,
  });
}

const engine = new WorkflowEngine(
  nodeRegistry,
  stateStore,
  redis,
  metricsCollector,
  circuitBreakerRegistry
);

const api = new WorkflowAPIController(
  engine,
  stateStore,
  healthMonitor,
  metricsCollector,
  circuitBreakerRegistry,
  gracefulShutdown
);

// Start workers
const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5');
engine.startWorkers(concurrency);

// Register workers and queues with production ops
if (enableProductionOps && healthMonitor && gracefulShutdown) {
  // Note: Workers are private in WorkflowEngine, so we register via the engine's close method
  gracefulShutdown.registerRedis(redis);
  gracefulShutdown.registerCleanupHandler(async () => {
    console.log('Closing workflow engine...');
    await engine.close();
  });
}

// Start the server
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
api.listen(PORT);

console.log(`🚀 SPANE workflow engine started on port ${PORT}`);
console.log(`📊 Health check: http://localhost:${PORT}/health`);
console.log(`📈 Metrics: http://localhost:${PORT}/metrics`);
console.log(`📚 API stats: http://localhost:${PORT}/api/stats`);

if (enableProductionOps) {
  console.log('✅ Production operations enabled:');
  console.log('   - Health monitoring: /health, /health/live, /health/ready');
  console.log('   - Metrics: /metrics (Prometheus), /metrics/json');
  console.log('   - Circuit breakers: /circuit-breakers');
  console.log('   - Graceful shutdown: SIGTERM/SIGINT handling');
}