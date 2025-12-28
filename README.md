# SPANE

**Parallel Asynchronous Node Execution**

A workflow orchestration engine built on BullMQ and Redis. Executes DAG-based workflows with parallel node processing, retries, and state persistence.

> ⚠️ **Experimental** - Not production-tested. Expect breaking changes.

## Requirements

- Bun 1.0+
- Redis 6.0+
- PostgreSQL (optional, for persistence)

## Quick Start

```bash
bun install
redis-server
bun start
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

## API

See `api.ts` for REST endpoints:
- `POST /api/workflows` - Register workflow
- `POST /api/workflows/:id/execute` - Execute workflow
- `GET /api/executions/:id` - Get execution status
- `POST /api/executions/:id/pause|resume|cancel` - Control execution
- `GET /api/executions/:id/events` - SSE event stream
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

## Known Limitations

- Drizzle store has known issues (see `critical-missing-parts.md`)
- No built-in UI
- Limited testing coverage
- Sub-workflow depth limited to 10 levels
