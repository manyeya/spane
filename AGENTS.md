# SPANE - Parallel Asynchronous Node Execution

**Generated:** Tue Jan 13 2026
**Commit:** 0e18d4a
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
│   │   ├── worker-manager.ts
│   │   ├── queue-manager.ts
│   │   ├── event-stream.ts
│   │   ├── event-emitter.ts
│   │   ├── registry.ts
│   │   ├── config.ts
│   │   ├── processors/      # Worker thread sandboxing
│   │   └── tests/           # 54 test files (property/integration/unit)
│   ├── db/                # State persistence (3 strategies)
│   │   ├── inmemory-store.ts
│   │   ├── drizzle-store.ts
│   │   └── hybrid-store.ts
│   └── utils/             # Production utilities
│       ├── circuit-breaker.ts
│       ├── metrics.ts
│       ├── health.ts
│       ├── health-monitor.ts  # DUPLICATE - see health.ts
│       ├── graceful-shutdown.ts
│       ├── timeout-monitor.ts
│       ├── distributed-lock.ts
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
- Inconsistent logging (pino vs console.log in many files)
- `node-processor.ts` violates SRP (1268 lines, 5+ responsibilities)
- `drizzle-store.ts` has N+1 query problem in `persistCompleteExecution()`

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
2. `src/db/drizzle-store.ts` (1206 lines) — Fix N+1 queries, split concerns
3. `src/db/hybrid-store.ts` (978 lines) — Extract specialized handlers

**Library entry point:** Import from `spane` after npm install — `import { WorkflowEngine, NodeRegistry } from 'spane'`
