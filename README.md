# SPANE

**Parallel Asynchronous Node Execution**

A workflow orchestration engine built on BullMQ and Redis. Executes DAG-based workflows with parallel node processing, retries, and state persistence.

> ⚠️ **Experimental** - Not production-tested. Expect breaking changes.

## Installation

```bash
npm install spane
```

## Requirements

- Redis 6.0+
- Node.js 18+ / Bun 1.0+
- PostgreSQL (optional, for persistence)

## Quick Start

```typescript
import { Redis } from 'ioredis';
import { WorkflowEngine, NodeRegistry, InMemoryExecutionStore } from 'spane';
import type { WorkflowDefinition, INodeExecutor, ExecutionContext, ExecutionResult } from 'spane';

// 1. Create a node executor
class HttpExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { url, method = 'GET' } = context.nodeConfig || {};
    
    const response = await fetch(url, {
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

// 2. Set up registry and engine
const redis = new Redis();
const registry = new NodeRegistry();
registry.register('http', new HttpExecutor());
registry.register('transform', new TransformExecutor());

const stateStore = new InMemoryExecutionStore();
const engine = new WorkflowEngine(registry, stateStore, redis);

// 3. Define workflow
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

// Check status
const execution = await stateStore.getExecution(executionId);
console.log('Status:', execution?.status);
```

## Building Your Own API

SPANE is a library, not a server. You build your own HTTP API on top. For a complete example, see `examples/react-flow-backend.ts`.

```typescript
import { Elysia } from 'elysia';
import { WorkflowEngine } from 'spane';

const app = new Elysia();
const engine = new WorkflowEngine(registry, stateStore, redis);

app.post('/api/workflows/:id/execute', async ({ params, body }) => {
  const executionId = await engine.enqueueWorkflow(params.id, body.initialData);
  return { executionId };
});

app.listen(3000);
```

## Engine Architecture

The engine lives in `/engine` and consists of these core components:

### WorkflowEngine (`workflow-engine.ts`)

The main orchestrator. Responsibilities:
- Registers workflow definitions (with optional DB persistence)
- Enqueues workflows and individual nodes
- Manages workflow lifecycle (pause/resume/cancel)
- Handles scheduled and webhook triggers
- Coordinates all other components

```typescript
const engine = new WorkflowEngine(registry, stateStore, redis);
await engine.registerWorkflow(workflow);
const executionId = await engine.enqueueWorkflow('my-workflow', { data: 'here' });
```

### NodeRegistry (`registry.ts`)

Stores node executors by type. Each executor implements `INodeExecutor`:

```typescript
interface INodeExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}

const registry = new NodeRegistry();
registry.register('http', new HttpNodeExecutor());
registry.register('transform', new TransformNodeExecutor());
```

Also supports:
- Rate limiting per node type
- Circuit breaker registration for external nodes (http, webhook, database, email)

### NodeProcessor (`node-processor.ts`)

Processes individual node jobs. Handles:
- Idempotency checks (skips already-processed nodes)
- Data passing between nodes (single parent → direct, multiple parents → merged object)
- Conditional branching via `nextNodes` in execution results
- Sub-workflow execution with checkpoint/resume pattern
- Delay nodes (uses BullMQ delayed jobs)
- Circuit breaker wrapping for external calls
- Retry policies with `continueOnFail` option

### QueueManager (`queue-manager.ts`)

Manages three BullMQ queues:
- `node-execution` - Individual node jobs
- `workflow-execution` - Scheduled/triggered workflow jobs
- `dlq-execution` - Dead letter queue for failed jobs

### WorkerManager (`worker-manager.ts`)

Runs BullMQ workers that consume jobs from queues. Handles:
- Node job processing via NodeProcessor
- Workflow job processing (for scheduled triggers)
- DLQ routing after retry exhaustion
- Metrics collection

### DLQManager (`dlq-manager.ts`)

Dead Letter Queue management:
- Moves permanently failed jobs to DLQ
- Retrieves DLQ items for inspection
- Retries DLQ items back to main queue

### EventStreamManager (`event-stream.ts`)

Real-time event streaming via Redis Pub/Sub:
- Subscribes to BullMQ progress events
- Publishes workflow status events across instances
- Supports SSE subscriptions with optional executionId filtering

### PayloadManager (`payload-manager.ts`)

Claim Check pattern for large payloads:
- Offloads payloads >50KB to PostgreSQL
- Returns reference objects instead of inline data
- Loads payloads on demand during execution

## Data Flow

1. `enqueueWorkflow()` creates execution state and enqueues entry nodes
2. Workers pick up node jobs from `node-execution` queue
3. `NodeProcessor.processNodeJob()` executes the node:
   - Fetches input data from parent results
   - Runs the registered executor
   - Saves result to state store
   - Enqueues child nodes if all their parents completed
4. Workflow completes when all nodes have results

### Data Passing

```typescript
// Entry node receives initial workflow data
context.inputData = { userId: 123 }; // from enqueueWorkflow()

// Single parent node receives parent's output directly
context.inputData = parentResult.data;

// Multiple parent node receives merged object
context.inputData = {
  'parent-a': parentAResult.data,
  'parent-b': parentBResult.data
};
```

## Workflow Definition

```typescript
const workflow: WorkflowDefinition = {
  id: 'example',
  name: 'Example Workflow',
  entryNodeId: 'start',
  nodes: [
    {
      id: 'start',
      type: 'transform',
      config: {},
      inputs: [],
      outputs: ['process']
    },
    {
      id: 'process',
      type: 'http',
      config: { url: 'https://api.example.com' },
      inputs: ['start'],
      outputs: []
    }
  ],
  triggers: [
    { type: 'webhook', config: { path: 'example', method: 'POST' } },
    { type: 'schedule', config: { cron: '0 * * * *' } }
  ]
};
```

## Node Configuration

Nodes support these config options:

```typescript
{
  // Retry behavior
  retryPolicy: {
    maxAttempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    continueOnFail: false // if true, workflow continues even if node fails
  },
  
  // Circuit breaker (for external nodes)
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000
  }
}
```

## State Storage

Two implementations:
- `InMemoryExecutionStore` - Development only, data lost on restart
- `DrizzleStore` - PostgreSQL persistence with full versioning

Set `DATABASE_URL` to enable Drizzle store.

## Creating Workflows

### Programmatic

```typescript
import { Redis } from 'ioredis';
import { WorkflowEngine } from 'spane/engine/workflow-engine';
import { NodeRegistry } from 'spane/engine/registry';
import { InMemoryExecutionStore } from 'spane/db/inmemory-store';
import type { WorkflowDefinition, INodeExecutor, ExecutionContext, ExecutionResult } from 'spane/types';

// 1. Create a node executor
class HttpExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { url, method = 'GET' } = context.nodeConfig || {};
    
    const response = await fetch(url, {
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
    // Transform input data
    const transformed = {
      ...context.inputData,
      processedAt: new Date().toISOString()
    };
    return { success: true, data: transformed };
  }
}

// 2. Set up registry and engine
const redis = new Redis();
const registry = new NodeRegistry();
registry.register('http', new HttpExecutor());
registry.register('transform', new TransformExecutor());

const stateStore = new InMemoryExecutionStore();
const engine = new WorkflowEngine(registry, stateStore, redis);

// 3. Define workflow
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

// Check status
const execution = await stateStore.getExecution(executionId);
console.log('Status:', execution?.status);
```

### Workflow with Triggers

```typescript
const workflow: WorkflowDefinition = {
  id: 'triggered-workflow',
  name: 'Triggered Workflow',
  entryNodeId: 'start',
  nodes: [
    { id: 'start', type: 'transform', config: {}, inputs: [], outputs: [] }
  ],
  triggers: [
    // Webhook trigger - POST /api/webhooks/user-signup
    { type: 'webhook', config: { path: 'user-signup', method: 'POST' } },
    
    // Schedule trigger - runs every hour
    { type: 'schedule', config: { cron: '0 * * * *' } }
  ]
};
```

Trigger via webhook (you build this endpoint):
```typescript
// In your API layer
app.post('/api/webhooks/:path', async ({ params, body }) => {
  const executionIds = await engine.triggerWebhook(params.path, 'POST', body);
  return { executionIds };
});
```

### Conditional Branching

Return `nextNodes` from executor to control which branches execute:

```typescript
class RouterExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { value } = context.inputData;
    
    // Only execute the matching branch
    if (value > 100) {
      return { success: true, data: { routed: 'high' }, nextNodes: ['high-value'] };
    } else {
      return { success: true, data: { routed: 'low' }, nextNodes: ['low-value'] };
    }
  }
}
```

### Sub-Workflows

```typescript
// Child workflow
const childWorkflow: WorkflowDefinition = {
  id: 'send-email',
  name: 'Send Email',
  entryNodeId: 'send',
  nodes: [
    { id: 'send', type: 'email', config: {}, inputs: [], outputs: [] }
  ]
};

// Parent workflow calling child
const parentWorkflow: WorkflowDefinition = {
  id: 'onboarding',
  name: 'User Onboarding',
  entryNodeId: 'validate',
  nodes: [
    { id: 'validate', type: 'transform', config: {}, inputs: [], outputs: ['call-email'] },
    {
      id: 'call-email',
      type: 'sub-workflow',
      config: { workflowId: 'send-email' },
      inputs: ['validate'],
      outputs: []
    }
  ]
};
```

## FlowProducer Sub-Workflow Execution

The engine uses BullMQ's FlowProducer for sub-workflow execution, leveraging native parent-child job dependencies instead of a checkpoint/resume pattern. This provides better reliability and simpler code.

### How It Works

When a `sub-workflow` node executes:

1. **Flow Creation**: The engine creates a BullMQ flow with an aggregator job as the parent and sub-workflow nodes as children
2. **Dependency Management**: BullMQ automatically manages job dependencies - child jobs must complete before the aggregator runs
3. **Result Aggregation**: The aggregator job uses `getChildrenValues()` to collect results from all completed child jobs
4. **Parent Notification**: Once aggregation completes, the parent workflow node is notified to continue

```
┌─────────────────────────────────────────────────────────────────┐
│                    FlowProducer Flow Structure                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    ┌──────────────────────┐                     │
│                    │  Aggregator Job      │                     │
│                    │  (waits for children)│                     │
│                    └──────────┬───────────┘                     │
│                               │                                  │
│              ┌────────────────┼────────────────┐                │
│              │                │                │                │
│              ▼                ▼                ▼                │
│     ┌────────────┐   ┌────────────┐   ┌────────────┐           │
│     │ Final Node │   │ Final Node │   │ Final Node │           │
│     │     A      │   │     B      │   │     C      │           │
│     └─────┬──────┘   └─────┬──────┘   └────────────┘           │
│           │                │                                    │
│           ▼                ▼                                    │
│     ┌────────────┐   ┌────────────┐                            │
│     │ Entry Node │   │ Entry Node │                            │
│     │     1      │   │     2      │                            │
│     └────────────┘   └────────────┘                            │
│                                                                  │
│  Note: In BullMQ flows, children execute BEFORE their parent    │
└─────────────────────────────────────────────────────────────────┘
```

### Sub-Workflow Configuration

Configure sub-workflow nodes with input/output mapping and error handling:

```typescript
const parentWorkflow: WorkflowDefinition = {
  id: 'order-processing',
  name: 'Order Processing',
  entryNodeId: 'validate-order',
  nodes: [
    {
      id: 'validate-order',
      type: 'transform',
      config: {},
      inputs: [],
      outputs: ['process-payment']
    },
    {
      id: 'process-payment',
      type: 'sub-workflow',
      config: {
        workflowId: 'payment-workflow',
        
        // Map parent data to sub-workflow input
        inputMapping: {
          'amount': 'orderTotal',      // sub-workflow receives 'amount' from parent's 'orderTotal'
          'currency': 'orderCurrency'
        },
        
        // Map sub-workflow output back to parent
        outputMapping: {
          'transactionId': 'paymentId',  // parent receives 'transactionId' from sub-workflow's 'paymentId'
          'status': 'paymentStatus'
        },
        
        // Continue parent workflow even if sub-workflow fails
        continueOnFail: false
      },
      inputs: ['validate-order'],
      outputs: ['send-confirmation']
    },
    {
      id: 'send-confirmation',
      type: 'email',
      config: {},
      inputs: ['process-payment'],
      outputs: []
    }
  ]
};
```

### Input/Output Mapping

Data flows between parent and sub-workflows through configurable mappings:

**Input Mapping** - Transform parent node output to sub-workflow input:
```typescript
// Parent node outputs: { orderTotal: 99.99, orderCurrency: 'USD', customerId: 123 }
inputMapping: {
  'amount': 'orderTotal',     // Sub-workflow receives: { amount: 99.99, currency: 'USD' }
  'currency': 'orderCurrency'
}
```

**Output Mapping** - Transform sub-workflow results back to parent:
```typescript
// Sub-workflow outputs: { paymentId: 'pay_123', paymentStatus: 'completed' }
outputMapping: {
  'transactionId': 'paymentId',  // Parent receives: { transactionId: 'pay_123', status: 'completed' }
  'status': 'paymentStatus'
}
```

### Error Handling with continueOnFail

The `continueOnFail` option controls how failures propagate:

```typescript
// Default behavior (continueOnFail: false)
// - If any sub-workflow node fails, the entire sub-workflow fails
// - Parent workflow node fails and stops execution
// - Uses BullMQ's failParentOnFailure: true

// With continueOnFail: true
// - Sub-workflow continues even if some nodes fail
// - Parent workflow receives partial results
// - Uses BullMQ's ignoreDependencyOnFailure: true
config: {
  workflowId: 'optional-enrichment',
  continueOnFail: true  // Parent continues even if enrichment fails
}
```

### Nested Sub-Workflows

Sub-workflows can call other sub-workflows up to 10 levels deep:

```typescript
// Level 0: Main workflow
const mainWorkflow = {
  id: 'main',
  nodes: [
    { id: 'start', type: 'transform', ... },
    { id: 'call-level1', type: 'sub-workflow', config: { workflowId: 'level1-workflow' }, ... }
  ]
};

// Level 1: First sub-workflow
const level1Workflow = {
  id: 'level1-workflow',
  nodes: [
    { id: 'process', type: 'transform', ... },
    { id: 'call-level2', type: 'sub-workflow', config: { workflowId: 'level2-workflow' }, ... }
  ]
};

// Level 2: Nested sub-workflow
const level2Workflow = {
  id: 'level2-workflow',
  nodes: [
    { id: 'deep-process', type: 'transform', ... }
  ]
};
```

Each nesting level creates its own execution record with `parentExecutionId` linking back to the caller.

### Aggregator Node

The aggregator is a virtual node (`__aggregator__`) that:

1. Waits for all sub-workflow nodes to complete (handled by BullMQ)
2. Collects results using `job.getChildrenValues()`
3. Applies output mapping to transform results
4. Marks the sub-workflow execution as completed
5. Notifies the parent workflow to continue

For workflows with multiple final nodes (nodes with no outputs), results are merged:

```typescript
// Sub-workflow with multiple final nodes
const multiOutputWorkflow = {
  id: 'parallel-enrichment',
  nodes: [
    { id: 'start', type: 'transform', inputs: [], outputs: ['enrich-a', 'enrich-b'] },
    { id: 'enrich-a', type: 'http', inputs: ['start'], outputs: [] },  // Final node
    { id: 'enrich-b', type: 'http', inputs: ['start'], outputs: [] }   // Final node
  ]
};

// Aggregated result structure:
// {
//   'enrich-a': { ... result from enrich-a ... },
//   'enrich-b': { ... result from enrich-b ... }
// }
```

### Execution State

Sub-workflow executions are tracked separately in the state store:

```typescript
// Query sub-workflow execution
const childExecution = await stateStore.getExecution(childExecutionId);

// Execution includes:
// - workflowId: The sub-workflow ID
// - parentExecutionId: Links to parent workflow execution
// - depth: Nesting level (0 for main workflow, 1+ for sub-workflows)
// - status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
// - nodeResults: Results from each node in the sub-workflow
```

### Limitations

- Maximum nesting depth: 10 levels
- Sub-workflow must exist and be registered before parent workflow executes
- Input/output mappings only work with object data (not primitives)
- All sub-workflow nodes share the same `continueOnFail` setting

## Engine Configuration

The workflow engine supports various configuration options for fine-tuning behavior and enabling advanced BullMQ features. Pass configuration when creating the engine:

```typescript
import { WorkflowEngine } from './engine/workflow-engine';
import type { EngineConfig } from './engine/config';

const engineConfig: EngineConfig = {
    useFlowProducerForSubWorkflows: true,
    useNativeRateLimiting: true,
    workerConcurrency: 10,
    rateLimiter: {
        max: 100,
        duration: 1000, // 100 jobs per second
    },
};

const engine = new WorkflowEngine(
    registry,
    stateStore,
    redis,
    metricsCollector,
    circuitBreakerRegistry,
    cacheOptions,
    payloadManager,
    engineConfig // Pass config as last parameter
);
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `useFlowProducerForSubWorkflows` | boolean | `false` | Use BullMQ FlowProducer for sub-workflow execution instead of checkpoint/resume pattern. Enables native parent-child job dependencies. |
| `useNativeRateLimiting` | boolean | `false` | Use BullMQ's native Worker rate limiting instead of custom Redis INCR/EXPIRE implementation. |
| `useJobSchedulers` | boolean | `true` | Use `upsertJobScheduler` for schedule management. Always enabled (legacy repeatable jobs code removed). |
| `useWorkerThreads` | boolean | `false` | Run node processing in separate worker threads for CPU isolation (sandboxed execution). |
| `useSimplifiedEventStream` | boolean | `false` | Use `job.updateProgress()` for events instead of QueueEventsProducer. Simplifies event streaming. |
| `workerConcurrency` | number | `5` | Number of jobs to process in parallel per worker. |
| `rateLimiter` | object | `undefined` | Global rate limiter for node execution worker. Only applies when `useNativeRateLimiting` is enabled. |
| `processorFile` | string | `undefined` | Path to sandboxed processor file. Only used when `useWorkerThreads` is enabled. |

### Rate Limiter Configuration

When `useNativeRateLimiting` is enabled, you can configure the rate limiter:

```typescript
const engineConfig: EngineConfig = {
    useNativeRateLimiting: true,
    rateLimiter: {
        max: 50,       // Maximum jobs to process
        duration: 1000, // Within this time window (ms)
    },
};
```

This limits the worker to processing 50 jobs per second across all node types.

### Feature Flags

All feature flags default to `false` (except `useJobSchedulers`) to maintain backward compatibility. Enable features incrementally as needed:

```typescript
// Minimal config - uses all defaults
const engine = new WorkflowEngine(registry, stateStore, redis);

// Enable specific features
const engine = new WorkflowEngine(registry, stateStore, redis, undefined, undefined, undefined, undefined, {
    useFlowProducerForSubWorkflows: true, // Better sub-workflow handling
    useNativeRateLimiting: true,          // BullMQ native rate limiting
    workerConcurrency: 10,                // Higher parallelism
});
```

### Accessing Configuration

You can retrieve the current engine configuration at runtime:

```typescript
const config = engine.getConfig();
console.log('Worker concurrency:', config.workerConcurrency);
console.log('Using FlowProducer:', config.useFlowProducerForSubWorkflows);
```

## Job Schedulers

The engine uses BullMQ's `upsertJobScheduler` for managing scheduled workflow triggers. This provides idempotent schedule registration without manual cleanup.

### Registering Schedules

Schedules are automatically registered when you register a workflow with schedule triggers:

```typescript
const workflow: WorkflowDefinition = {
    id: 'daily-report',
    name: 'Daily Report',
    entryNodeId: 'generate',
    nodes: [...],
    triggers: [
        {
            type: 'schedule',
            config: {
                cron: '0 9 * * *',      // Every day at 9 AM
                timezone: 'America/New_York'
            }
        }
    ]
};

await engine.registerWorkflow(workflow);
// Schedule is automatically created/updated
```

### Managing Schedules Programmatically

```typescript
// Register a schedule directly
await engine.registerScheduleWithUpsert(
    'my-workflow',
    '0 */6 * * *',        // Every 6 hours
    'Europe/London'        // Optional timezone
);

// List all active schedulers
const schedulers = await engine.getJobSchedulers();
for (const scheduler of schedulers) {
    console.log(`${scheduler.id}: ${scheduler.pattern} (next: ${new Date(scheduler.next!)})`);
}

// Get a specific scheduler
const scheduler = await engine.getJobScheduler('schedule:my-workflow:0 */6 * * *');

// Remove all schedulers for a workflow
const removedCount = await engine.removeWorkflowSchedulers('my-workflow');
console.log(`Removed ${removedCount} schedulers`);
```

### Scheduler ID Format

Scheduler IDs follow the pattern: `schedule:{workflowId}:{cronPattern}`

For example:
- `schedule:daily-report:0 9 * * *` - Daily report at 9 AM
- `schedule:hourly-sync:0 * * * *` - Hourly sync at the top of each hour
- `schedule:weekly-cleanup:0 0 * * 0` - Weekly cleanup on Sundays at midnight

### Cron Pattern Reference

The cron pattern follows standard cron syntax:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

Common patterns:
- `0 * * * *` - Every hour at minute 0
- `*/15 * * * *` - Every 15 minutes
- `0 9 * * *` - Every day at 9:00 AM
- `0 9 * * 1-5` - Weekdays at 9:00 AM
- `0 0 1 * *` - First day of every month at midnight
- `0 */6 * * *` - Every 6 hours

### Timezone Support

Schedules support IANA timezone identifiers:

```typescript
// Examples of valid timezones
'America/New_York'
'Europe/London'
'Asia/Tokyo'
'UTC'
'America/Los_Angeles'
```

If no timezone is specified, the schedule runs in the server's local timezone.

## Sandboxed Processors (Worker Threads)

The engine supports running node execution in separate worker threads for CPU isolation. This is useful for CPU-intensive operations that might block the main event loop.

### Enabling Sandboxed Processors

```typescript
const engineConfig: EngineConfig = {
    useWorkerThreads: true,
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
```

### Prerequisites

Before enabling sandboxed processors, ensure the TypeScript processor file has been compiled to JavaScript:

```bash
# Compile the sandbox processor
bun build src/engine/processors/node-processor.sandbox.ts \
  --outdir src/engine/processors \
  --target node
```

### How It Works

When `useWorkerThreads: true` is enabled:

1. **Worker Thread Execution**: Node jobs are processed in separate worker threads instead of the main event loop
2. **Data Serialization**: Job data is automatically serialized/deserialized when passing between threads
3. **CPU Isolation**: Long-running or CPU-intensive nodes don't block other job processing
4. **Crash Recovery**: Worker thread crashes are isolated and don't affect other jobs

### Architecture

```
Main Thread                          Worker Thread
┌─────────────────┐                  ┌─────────────────┐
│  WorkerManager  │                  │ Sandbox Processor│
│                 │  serialize       │                 │
│  Job Data ──────┼─────────────────►│  deserialize    │
│                 │                  │       │         │
│                 │                  │       ▼         │
│                 │                  │  Process Node   │
│                 │                  │       │         │
│                 │  deserialize     │       ▼         │
│  Result ◄───────┼─────────────────┤  serialize      │
└─────────────────┘                  └─────────────────┘
```

### Serialization Support

The following data types are automatically handled during serialization:

| Type | Serialization |
|------|---------------|
| Primitives | Pass through |
| Date | ISO string |
| Error | Object with message/stack |
| BigInt | String with type marker |
| Buffer/Uint8Array | Base64 string |
| Map/Set | Object with type marker |
| Functions | Removed (warning logged) |
| Symbols | Removed (warning logged) |
| Circular refs | Replaced with null |

### Custom Processor File

You can specify a custom processor file:

```typescript
const engineConfig: EngineConfig = {
    useWorkerThreads: true,
    processorFile: '/path/to/my-custom-processor.js',
};
```

### Environment Variables

When running in worker threads, the sandboxed processor needs these environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SPANE_REDIS_URL` or `REDIS_URL` | Yes | Redis connection URL |
| `SPANE_DATABASE_URL` or `DATABASE_URL` | No | Database URL (uses InMemoryStore if not set) |
| `SPANE_ENGINE_CONFIG` | No | JSON string of EngineConfig options |
| `NODE_ENV` | No | Set to "production" to disable serialization warnings |

### Error Handling

The engine handles sandboxed processor errors automatically:

- **Worker crashes**: Detected and logged, BullMQ recovers automatically
- **Stalled jobs**: Detected when worker crashes mid-execution, automatically retried
- **Serialization errors**: Caught and returned as failure results
- **Missing processor file**: Throws descriptive error at startup

### When to Use Sandboxed Processors

**Use sandboxed processors when:**
- Running CPU-intensive node operations
- Processing untrusted or third-party node executors
- Needing true parallelism on multi-core systems
- Wanting crash isolation between jobs

**Use inline processors (default) when:**
- Running I/O-bound operations (HTTP, database)
- Developing and debugging
- Running in resource-constrained environments
- Processing simple, fast node operations

### Example

See `examples/sandboxed-processor-setup.ts` for comprehensive examples including:
- Basic setup
- Custom processor paths
- Serialization considerations
- Error handling
- Combining with other features
- Monitoring and debugging

## Known Limitations

- Drizzle store has known issues (see `critical-missing-parts.md`)
- No built-in UI
- Limited testing coverage
- Sub-workflow depth limited to 10 levels

## Publishing

```bash
# Build package
bun run build:all

# Dry-run to check what will be published
npm publish --dry-run

# Publish
npm publish
```

## Usage in Other Projects

```typescript
import { WorkflowEngine, NodeRegistry, InMemoryExecutionStore } from 'spane';

// Your code here
```

## TypeScript Support

Full TypeScript support out of the box. Import types:

```typescript
import type { 
  WorkflowDefinition, 
  INodeExecutor, 
  ExecutionContext, 
  ExecutionResult 
} from 'spane';
```
