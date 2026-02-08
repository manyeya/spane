# SPANE - Parallel Asynchronous Node Execution

**Generated:** 2026-02-08
**Commit:** 412670e
**Project:** BullMQ-based workflow orchestration engine

## OVERVIEW

SPANE is a **BullMQ-based distributed workflow execution engine** for TypeScript/Node.js. Uses Redis queues for job processing, PostgreSQL for persistence, and supports sub-workflows, circuit breakers, SSE event streaming, and CPU-isolated worker threads.

## STRUCTURE

```
spane/
├── src/
│   ├── index.ts           # Barrel export (125 lines)
│   ├── types.ts           # Core interfaces (IExecutionStateStore, WorkflowDefinition)
│   ├── engine/            # Core workflow orchestration
│   │   ├── workflow-engine.ts
│   │   ├── node-processor.ts
│   │   ├── node-utils.ts    # Input validation with circular reference detection
│   │   ├── worker-manager.ts
│   │   ├── queue-manager.ts
│   │   ├── event-stream.ts
│   │   ├── event-emitter.ts
│   │   ├── registry.ts
│   │   ├── config.ts
│   │   ├── handlers/        # Specialized node processors
│   │   │   ├── execution-handler.ts
│   │   │   ├── delay-handler.ts
│   │   │   ├── subworkflow-handler.ts  # Improved error handling
│   │   │   └── child-enqueue-handler.ts
│   │   ├── processors/      # Worker thread sandboxing
│   │   └── tests/           # 54 test files (property/integration/unit)
│   ├── db/                # State persistence (3 strategies)
│   │   ├── inmemory-store.ts    # TTL/LRU eviction, memory leak fixes
│   │   ├── drizzle-store.ts     # Optimistic locking, transaction isolation
│   │   └── hybrid-store.ts
│   └── utils/             # Production utilities
│       ├── circuit-breaker.ts
│       ├── metrics.ts
│       ├── health.ts
│       ├── health-monitor.ts  # DUPLICATE - see health.ts
│       ├── graceful-shutdown.ts
│       ├── timeout-monitor.ts
│       ├── distributed-lock.ts  # Configurable TTL, auto-renewal
│       └── retry-helper.ts
├── drizzle/               # Database migrations (non-standard location)
├── examples/              # Usage examples (NOT published)
│   ├── react-flow-backend.ts
│   ├── sandboxed-processor-setup.ts
│   ├── rate-limiting-configuration.ts
│   ├── test-workflow-controls.ts
│   └── react-flow-n8n/    # Standalone Next.js project
├── docs/                  # Separate Next.js docs project (non-standard)
├── scripts/                # Maintenance scripts (non-standard location)
└── dist/                  # Compiled output
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| **Engine core** | `src/engine/workflow-engine.ts` | Main orchestrator, 806 lines |
| **Worker patterns** | `src/engine/worker-manager.ts` | BullMQ worker lifecycle, rate limiting |
| **Node execution** | `src/engine/node-processor.ts` | 1268 lines - CRITICAL complexity hotspot |
| **State stores** | `src/db/` | InMemory / Drizzle / Hybrid strategies |
| **Serialization** | `src/engine/processors/serialization.ts` | Worker thread data transfer |
| **Event streaming** | `src/engine/event-stream.ts` | SSE via BullMQ QueueEvents |
| **Tests** | `src/engine/tests/` | 54 test files, Bun test runner |
| **Circuit breakers** | `src/utils/circuit-breaker.ts` | Opossum integration |
| **Production utilities** | `src/utils/` | Metrics, health, shutdown, monitoring |

## CONVENTIONS

**Deviations from standard:**
- **Bun** package manager (not npm/yarn/pnpm)
- **ESM-only** module system (`"type": "module"`)
- **Tests nested** in `src/engine/tests/` (not root-level)
- **Docs as separate project** in `docs/` (Next.js)
- **Examples as standalone** project in `examples/react-flow-n8n/`
- **Maintenance scripts** in `scripts/` at root

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
- Duplicate health monitoring systems (`health.ts` + `health-monitor.ts`)
- `node-processor.ts` violates SRP (1268 lines, 5+ responsibilities)

## UNIQUE STYLES

**Worker thread sandboxing:**
- `node-processor.sandbox.js` compiled separately for BullMQ `useWorkerThreads`
- Type marker serialization for cross-thread transfer (Date, Error, BigInt, Buffer)
- Non-serializable types (functions, symbols) removed with warnings

**Multi-store strategy:**
- `InMemoryExecutionStore` — Development/testing
- `DrizzleExecutionStateStore` — PostgreSQL with optional Redis cache
- `HybridExecutionStateStore` — Redis-first (active), DB on completion

**Dual-worker architecture:**
- Node Worker (`node-execution`) — Individual node jobs, high concurrency (default: 5)
- Workflow Worker (`workflow-execution`) — Workflow triggers, half concurrency

**Event streaming simplified:**
- Node events via `job.updateProgress()` → BullMQ QueueEvents → Redis Pub/Sub
- Workflow status via `emitLocal()` (single-instance only)

## COMMANDS

```bash
# Development
bun dev                  # Vite dev server (docs)
bun test                  # Run all tests (Bun test runner)

# Build
bun build                 # Compile src/index.ts → dist/index.js
bun run build:examples  # Build example sandbox processor

# Linting
bun lint                  # ESLint with caching
bun format                 # Prettier write

# Production
bun start                 # Start engine with workers
```

## NOTES

**Configuration:**
- Redis: `SPANE_REDIS_URL` env var (or `REDIS_URL`)
- Database: `SPANE_DATABASE_URL` env var (or `DATABASE_URL`)
- Worker threads: Compile sandbox processor first → `bun build src/engine/processors/node-processor.sandbox.ts --outdir src/engine/processors --target node`

**Worker configuration:**
- `EngineConfig.workerConcurrency` (default: 5)
- `EngineConfig.useWorkerThreads` (enable CPU isolation)
- `EngineConfig.useNativeRateLimiting` (BullMQ limiter)
- `EngineConfig.useFlowProducerForSubWorkflows` (native parent-child deps)

**Large files requiring attention:**
1. `src/engine/node-processor.ts` (1268 lines) — Extract strategy pattern per node type
2. `src/db/drizzle-store.ts` (1206 lines) — Split concerns
3. `src/db/hybrid-store.ts` (978 lines) — Extract specialized handlers

## RECENT IMPROVEMENTS

**Race condition fixes with distributed locking:**
- `DistributedLock` class in `src/utils/distributed-lock.ts` now supports configurable TTL per operation type
- Auto-renewal mechanism for long-running operations (configurable renewal ratio and max renewals)
- Atomic lock acquisition using Redis SET NX with expiration
- Lua scripts for atomic check-and-delete and check-and-extend operations

**Memory leak fixes:**
- `InMemoryExecutionStore` now implements LRU eviction with configurable `maxExecutions` limit
- TTL-based cleanup for completed/failed executions (default: 1 hour)
- Automatic cleanup interval (default: 5 minutes) with unref'd timer
- Per-execution limits for logs (`maxLogsPerExecution`) and spans (`maxSpansPerExecution`)

**Sub-workflow error handling improvements:**
- `subworkflow-handler.ts` now properly propagates errors to parent workflows
- Failed sub-workflows store error results in parent execution state
- Support for `continueOnFail` at sub-workflow level via `failParentOnFailure` and `ignoreDependencyOnFailure` options
- Re-enqueues parent node after sub-workflow completion (success or failure)

**Transaction isolation with optimistic locking:**
- `DrizzleStore.updateNodeResult()` uses INSERT ... ON CONFLICT DO UPDATE for atomic upserts
- `setExecutionStatus()` uses WHERE clause with status check to prevent overwriting terminal states
- All state modifications are wrapped in transactions for atomicity

**Input validation with circular reference detection:**
- `node-utils.ts` now includes `validateInputData()` with WeakSet-based circular reference detection
- Comprehensive error messages for invalid parentIds and missing parent results
- Validates parent node success before merging data
- Clear error messages distinguishing between configuration errors, internal errors, and execution errors

**Library entry point:** Import from `spane` after npm install — `import { WorkflowEngine, NodeRegistry } from 'spane'`
