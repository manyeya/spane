import { WorkflowEngine } from './engine/workflow-engine';
import { WorkflowAPIController } from './api';
import { InMemoryExecutionStore } from './db/inmemory-store';
import { DrizzleExecutionStateStore } from './db/drizzle-store';
import { HybridExecutionStateStore } from './db/hybrid-store';
import { NodeRegistry } from './engine/registry';
import { Redis } from 'ioredis';
import { HealthMonitor } from './utils/health';
import { MetricsCollector } from './utils/metrics';
import { CircuitBreakerRegistry } from './utils/circuit-breaker';
import { GracefulShutdown } from './utils/graceful-shutdown';

// Re-export event types for external consumers
export {
  type BaseEvent,
  type NodeProgressEvent,
  type WorkflowStatusEvent,
  type ExecutionStateEvent,
  type ErrorEvent,
  type WorkflowEvent,
  type NodeStatus,
  type WorkflowStatus,
  type ProgressPayload,
  isValidWorkflowEvent,
  isNodeProgressEvent,
  isWorkflowStatusEvent,
  isExecutionStateEvent,
  isErrorEvent,
} from './engine/event-types';

// Re-export event emitter for external consumers
export { WorkflowEventEmitter } from './engine/event-emitter';

// Initialize Redis connection
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Initialize components
const nodeRegistry = new NodeRegistry();

// Choose state store based on DATABASE_URL environment variable
// When both Redis and DATABASE_URL are available, use HybridExecutionStateStore
// for Redis-first active execution state with database persistence on completion
let stateStore;
let storeType: string;

if (process.env.DATABASE_URL) {
  const drizzleStore = new DrizzleExecutionStateStore(process.env.DATABASE_URL, redis);
  
  // Use hybrid store when both Redis and DB are available (default behavior)
  // Set DISABLE_HYBRID_STORE=true to use DrizzleStore directly
  if (process.env.DISABLE_HYBRID_STORE !== 'true') {
    stateStore = new HybridExecutionStateStore(redis, drizzleStore, {
      redisTTL: parseInt(process.env.REDIS_EXECUTION_TTL || '86400'), // 24 hours default
      persistRetries: parseInt(process.env.DB_PERSIST_RETRIES || '3'),
    });
    storeType = 'Hybrid (Redis + Postgres)';
  } else {
    stateStore = drizzleStore;
    storeType = 'Postgres';
  }
} else {
  stateStore = new InMemoryExecutionStore();
  storeType = 'in-memory';
}

console.log(`📦 Using ${storeType} state store`);

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

// Perform startup recovery for orphaned Redis executions (if using hybrid store)
if (stateStore instanceof HybridExecutionStateStore) {
  const recoveryThreshold = parseInt(process.env.RECOVERY_TTL_THRESHOLD || '3600'); // 1 hour default
  stateStore.recoverOrphanedExecutions(recoveryThreshold)
    .then((results) => {
      if (results.recovered > 0 || results.failed > 0) {
        console.log(`🔄 Startup recovery: ${results.recovered} executions recovered, ${results.failed} failed`);
      }
    })
    .catch((error) => {
      console.error('❌ Startup recovery failed:', error);
    });
}

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