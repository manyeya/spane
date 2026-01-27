# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Test Commands

```bash
# Build the package
bun run build              # Compile TypeScript to dist/
bun run build:types        # Generate .d.ts declaration files
bun run build:all          # Both build and types

# Database operations (Drizzle ORM)
bun run db:generate        # Generate migrations from schema
bun run db:push            # Push schema directly to database
bun run db:studio          # Open Drizzle Studio for database inspection

# Run tests
bun test                   # Run all tests
bun test src/path/to/file.test.ts  # Run specific test file
```

The project uses **Bun** as the package manager and test runner.

## Project Overview

SPANE (Parallel Asynchronous Node Execution) is a workflow orchestration engine built on BullMQ and Redis. It executes DAG-based workflows with parallel node processing, retries, and state persistence.

**Key dependencies:**
- **BullMQ** (v5.66.4) - Job queue backend with Redis
- **Drizzle ORM** - PostgreSQL persistence layer
- **Opossum** - Circuit breaker for external services
- **fast-check** - Property-based testing
- **pino** - Structured logging

## Architecture

### Core Components

```
src/
├── index.ts              # Main entry point, exports public API
├── engine/
│   ├── workflow-engine.ts    # Main orchestrator
│   ├── registry.ts           # Node type registry (INodeExecutor -> type)
│   ├── node-processor.ts     # Job routing to handlers
│   ├── node-utils.ts         # Graph utilities (node traversal, DAG validation)
│   ├── queue-manager.ts      # BullMQ queue management
│   ├── worker-manager.ts     # Worker processes that consume jobs
│   ├── dlq-manager.ts        # Dead Letter Queue handling
│   ├── config.ts             # Engine configuration & feature flags
│   ├── handlers/             # Specialized node processors
│   │   ├── execution-handler.ts    # Regular node execution
│   │   ├── delay-handler.ts        # Time-based delays
│   │   ├── subworkflow-handler.ts  # Nested workflows (FlowProducer)
│   │   └── child-enqueue-handler.ts # Child node queuing
│   └── tests/                # Test suites
├── db/
│   ├── inmemory-store.ts     # In-memory state (dev only)
│   └── drizzle-store.ts      # PostgreSQL persistence
├── types/                   # Shared TypeScript interfaces
└── utils/                   # Logging, metrics, helpers
```

### Data Flow

1. `enqueueWorkflow()` creates execution state, queues entry node(s)
2. Worker picks up job from `node-execution` queue
3. `NodeProcessor` routes to appropriate handler based on node type
4. Handler builds `ExecutionContext` and invokes registered `INodeExecutor`
5. On success: save result, enqueue child nodes whose parents are all complete
6. On failure: retry with backoff, or move to DLQ after max attempts

### Key Abstractions

**INodeExecutor** - Interface all node types must implement:
```typescript
interface INodeExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
```

**WorkflowDefinition** - DAG of nodes with entry point:
```typescript
interface WorkflowDefinition {
  id: string;
  nodes: NodeDefinition[];
  entryNodeId: string;
  triggers?: WorkflowTrigger[];
}
```

**Data passing between nodes:**
- Entry nodes receive `initialData` from `enqueueWorkflow()`
- Single parent → direct data from parent output
- Multiple parents → `{ 'parentId': data, ... }` merged object
- All nodes can access `allNodeResults` for complete context

## Handlers System

NodeProcessor routes jobs to specialized handlers based on node characteristics:

| Handler | Purpose |
|---------|---------|
| `execution-handler` | Standard node execution via registered executors |
| `delay-handler` | Delay nodes (uses BullMQ delayed jobs) |
| `subworkflow-handler` | Nested workflows via BullMQ FlowProducer |
| `child-enqueue-handler` | Checks if all parents complete before enqueuing |

## Sub-Workflows with FlowProducer

When `useFlowProducerForSubWorkflows` is enabled, sub-workflows use BullMQ's native parent-child job dependencies:

1. Flow created with aggregator job as parent, sub-workflow nodes as children
2. BullMQ automatically manages dependencies (children complete before parent)
3. Aggregator uses `getChildrenValues()` to collect results
4. Output mapping transforms results before returning to parent

**Limitation:** Maximum nesting depth of 10 levels.

## Feature Flags (EngineConfig)

All flags default to `false` except `useJobSchedulers` which is always `true`:

| Flag | Description |
|------|-------------|
| `useFlowProducerForSubWorkflows` | Use FlowProducer for sub-workflows (recommended) |
| `useNativeRateLimiting` | Use BullMQ Worker rate limiting instead of custom Redis |
| `useJobSchedulers` | Use `upsertJobScheduler` for schedule management (always enabled) |
| `useSimplifiedEventStream` | Use `job.updateProgress()` for events |
| `workerConcurrency` | Parallel jobs per worker (default: 5) |
| `rateLimiter` | Rate limit config when native limiting enabled |

## Testing Conventions

- **Property-based tests** (`*.property.test.ts`) - Use fast-check for invariants
- **Integration tests** (`*.integration.test.ts`) - Multi-component scenarios
- **Unit tests** (`*.unit.test.ts`) - Single component tests

Tests use `bun:test` directly. Property tests are preferred for workflow correctness (graph validation, completion guarantees, state persistence).

## State Storage

Two implementations:
- **InMemoryExecutionStore** - Development only, data lost on restart
- **DrizzleStore** - PostgreSQL with full versioning (set `DATABASE_URL`)

## Important Patterns

**Idempotency:** Nodes are idempotent - `NodeProcessor` skips already-executed nodes by checking state store before running.

**Rate limiting:** Can be applied per-node-type in registry, or globally via `EngineConfig.rateLimiter`.

**Circuit breakers:** Registered in `NodeRegistry` for external node types (http, webhook, database, email) using Opossum.

**Conditional branching:** Return `nextNodes` in `ExecutionResult` to control which branches execute.

**DLQ handling:** After retry exhaustion, jobs move to DLQ with `handlePermanentFailure` for atomic state + DLQ + error logging (DrizzleStore only).

## Graph Validation

Workflow registration validates:
- No cycles in the DAG
- All nodes reachable from entry point
- Entry node exists
- No orphaned nodes (except explicit roots)

Validation uses `node-utils.ts` which implements cycle detection and reachability analysis.

## Logging

Uses `pino` for structured logging. Log levels: `debug`, `info`, `warn`, `error`. Key events are logged with context (executionId, nodeId, workflowId).
