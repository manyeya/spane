# SPANE

[![npm version](https://badge.fury.io/js/%40manyeya%2Fspane.svg)](https://www.npmjs.com/package/@manyeya/spane)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Parallel Asynchronous Node Execution** — An experimental workflow orchestration engine built on BullMQ and Redis.

SPANE executes DAG-based workflows with parallel node processing, automatic retries, state persistence, and comprehensive error handling.

> **Warning:** This is an experimental project. APIs may change between versions. Not recommended for production use without thorough testing.

**Version 0.2.0** — Active development with features including distributed locking, memory management, atomic state operations, and sub-workflow error handling.

## Features

- **Parallel Execution** — Run multiple nodes concurrently based on DAG dependencies
- **Sub-Workflows** — Compose workflows from other workflows with FlowProducer
- **State Persistence** — In-memory or PostgreSQL-backed execution state
- **Error Handling** — Standardized error classes with retry policies and DLQ support
- **Validation** — Runtime validation with Zod schemas, including circular reference detection
- **Triggers** — Webhook and scheduled (cron) workflow execution
- **Conditional Branching** — Dynamic path selection based on execution results
- **Rate Limiting** — Native BullMQ rate limiting per node type
- **Circuit Breakers** — Fault tolerance for external service calls
- **Advanced Features** — Distributed locking, memory management, and atomic operations

## Reliability Features

> **Note:** SPANE is experimental. The following features demonstrate the project's capabilities, but APIs may change.

SPANE v0.2.0 includes features for safe concurrent execution:

### Distributed Locking

Prevents race conditions when multiple workers process workflow completion simultaneously. The `DistributedLock` class provides Redis-based locking with configurable TTL and auto-renewal:

```typescript
import { DistributedLock } from '@manyeya/spane/utils/distributed-lock';
import type { Redis } from 'ioredis';

const redis: Redis = new Redis();
const lock = new DistributedLock(redis);

// Execute with automatic lock acquisition and release
const result = await lock.withLock('workflow-completion:exec-123', async (renew) => {
  // Critical section - only one process executes here
  await completeWorkflow(executionId);

  // Optionally extend the lock manually
  await renew(5000); // Extend by 5 seconds

  return { success: true };
}, {
  ttl: 5000,              // Lock expires after 5 seconds
  autoRenew: true,        // Automatically renew while held
  renewalRatio: 0.5,      // Renew at 50% of TTL
  maxRenewals: 10,        // Maximum renewal attempts
  operationType: 'default' // fast (10s), default (30s), long (2m), very-long (5m)
});

// Manual acquire/release pattern
const token = await lock.acquire('my-lock-key', 30000);
if (token) {
  try {
    await criticalOperation();
  } finally {
    await lock.release('my-lock-key', token);
  }
}
```

Key features:
- **Automatic TTL** — Locks auto-expire to prevent deadlocks
- **Auto-renewal** — Optional periodic renewal for long operations
- **Adaptive presets** — Built-in TTL presets for common operation types
- **Atomic operations** — Lua scripts for safe acquire/release/extend
- **Expiration warnings** — Optional callback when lock is about to expire

### Memory Management

`InMemoryExecutionStore` includes automatic memory management to prevent unbounded growth during development and testing:

```typescript
import { InMemoryExecutionStore, type InMemoryStoreConfig } from '@manyeya/spane';

const store = new InMemoryExecutionStore({
  // Evict completed/failed executions after TTL expires
  completedExecutionTtl: 3600_000,     // 1 hour default

  // LRU eviction when size limit reached
  maxExecutions: 1000,                  // Maximum executions in memory

  // Per-execution limits
  maxLogsPerExecution: 1000,            // Maximum log entries per execution
  maxSpansPerExecution: 500,            // Maximum spans per execution trace

  // Background cleanup interval
  cleanupInterval: 300_000,             // Run cleanup every 5 minutes
  enableCleanup: true                   // Enable automatic cleanup
});

// Get current store statistics
const stats = store.getStats();
console.log(`Executions: ${stats.executionCount}, Logs: ${stats.logCount}`);

// Manually trigger cleanup if needed
store.cleanup();

// Clear all data (useful for testing)
store.clear();

// Cleanup when done
store.destroy();
```

### Atomic State Operations

`DrizzleExecutionStateStore` uses multiple strategies to ensure data consistency under concurrent operations:

```typescript
import { DrizzleExecutionStateStore } from '@manyeya/spane';

const store = new DrizzleExecutionStateStore(
  process.env.DATABASE_URL!,
  redisCache,  // Optional Redis for caching
  3600,        // Cache TTL in seconds
  true         // Enable cache
);

// 1. Atomic Upserts (INSERT ... ON CONFLICT DO UPDATE)
// Prevents duplicate node results for the same execution/node pair
await store.updateNodeResult(executionId, nodeId, result);

// 2. Optimistic Locking for Status Updates
// Only updates if execution is still 'running'
await store.setExecutionStatus(executionId, 'completed');
// Prevents overwriting terminal states (completed, failed, cancelled)

// 3. Transactional Operations
// Atomic DLQ entry + node result + error log
await store.handlePermanentFailure(
  executionId,
  nodeId,
  jobData,
  errorMessage,
  attemptsMade
);

// Atomic node result + completion check + status update
const { completed, status } = await store.updateNodeResultWithCompletion(
  executionId,
  nodeId,
  result,
  totalNodes
);

// 4. Redis Caching with Write-Through
// Database is source of truth, cache provides fast reads
await store.cacheNodeResult(executionId, nodeId, result);
```

Transaction isolation guarantees:
- **Atomic upserts** — No duplicate node results via unique constraints
- **Optimistic locking** — Status updates only succeed for running executions
- **Transactional failures** — DLQ + result + log in single transaction
- **Cache invalidation** — Cache cleared after DB commit
- **Batch operations** — N+1 query prevention for child executions

### Input Validation

Workflow validation includes circular reference detection and comprehensive type safety using Zod:

```typescript
import {
  validateWorkflowDefinition,
  validateWorkflowDefinitionSafe,
  validateNodeConfig
} from '@manyeya/spane';

// Runtime validation (throws on error)
const validated = validateWorkflowDefinition(workflowDefinition);

// Safe validation (returns result object)
const result = validateWorkflowDefinitionSafe(workflowDefinition);
if (!result.success) {
  // result.errors contains validation details
  console.error('Validation errors:', result.errors);
}

// Node config validation with Zod schemas
import { z } from 'zod';

const HttpNodeSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  timeout: z.number().positive().optional()
});

const validatedConfig = validateNodeConfig(HttpNodeSchema, nodeConfig);
```

The validation system checks for:
- **Circular dependencies** — Detects cycles in the DAG
- **Missing entry nodes** — Ensures workflow has a starting point
- **Orphaned nodes** — Finds nodes unreachable from entry
- **Duplicate node IDs** — Prevents ambiguous references
- **Invalid connections** — Validates node input/output references
- **Type safety** — Zod schemas for runtime type checking

## Requirements

- **Redis** 6.0+
- **Node.js** 18+ / Bun 1.0+
- **PostgreSQL** (optional, for persistent state storage)

## Installation

```bash
npm install @manyeya/spane
```

## Quick Start

```typescript
import { Redis } from 'ioredis';
import { WorkflowEngine, NodeRegistry, InMemoryExecutionStore } from '@manyeya/spane';
import type { WorkflowDefinition, INodeExecutor, ExecutionContext, ExecutionResult } from '@manyeya/spane';

// 1. Define a node executor
class HttpExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { url, method = 'GET' } = context.nodeConfig || {};

    const response = await fetch(url as string, {
      method,
      body: method !== 'GET' ? JSON.stringify(context.inputData) : undefined,
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    return { success: true, data };
  }
}

class TransformExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const transformed = {
      ...context.inputData,
      processedAt: new Date().toISOString()
    };
    return { success: true, data: transformed };
  }
}

// 2. Set up the engine
const redis = new Redis();
const registry = new NodeRegistry();
registry.register('http', new HttpExecutor());
registry.register('transform', new TransformExecutor());

const stateStore = new InMemoryExecutionStore();
const engine = new WorkflowEngine(registry, stateStore, redis);

// 3. Define a workflow
const workflow: WorkflowDefinition = {
  id: 'fetch-and-transform',
  name: 'Fetch and Transform',
  entryNodeId: 'fetch',
  nodes: [
    {
      id: 'fetch',
      type: 'http',
      config: { url: 'https://api.example.com/data' },
      inputs: [],
      outputs: ['transform']
    },
    {
      id: 'transform',
      type: 'transform',
      config: {},
      inputs: ['fetch'],
      outputs: []
    }
  ]
};

// 4. Register and execute
await engine.registerWorkflow(workflow);
engine.startWorkers(5);

const executionId = await engine.enqueueWorkflow('fetch-and-transform', { userId: 123 });
console.log('Started execution:', executionId);

// 5. Check status
const execution = await stateStore.getExecution(executionId);
console.log('Status:', execution?.status);
console.log('Results:', execution?.nodeResults);
```

## Architecture

SPANE is organized into modular components in `/src/engine`:

```
src/engine/
├── workflow-engine.ts      # Main orchestrator
├── registry.ts             # Node executor registry
├── node-processor.ts       # Node job processor (thin orchestrator)
├── queue-manager.ts        # BullMQ queue management
├── worker-manager.ts       # Worker lifecycle management
├── handlers/               # Specialized node handlers
│   ├── execution-handler.ts    # Regular node execution
│   ├── delay-handler.ts        # Delay node processing
│   ├── subworkflow-handler.ts  # Sub-workflow execution
│   └── child-enqueue-handler.ts # Child node enqueueing
├── event-emitter.ts        # BullMQ event emission
├── config.ts               # Engine configuration
├── constants.ts            # Configuration constants
├── errors.ts               # Standardized error classes
└── validation.ts           # Zod validation schemas

src/utils/
├── distributed-lock.ts     # Redis-based distributed locking
├── metrics.ts              # Metrics collection
├── graceful-shutdown.ts    # Shutdown coordination
└── logger.ts               # Structured logging
```

### WorkflowEngine

The main orchestrator that:
- Registers workflow definitions (with optional DB persistence)
- Enqueues workflows and individual nodes
- Manages workflow lifecycle (pause/resume/cancel)
- Handles scheduled and webhook triggers

### NodeRegistry

Stores node executors by type with support for:
- Rate limiting per node type
- Circuit breaker registration for external nodes

### NodeProcessor

A thin orchestrator that delegates to specialized handlers:
- **execution-handler** — Regular node execution
- **delay-handler** — Delay node processing
- **subworkflow-handler** — Sub-workflow execution
- **child-enqueue-handler** — Child node enqueueing

### QueueManager

Manages BullMQ queues:
- `node-execution` — Individual node jobs
- `workflow-execution` — Scheduled/triggered workflow jobs
- `dlq-execution` — Dead letter queue for failed jobs

## Core Concepts

### Workflow Definition

Workflows are DAGs (Directed Acyclic Graphs) defined declaratively:

```typescript
import { validateWorkflowDefinition } from '@manyeya/spane';

const workflow: WorkflowDefinition = {
  id: 'data-pipeline',
  name: 'Data Processing Pipeline',
  entryNodeId: 'extract',
  nodes: [
    {
      id: 'extract',
      type: 'http',
      config: { url: 'https://api.example.com/data' },
      inputs: [],
      outputs: ['transform', 'validate']
    },
    {
      id: 'transform',
      type: 'transform',
      config: {},
      inputs: ['extract'],
      outputs: ['load']
    },
    {
      id: 'validate',
      type: 'validation',
      config: { schema: 'strict' },
      inputs: ['extract'],
      outputs: ['load']
    },
    {
      id: 'load',
      type: 'database',
      config: { table: 'processed_data' },
      inputs: ['transform', 'validate'],  // Multiple inputs
      outputs: []
    }
  ]
};

// Validate at runtime
const validated = validateWorkflowDefinition(workflow);
await engine.registerWorkflow(validated);
```

### Node Executors

Implement the `INodeExecutor` interface:

```typescript
interface INodeExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}

interface ExecutionContext {
  workflowId: string;
  executionId: string;
  nodeId: string;
  inputData: unknown;
  nodeConfig: Record<string, unknown>;
  previousResults: Record<string, ExecutionResult>;
  allNodeResults?: Record<string, ExecutionResult>;
  parentExecutionId?: string;
  depth: number;
  rateLimit?: (durationMs: number) => Promise<RateLimitError>;
}
```

Return results using helper functions:

```typescript
import { successResult, errorResult, skippedResult } from '@manyeya/spane';

// Successful execution
return successResult(data, { nextNodes: ['node-a', 'node-b'] });

// Failed execution
return errorResult('Something went wrong');

// Skipped execution
return skippedResult();
```

### Data Passing

Data flows between nodes based on parent relationships:

```typescript
// Entry node receives initial workflow data
context.inputData = { userId: 123 };  // from enqueueWorkflow()

// Single parent → receives parent's output directly
context.inputData = parentResult.data;

// Multiple parents → receives merged object
context.inputData = {
  'parent-a': parentAResult.data,
  'parent-b': parentBResult.data
};
```

### State Storage

Two implementations available:

```typescript
import { InMemoryExecutionStore } from '@manyeya/spane';
// Development/testing with memory management:
// - TTL-based eviction (auto-cleanup after expiration)
// - LRU eviction (removes least-recently-used when full)
// - Configurable size limits
// - Background cleanup process

import { DrizzleStore } from '@manyeya/spane';
// PostgreSQL persistence with:
// - Full execution versioning
// - Optimistic locking for concurrent safety
// - Atomic state + DLQ + error logging
// - Set DATABASE_URL to enable
```

## Advanced Features

### Conditional Branching

Control execution flow by returning `nextNodes`:

```typescript
class RouterExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { value } = context.inputData as { value: number };

    if (value > 100) {
      return successResult(
        { routed: 'high' },
        { nextNodes: ['high-value'] }
      );
    } else {
      return successResult(
        { routed: 'low' },
        { nextNodes: ['low-value'] }
      );
    }
  }
}
```

### Delay Nodes

Pause workflow execution for a specified duration:

```typescript
const workflow: WorkflowDefinition = {
  id: 'delayed-workflow',
  nodes: [
    {
      id: 'step1',
      type: 'transform',
      inputs: [],
      outputs: ['wait']
    },
    {
      id: 'wait',
      type: 'delay',
      config: { duration: 5000 },  // 5 seconds
      inputs: ['step1'],
      outputs: ['step2']
    },
    {
      id: 'step2',
      type: 'transform',
      inputs: ['wait'],
      outputs: []
    }
  ]
};
```

Supported duration fields:
- `duration` — milliseconds
- `durationSeconds` — seconds
- `durationMinutes` — minutes

### Sub-Workflows

Compose workflows from other workflows using BullMQ's FlowProducer with enhanced error handling:

```typescript
// Child workflow
const emailWorkflow: WorkflowDefinition = {
  id: 'send-email',
  name: 'Send Email',
  nodes: [
    { id: 'send', type: 'email', config: {}, inputs: [], outputs: [] }
  ]
};

// Parent workflow
const onboardingWorkflow: WorkflowDefinition = {
  id: 'user-onboarding',
  name: 'User Onboarding',
  nodes: [
    {
      id: 'create-user',
      type: 'database',
      inputs: [],
      outputs: ['send-welcome']
    },
    {
      id: 'send-welcome',
      type: 'sub-workflow',
      config: {
        workflowId: 'send-email',
        inputMapping: { 'to': 'userEmail' },  // Map parent data to child input
        outputMapping: { 'messageId': 'emailId' },  // Map child output to parent
        continueOnFail: false  // Fail parent if child fails
      },
      inputs: ['create-user'],
      outputs: []
    }
  ]
};
```

**v0.2.0 Enhanced Error Handling:**
- **Atomic failure propagation** — Sub-workflow failures are atomically stored in parent execution state
- **Continue-on-fail support** — Parent workflows can continue even if sub-workflow fails
- **Nested workflow support** — Error context preserved through multiple nesting levels
- **Aggregator pattern** — BullMQ FlowProducer ensures all children complete before parent continues

### Triggers

#### Webhook Triggers

```typescript
const workflow: WorkflowDefinition = {
  id: 'webhook-workflow',
  name: 'Webhook Triggered',
  triggers: [
    {
      type: 'webhook',
      config: { path: 'user-signup', method: 'POST' }
    }
  ],
  nodes: []
};

// Trigger from your API
app.post('/api/webhooks/:path', async ({ params, body }) => {
  const executionIds = await engine.triggerWebhook(params.path, 'POST', body);
  return { executionIds };
});
```

#### Schedule Triggers

```typescript
const workflow: WorkflowDefinition = {
  id: 'scheduled-workflow',
  name: 'Scheduled Workflow',
  triggers: [
    {
      type: 'schedule',
      config: {
        cron: '0 9 * * *',  // Every day at 9 AM
        timezone: 'America/New_York'
      }
    }
  ],
  nodes: []
};
```

### Retry Policies

Configure retry behavior per node:

```typescript
const workflow: WorkflowDefinition = {
  id: 'retry-workflow',
  nodes: [
    {
      id: 'flakey-api',
      type: 'http',
      config: { url: 'https://unreliable-api.com' },
      retryPolicy: {
        maxAttempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000  // Start with 1s, double each retry
        },
        continueOnFail: false  // Fail workflow if all retries exhausted
      },
      inputs: [],
      outputs: []
    }
  ]
};
```

With `continueOnFail: true`, the workflow continues even after all retries fail:

```typescript
retryPolicy: {
  maxAttempts: 3,
  continueOnFail: true  // Result becomes { success: true, skipped: true }
}
```

## Error Handling

SPANE provides a comprehensive error handling system:

```typescript
import {
  WorkflowError,
  WorkflowNotFoundError,
  NodeExecutionError,
  RateLimitError,
  CircuitBreakerOpenError,
  isRetryableError,
  shouldMoveToDLQ,
  getUserMessage
} from '@manyeya/spane';
```

### Error Classes

```typescript
// Base error class
export class WorkflowError extends Error {
  public readonly code: WorkflowErrorCode;
  public readonly executionId?: string;
  public readonly nodeId?: string;
  public readonly workflowId?: string;
  public readonly timestamp: Date;
  public readonly originalCause?: Error;
}

// Specialized errors
throw new WorkflowNotFoundError('my-workflow');
throw new NodeExecutionError('node-1', 'exec-123', 'API timeout');
throw new RateLimitError('http', 100, 'exec-123');
throw new CircuitBreakerOpenError('external-api');
```

### Error Utility Functions

```typescript
// Check if error is retryable
if (isRetryableError(error)) {
  // Will be retried by BullMQ
}

// Check if error should go to DLQ
if (shouldMoveToDLQ(error, attemptsMade, maxAttempts)) {
  // Non-retryable or max attempts exceeded
}

// Get user-friendly message
const userMessage = getUserMessage(error);
```

## Validation

SPANE uses Zod for runtime validation:

```typescript
import {
  validateWorkflowDefinition,
  validateNodeConfig,
  createValidatedExecutor,
  CommonNodeSchemas,
  ValidationError as RuntimeValidationError
} from '@manyeya/spane';
```

### Workflow Validation

```typescript
// Throws RuntimeValidationError if invalid
const validated = validateWorkflowDefinition(workflowDefinition);

// Safe validation (returns result object)
const result = validateWorkflowDefinitionSafe(workflowDefinition);
if (!result.success) {
  console.error(result.errors);
}
```

### Node Config Validation

```typescript
import { z } from 'zod';

const HttpNodeSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  timeout: z.number().positive().optional()
});

const validatedConfig = validateNodeConfig(HttpNodeSchema, nodeConfig);
```

### Create Validated Executor

```typescript
const executor = createValidatedExecutor(
  'http',
  CommonNodeSchemas.httpRequest,
  async (context) => {
    const { url, method } = context.nodeConfig;
    // Config is pre-validated
    const response = await fetch(url, { method });
    return successResult(await response.json());
  }
);

registry.register('http', executor);
```

### Common Schemas

SPANE includes pre-built schemas for common node types:

```typescript
import { CommonNodeSchemas } from '@manyeya/spane';

CommonNodeSchemas.httpRequest  // HTTP request config
CommonNodeSchemas.transform    // Transform/map config
CommonNodeSchemas.filter       // Filter/conditional config
CommonNodeSchemas.email        // Email config
CommonNodeSchemas.database     // Database query config
```

## Configuration

### Engine Config

```typescript
import type { EngineConfig } from '@manyeya/spane';

const config: EngineConfig = {
  useFlowProducerForSubWorkflows: true,  // Use FlowProducer for sub-workflows
  useNativeRateLimiting: true,           // Use BullMQ native rate limiting
  workerConcurrency: 10,                 // Jobs per worker
  rateLimiter: {
    max: 100,
    duration: 1000  // 100 jobs/second
  }
};

const engine = new WorkflowEngine(registry, stateStore, redis, config);
```

### Constants

SPANE defines configurable constants:

```typescript
import {
  MAX_SUBWORKFLOW_DEPTH,
  DEFAULT_WORKFLOW_CACHE_SIZE,
  DEFAULT_WORKFLOW_CACHE_TTL_MS,
  DEFAULT_REMOVE_ON_COMPLETE_COUNT,
  DEFAULT_REMOVE_ON_FAIL_COUNT,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_WORKER_CONCURRENCY,
  DEFAULT_LOCK_TIMEOUT_MS
} from '@manyeya/spane/engine/constants';
```

## API Reference

### WorkflowEngine

| Method | Description |
|--------|-------------|
| `registerWorkflow(def)` | Register a workflow definition |
| `enqueueWorkflow(id, data?)` | Start a workflow execution |
| `pauseExecution(id)` | Pause a running execution |
| `resumeExecution(id)` | Resume a paused execution |
| `cancelExecution(id)` | Cancel a running execution |
| `triggerWebhook(path, method, body)` | Trigger workflows by webhook |
| `registerSchedule(id, cron, tz?)` | Register a scheduled trigger |
| `startWorkers(concurrency?)` | Start processing workers |
| `gracefulShutdown()` | Shut down workers gracefully |

### NodeRegistry

| Method | Description |
|--------|-------------|
| `register(type, executor)` | Register a node executor |
| `get(type)` | Get an executor by type |
| `registerRateLimit(type, limit)` | Register rate limit for node type |
| `registerCircuitBreaker(type, options)` | Register circuit breaker |

### State Store

| Method | Description |
|--------|-------------|
| `createExecution(workflowId, ...)` | Create a new execution |
| `getExecution(id)` | Get execution by ID |
| `setExecutionStatus(id, status)` | Update execution status |
| `updateNodeResult(id, nodeId, result)` | Store node result |
| `getNodeResults(id, nodeIds)` | Get results for specific nodes |

## Building an API

SPANE is a library, not a server. Build your own HTTP API:

```typescript
import { Elysia } from 'elysia';
import { WorkflowEngine } from '@manyeya/spane';

const app = new Elysia();
const engine = new WorkflowEngine(registry, stateStore, redis);

// Execute workflow
app.post('/api/workflows/:id/execute', async ({ params, body }) => {
  const executionId = await engine.enqueueWorkflow(params.id, body.initialData);
  return { executionId };
});

// Get execution status
app.get('/api/executions/:id', async ({ params }) => {
  const execution = await stateStore.getExecution(params.id);
  return execution;
});

// List executions
app.get('/api/workflows/:id/executions', async ({ params }) => {
  const executions = await stateStore.getExecutionsByWorkflow(params.id);
  return executions;
});

app.listen(3000);
```

## Examples

For complete workflow examples, see the integration tests in `src/engine/tests/`:

- `*.integration.test.ts` — Full workflow execution scenarios
- `nested-sub-workflow.integration.test.ts` — Nested sub-workflow examples
- `flow-producer-sub-workflow.unit.test.ts` — FlowProducer pattern examples

## Publishing

```bash
# Build package
bun run build:all

# Dry-run
npm publish --dry-run

# Publish
npm publish
```

## License

MIT
