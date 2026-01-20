# Engine Core - Workflow Orchestration

**Generated:** Tue Jan 13 2026
**Commit:** 0e18d4a

## OVERVIEW

Core workflow engine implementing distributed execution via BullMQ workers, Redis queues, event streaming, and state persistence.

## STRUCTURE

```
src/engine/
├── workflow-engine.ts       # Main orchestrator (806 lines)
├── node-processor.ts        # Node execution logic (1268 lines) ⚠️ COMPLEXITY HOTSPOT
├── worker-manager.ts        # BullMQ worker lifecycle (306 lines)
├── queue-manager.ts         # Queue management (233 lines)
├── event-stream.ts         # SSE streaming via QueueEvents (415 lines)
├── event-emitter.ts        # WorkflowEventEmitter static helpers
├── registry.ts             # Node registry with circuit breakers
├── config.ts               # EngineConfig interface (150 lines)
├── payload-manager.ts      # Large payload offloading (>50KB)
├── dlq-manager.ts         # Dead letter queue handling
├── processors/
│   ├── node-processor.sandbox.ts  # Worker thread entry point
│   ├── serialization.ts             # Cross-thread data transfer (459 lines)
│   ├── stateless-utils.ts           # Pure functions (381 lines)
│   └── index.ts                   # Barrel export
└── tests/                 # 54 test files (see AGENTS.md in tests/)
```

## WHERE TO LOOK

| Task | File | Notes |
|------|-------|-------|
| **Workflow orchestration** | `workflow-engine.ts` | enqueue, pause, resume, cancel |
| **Node execution** | `node-processor.ts` | processNodeJob, sub-workflows, delays |
| **Worker lifecycle** | `worker-manager.ts` | startWorkers, close, event handlers |
| **Queue ops** | `queue-manager.ts` | enqueue, rateLimit, FlowProducer |
| **Event streaming** | `event-stream.ts` | SSE subscribe, QueueEvents |
| **Circuit breakers** | `registry.ts` + `utils/circuit-breaker.ts` | Opossum integration |
| **Configuration** | `config.ts` | All EngineConfig options |

## CONVENTIONS

**Worker patterns:**
- Two workers: `node-execution` (high concurrency) + `workflow-execution` (half concurrency)
- Event handlers: `completed`, `failed`, `error`, `stalled` on all workers
- Rate limit errors (`isRateLimitError()`) ignored in failed handler (retried, not DLQ)

**NodeProcessor responsibilities:**
- Regular node execution (try/catch, circuit breaker, retries)
- Sub-workflow execution (FlowProducer pattern for parent-child deps)
- Delay node state machine (initial → resumed)
- Aggregator node pattern (collect child results)
- Circuit breaker integration for external nodes

**Event emission:**
- Node events: `WorkflowEventEmitter.emitNodeStarted/Completed/Failed()` → `job.updateProgress()`
- Workflow status: `eventStreamManager.emitLocal()` (single-instance only)
- Distributed: QueueEvents → Redis Pub/Sub → all instances receive
- Local: `emitter.emit()` → current instance only

## ANTI-PATTERNS (THIS ENGINE)

**node-processor.ts complexity:**
- `processNodeJob()` (lines 296-638) — 342 lines, 20+ branches → Split into strategy classes
- `executeSubWorkflowWithFlow()` (lines 1048-1154) — Extract sub-workflow coordinator
- `processDelayNode()` (lines 815-945) — Extract `DelayNodeHandler`

**Queue manager rate limiting:**
- Two rate limit patterns: native BullMQ limiter OR manual `queue.rateLimit()`
- Manual rate limit throws `WorkerManager.getRateLimitError()`, ignored in failed handler

**Sub-workflows:**
- Old pattern: `subWorkflowStep` + `childExecutionId` (DEPRECATED)
- New pattern: FlowProducer with parent-child dependencies (`useFlowProducerForSubWorkflows: true`)

## UNIQUE STYLES

**Worker thread execution:**
- `useWorkerThreads: true` → BullMQ runs node jobs in separate processes
- Data serialized via `serialization.ts` (Date, Error, BigInt, Buffer, Map, Set)
- Sandbox processor compiled to JS: `bun build src/engine/processors/node-processor.sandbox.ts --outdir src/engine/processors --target node`

**FlowProducer for sub-workflows:**
- Recursive flow tree building (`buildFlowTreeFromEntryNodes`)
- Parent-child job dependencies via BullMQ
- Aggregator node collects child results

**Event streaming simplified:**
- No custom event producer → uses BullMQ's `job.updateProgress()`
- QueueEvents listener on `progress` → parse → emit to subscribers
- `subscribe(executionId?)` returns `AsyncIterable<WorkflowEvent>` with filtering

## NOTES

**WorkerManager configuration:**
```typescript
workerManager.startWorkers(10) // Override concurrency
// Events: completed (metrics), failed (DLQ), error (log), stalled (warn)
```

**Node execution flow:**
1. Check dependencies (wait for parent results)
2. Resolve input data (`mergeParentInputs`, `applyInputMapping`)
3. Execute node (circuit breaker for external nodes)
4. Handle result/error (retry with backoff, DLQ on exhaustion)
5. Enqueue child nodes (conditional branching, sub-workflows)
6. Update state (`stateStore.updateNodeResult`)
7. Emit event (`WorkflowEventEmitter.emitNodeCompleted`)

**Circuit breaker for external nodes:**
- Registry creates breaker per node type
- `registry.isExternalNode(node.type)` checks
- Breaker wraps executor: `breaker.execute(() => executor.execute(context))`
- `CircuitBreakerError` prevents retries (permanent failure)

**Payload offloading:**
- `PayloadManager` offloads large data (>50KB) to Redis
- Node jobs receive payload reference instead of inline data
- Reduces Redis queue memory for large payloads
