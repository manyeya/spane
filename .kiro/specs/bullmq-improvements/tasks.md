# BullMQ Engine Improvements - Implementation Tasks

## Phase 1: Foundation & Non-Breaking Additions

### Task 1.1: Add FlowProducer to QueueManager
- [x] **1.1.1**: Import `FlowProducer` from bullmq in `queue-manager.ts`
- [x] **1.1.2**: Add `flowProducer: FlowProducer` property to QueueManager
- [x] **1.1.3**: Initialize FlowProducer in constructor with same connection/prefix
- [x] **1.1.4**: Add `flowProducer.close()` to QueueManager.close()
- [x] **1.1.5**: Export FlowProducer types from engine module

**Files**: `engine/queue-manager.ts`, `index.ts`

---

### Task 1.2: Create Engine Configuration Interface
- [x] **1.2.1**: Create `engine/config.ts` with `EngineConfig` interface
- [x] **1.2.2**: Add feature flags for each improvement:
  ```typescript
  interface EngineConfig {
    useFlowProducerForSubWorkflows?: boolean;
    useNativeRateLimiting?: boolean;
    useJobSchedulers?: boolean;
    useWorkerThreads?: boolean;
    useSimplifiedEventStream?: boolean;
    rateLimiter?: { max: number; duration: number };
    workerConcurrency?: number;
  }
  ```
- [x] **1.2.3**: Update WorkflowEngine constructor to accept config
- [x] **1.2.4**: Pass config to WorkerManager and other components

**Files**: `engine/config.ts`, `engine/workflow-engine.ts`

---

### Task 1.3: Create Sandboxed Processor File
- [x] **1.3.1**: Create `engine/processors/` directory
- [x] **1.3.2**: Create `node-processor.sandbox.ts` with module.exports pattern
- [x] **1.3.3**: Extract stateless processing logic that can run in sandbox
- [x] **1.3.4**: Add build step to compile sandbox processor to JS
- [x] **1.3.5**: Update tsconfig.json if needed for separate compilation

**Files**: `engine/processors/node-processor.sandbox.ts`, `tsconfig.json`

---

## Phase 2: Implement New Features

### Task 2.1: FlowProducer for Sub-Workflows
- [x] **2.1.1**: Add `executeSubWorkflowWithFlow()` method to NodeProcessor
- [x] **2.1.2**: Implement flow creation with entry nodes as children
- [x] **2.1.3**: Add `__aggregator__` node handling in processNodeJob
- [x] **2.1.4**: Implement `getChildrenValues()` aggregation logic
- [x] **2.1.5**: Add input/output mapping support
- [x] **2.1.6**: Add `failParentOnFailure` / `ignoreDependencyOnFailure` options
- [x] **2.1.7**: Update sub-workflow node type to use new method when flag enabled
- [x] **2.1.8**: Write unit tests for FlowProducer sub-workflow execution
- [x] **2.1.9**: Write integration test for nested sub-workflows

**Files**: `engine/node-processor.ts`, `engine/node-processor.test.ts`

---

### Task 2.2: Native Rate Limiting
- [x] **2.2.1**: Add `limiter` option to Worker configuration in WorkerManager
- [x] **2.2.2**: Create rate limit config aggregation from NodeRegistry
- [x] **2.2.3**: Add `Worker.RateLimitError` handling for manual rate limiting
- [x] **2.2.4**: Update HTTP/external node executors to use manual rate limiting
- [x] **2.2.5**: Add feature flag check in NodeProcessor to skip custom rate limiting
- [x] **2.2.6**: Write tests for native rate limiting behavior

**Files**: `engine/worker-manager.ts`, `engine/node-processor.ts`

---

### Task 2.3: Job Schedulers (upsertJobScheduler)
- [x] **2.3.1**: Add `registerScheduleWithUpsert()` method to WorkflowEngine
- [x] **2.3.2**: Implement `upsertJobScheduler()` call with cron pattern and timezone
- [x] **2.3.3**: Add `removeJobScheduler()` for workflow deactivation
- [x] **2.3.4**: Add `getJobSchedulers()` for listing active schedules
- [x] **2.3.5**: Update `registerWorkflow()` to use new method when flag enabled
- [x] **2.3.6**: Add migration helper to convert existing repeatable jobs
- [x] **2.3.7**: Write tests for schedule upsert idempotency

**Files**: `engine/workflow-engine.ts`

---

### Task 2.4: Sandboxed Processor Integration
- [x] **2.4.1**: Update WorkerManager to accept processor file path
- [x] **2.4.2**: Add `useWorkerThreads` option to Worker instantiation
- [x] **2.4.3**: Create factory function for sandboxed processor dependencies
- [x] **2.4.4**: Handle serialization/deserialization of job data for sandbox
- [x] **2.4.5**: Add error handling for sandbox process crashes
- [x] **2.4.6**: Write tests for sandboxed execution

**Files**: `engine/worker-manager.ts`, `engine/processors/node-processor.sandbox.ts`

---

### Task 2.5: Simplified Event Streaming
- [x] **2.5.1**: Update `WorkflowEventEmitter` to use `job.updateProgress()` only
- [x] **2.5.2**: Remove `QueueEventsProducer` from EventStreamManager
- [x] **2.5.3**: Simplify `start()` to listen only to native QueueEvents
- [x] **2.5.4**: Remove custom `emit()` method (events flow through progress)
- [x] **2.5.5**: Update `parseProgressPayload()` for new event format
- [x] **2.5.6**: Ensure SSE subscription interface unchanged
- [x] **2.5.7**: Write tests for event streaming with new implementation

**Files**: `engine/event-emitter.ts`, `engine/event-stream.ts`

---

## Phase 3: Migration & Cleanup

### Task 3.1: Migrate Existing Workflows
- [ ] **3.1.1**: Create migration script for repeatable jobs → job schedulers
- [ ] **3.1.2**: Add startup check to migrate old schedules automatically
- [ ] **3.1.3**: Log migration progress and any failures

**Files**: `scripts/migrate-to-job-schedulers.ts`

---

### Task 3.2: Remove Deprecated Code
- [x] **3.2.1**: Remove custom rate limiting code from NodeProcessor (after flag period)
- [x] **3.2.2**: Remove `executeSubWorkflow()` checkpoint/resume code
- [x] **3.2.3**: Remove `notifyParentWorkflow()` callback mechanism
- [x] **3.2.4**: Remove `subWorkflowStep` and `childExecutionId` from NodeJobData
- [x] **3.2.5**: Remove old schedule registration code from registerWorkflow
- [x] **3.2.6**: Remove `QueueEventsProducer` and related imports
- [x] **3.2.7**: Remove `workflowQueueEvents` dedicated instance
- [x] **3.2.8**: Update types.ts to remove deprecated fields

**Files**: Multiple files - cleanup pass

---

### Task 3.3: Documentation & Examples
- [x] **3.3.1**: Update README.md with new configuration options
- [x] **3.3.2**: Document FlowProducer sub-workflow behavior
- [x] **3.3.3**: Add examples for rate limiting configuration
- [x] **3.3.4**: Document sandboxed processor setup
- [x] **3.3.5**: Update API documentation for schedule management

**Files**: `README.md`, `examples/`

---

### Task 3.4: Performance Validation
- [ ] **3.4.1**: Create benchmark script comparing old vs new implementations
- [ ] **3.4.2**: Measure Redis operations reduction
- [ ] **3.4.3**: Test under load with sub-workflows
- [ ] **3.4.4**: Document performance improvements

**Files**: `scripts/benchmark.ts`

---

## Task Dependencies

```
Phase 1 (Foundation):
  1.1 ─┬─► 1.2 ─► Phase 2
       │
  1.3 ─┘

Phase 2 (Features):
  2.1 (FlowProducer) ─────────────────┐
  2.2 (Rate Limiting) ────────────────┼─► Phase 3
  2.3 (Job Schedulers) ───────────────┤
  2.4 (Sandboxed Processors) ─────────┤
  2.5 (Event Streaming) ──────────────┘

Phase 3 (Cleanup):
  3.1 (Migration) ─► 3.2 (Remove Code) ─► 3.3 (Docs) ─► 3.4 (Validation)
```

---

## Estimated Effort

| Task | Complexity | Estimate |
|------|------------|----------|
| 1.1 FlowProducer setup | Low | 1 hour |
| 1.2 Config interface | Low | 1 hour |
| 1.3 Sandboxed processor file | Medium | 2 hours |
| 2.1 FlowProducer sub-workflows | High | 6 hours |
| 2.2 Native rate limiting | Medium | 3 hours |
| 2.3 Job schedulers | Medium | 2 hours |
| 2.4 Sandboxed integration | Medium | 3 hours |
| 2.5 Event streaming | Medium | 3 hours |
| 3.1 Migration script | Low | 2 hours |
| 3.2 Code cleanup | Medium | 3 hours |
| 3.3 Documentation | Low | 2 hours |
| 3.4 Performance validation | Medium | 2 hours |

**Total Estimate: ~30 hours**

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| FlowProducer doesn't support dynamic data | Confirmed: Only use for sub-workflows, not main execution |
| Breaking existing workflows | Feature flags allow gradual rollout |
| Sandbox processor serialization issues | Test with complex job data early |
| Rate limiting behavior change | Run both implementations in parallel initially |
| Event streaming gaps | Maintain backward-compatible event format |
