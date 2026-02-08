# SPANE - Parallel Asynchronous Node Execution

**Version:** 0.2.0
**Generated:** 2026-02-08
**Commit:** 1c28538
**Project:** BullMQ-based workflow orchestration engine

## OVERVIEW

SPANE is a **BullMQ-based distributed workflow execution engine** for TypeScript/Node.js. Uses Redis queues for job processing, PostgreSQL for persistence, and supports sub-workflows, circuit breakers, SSE event streaming, and CPU-isolated worker threads.

## STRUCTURE

```
spane/
├── src/
│   ├── index.ts           # Barrel export (140 lines)
│   ├── types.ts           # Core interfaces (IExecutionStateStore, WorkflowDefinition)
│   ├── engine/            # Core workflow orchestration
│   │   ├── workflow-engine.ts
│   │   ├── node-processor.ts
│   │   ├── node-utils.ts    # Input validation with circular reference detection
│   │   ├── worker-manager.ts
│   │   ├── queue-manager.ts
│   │   ├── event-emitter.ts
│   │   ├── event-types.ts
│   │   ├── registry.ts
│   │   ├── config.ts
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   ├── validation.ts
│   │   ├── graph-validation.ts
│   │   ├── errors.ts
│   │   ├── dlq-manager.ts
│   │   ├── handlers/        # Specialized node processors
│   │   │   ├── execution-handler.ts
│   │   │   ├── delay-handler.ts
│   │   │   ├── subworkflow-handler.ts  # Improved error handling
│   │   │   └── child-enqueue-handler.ts
│   │   └── tests/           # 34 test files (property/integration/unit)
│   ├── db/                # State persistence (2 strategies)
│   │   ├── inmemory-store.ts    # TTL/LRU eviction, memory leak fixes
│   │   ├── drizzle-store.ts     # Optimistic locking, transaction isolation
│   │   └── schema.ts
│   └── utils/             # Production utilities
│       ├── circuit-breaker.ts
│       ├── metrics.ts
│       ├── health.ts
│       ├── graceful-shutdown.ts
│       ├── distributed-lock.ts  # Configurable TTL, auto-renewal
│       ├── layout.ts
│       └── logger.ts
├── drizzle/               # Database migrations
├── docs/                  # Separate Next.js docs project
├── maintenance/           # Maintenance scripts
├── migrations/            # Database migration files
└── dist/                  # Compiled output
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| **Engine core** | `src/engine/workflow-engine.ts` | Main orchestrator, 786 lines |
| **Worker patterns** | `src/engine/worker-manager.ts` | BullMQ worker lifecycle, rate limiting |
| **Node execution** | `src/engine/node-processor.ts` | Node job processing, 328 lines |
| **Node utilities** | `src/engine/node-utils.ts` | DAG traversal, data aggregation, 478 lines |
| **State stores** | `src/db/` | InMemory / Drizzle strategies |
| **Event streaming** | `src/engine/event-emitter.ts` | Local event emission |
| **Tests** | `src/engine/tests/` | 34 test files, Bun test runner |
| **Graph validation** | `src/engine/graph-validation.ts` | DAG validation, cycle detection |
| **Production utilities** | `src/utils/` | Metrics, health, shutdown, distributed locking |

## CONVENTIONS

**Deviations from standard:**
- **Bun** package manager (not npm/yarn/pnpm)
- **ESM-only** module system (`"type": "module"`)
- **Tests nested** in `src/engine/tests/` and `src/db/` (not root-level)
- **Docs as separate project** in `docs/` (Next.js)
- **Maintenance scripts** in `maintenance/` at root
- **Migrations** in `migrations/` at root

**Code style:**
- TypeScript strict mode with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`
- Prettier 100-character line width (not default 80)
- Single quotes, trailing commas, LF line endings
- Bun test runner (not Jest/Vitest)

**Testing:**
- `*.property.test.ts` — Fast-check property tests (100 runs per property)
- `*.unit.test.ts` — Unit tests with mocks
- `*.integration.test.ts` — Real Redis connections
- Inline mock factories, `mock.restore()` in `afterEach`

## ANTI-PATTERNS (THIS PROJECT)

**Deprecated fields** (DO NOT USE):
- `subWorkflowStep` — Use FlowProducer pattern instead
- `childExecutionId` — Use BullMQ parent-child dependencies

**Deprecated methods:**
- `emit()` — Use `emitLocal()` instead

**BullMQ v5 deprecations:**
- Markers in waitlist (`0:delay`, `0:0`) — Will be removed in v6
- `debug.destroy()` — Does nothing

**Known issues:**
- Removed `health-monitor.ts` (now consolidated into `health.ts`)
- `drizzle-store.ts` is large (1225 lines) but well-organized with transactions

## UNIQUE STYLES

**Worker thread sandboxing:**
- Removed in v0.2.0 - simplified worker architecture
- Direct BullMQ worker usage without sandbox isolation

**Multi-store strategy:**
- `InMemoryExecutionStore` — Development/testing with LRU eviction and TTL cleanup
- `DrizzleExecutionStateStore` — PostgreSQL with optimistic locking and transaction isolation

**Single-worker architecture:**
- Node Worker (`node-execution`) — Individual node jobs with configurable concurrency (default: 5)
- FlowProducer for sub-workflows — Native parent-child dependency management

**Event streaming:**
- Workflow status via `emitLocal()` (single-instance only)
- Event types defined in `event-types.ts`

## COMMANDS

```bash
# Development
bun test                  # Run all tests (Bun test runner)

# Build
bun build                 # Compile src/index.ts → dist/index.js
bun run build:types       # Generate .d.ts declaration files
bun run build:all         # Both build and types

# Database operations
bun run db:generate       # Generate migrations from schema
bun run db:push           # Push schema directly to database
bun run db:studio         # Open Drizzle Studio
```

## NOTES

**Configuration:**
- Redis: `SPANE_REDIS_URL` env var (or `REDIS_URL`)
- Database: `SPANE_DATABASE_URL` env var (or `DATABASE_URL`)

**Worker configuration:**
- `EngineConfig.workerConcurrency` (default: 5)
- `EngineConfig.useNativeRateLimiting` (BullMQ limiter)
- `EngineConfig.useFlowProducerForSubWorkflows` (native parent-child deps, recommended)
- `EngineConfig.useJobSchedulers` (always enabled)

**Large files:**
1. `src/db/drizzle-store.ts` (1225 lines) — Well-organized with transaction support
2. `src/engine/workflow-engine.ts` (786 lines) — Main orchestrator
3. `src/engine/node-utils.ts` (478 lines) — DAG utilities and data aggregation

## RECENT IMPROVEMENTS (v0.2.0)

**Refactored examples:**
- Removed `react-flow-n8n` standalone Next.js project (moved to separate repository)
- Simplified examples structure with direct TypeScript usage examples
- Better focused examples for ETL, conditional branching, and dynamic looping

**Enhanced sub-workflow error handling:**
- `subworkflow-handler.ts` now properly propagates errors to parent workflows
- Failed sub-workflows store error results in parent execution state
- Support for `continueOnFail` at sub-workflow level via `failParentOnFailure` and `ignoreDependencyOnFailure` options
- Re-enqueues parent node after sub-workflow completion (success or failure)
- Results stored in parent state before re-enqueuing for idempotency

**Database transaction improvements:**
- New `drizzle-store-transaction.test.ts` with comprehensive transaction tests
- `DrizzleStore.updateNodeResult()` uses INSERT ... ON CONFLICT DO UPDATE for atomic upserts
- `setExecutionStatus()` uses WHERE clause with status check to prevent overwriting terminal states
- All state modifications wrapped in transactions for atomicity

**Memory leak fixes:**
- `InMemoryExecutionStore` now implements LRU eviction with configurable `maxExecutions` limit
- TTL-based cleanup for completed/failed executions (default: 1 hour)
- Automatic cleanup interval (default: 5 minutes) with unref'd timer
- Per-execution limits for logs (`maxLogsPerExecution`) and spans (`maxSpansPerExecution`)
- New `cache-memory-leak.test.ts` to verify proper cleanup

**Distributed locking enhancements:**
- `DistributedLock` class in `src/utils/distributed-lock.ts` supports configurable TTL per operation type
- Auto-renewal mechanism for long-running operations (configurable renewal ratio and max renewals)
- Atomic lock acquisition using Redis SET NX with expiration
- Lua scripts for atomic check-and-delete and check-and-extend operations

**Input validation improvements:**
- `node-utils.ts` includes `validateInputData()` with WeakSet-based circular reference detection
- Comprehensive error messages for invalid parentIds and missing parent results
- Validates parent node success before merging data
- Clear error messages distinguishing between configuration errors, internal errors, and execution errors

**New test coverage:**
- `nested-sub-workflow.integration.test.ts` - Nested sub-workflow execution tests
- `flow-producer-sub-workflow.unit.test.ts` - FlowProducer pattern unit tests
- `no-job-creation-events.property.test.ts.skip` - Event validation tests (skipped pending fix)

**Library entry point:** Import from `@manyeya/spane` after npm install — `import { WorkflowEngine, NodeRegistry } from '@manyeya/spane'`
