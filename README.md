# SPANE

[![npm version](https://badge.fury.io/js/%40manyeya%2Fspane.svg)](https://www.npmjs.com/package/@manyeya/spane)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Parallel Asynchronous Node Execution** — A workflow orchestration engine built on BullMQ and Redis.

SPANE executes DAG-based workflows with parallel node processing, automatic retries, state persistence, and comprehensive error handling.

> **Note:** This is an experimental project. Not production-tested. Expect breaking changes.

## Features

- **Parallel Execution** — Run multiple nodes concurrently based on DAG dependencies
- **Sub-Workflows** — Compose workflows from other workflows with FlowProducer
- **State Persistence** — In-memory or PostgreSQL-backed execution state
- **Error Handling** — Standardized error classes with retry policies and DLQ support
- **Validation** — Runtime validation with Zod schemas
- **Triggers** — Webhook and scheduled (cron) workflow execution
- **Conditional Branching** — Dynamic path selection based on execution results
- **Rate Limiting** — Native BullMQ rate limiting per node type
- **Circuit Breakers** — Fault tolerance for external service calls

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
├── distributed-lock.ts     # Redis-based locking
├── config.ts               # Engine configuration
├── constants.ts            # Configuration constants
├── errors.ts               # Standardized error classes
└── validation.ts           # Zod validation schemas
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
// Development only — data lost on restart

import { DrizzleStore } from '@manyeya/spane';
// PostgreSQL persistence with full versioning
// Set DATABASE_URL to enable
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

Compose workflows from other workflows using BullMQ's FlowProducer:

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
        inputMapping: { 'to': 'userEmail' },
        outputMapping: { 'messageId': 'emailId' }
      },
      inputs: ['create-user'],
      outputs: []
    }
  ]
};
```

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

See the `examples/` directory for complete examples:

- `simple-workflow.ts` — Basic workflow setup
- `conditional-branching.ts` — Dynamic path selection
- `dynamic-looping.ts` — Loop processing
- `advanced-etl.ts` — ETL pipeline with sub-workflows

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
