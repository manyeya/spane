# BullMQ Engine Improvements - Requirements

## Overview
Leverage native BullMQ features to reduce custom code complexity while maintaining the dynamic parent-to-child data passing architecture.

## Functional Requirements

### FR-1: FlowProducer for Sub-Workflows Only
- **FR-1.1**: Replace checkpoint/resume pattern in `executeSubWorkflow()` with FlowProducer
- **FR-1.2**: Parent node creates flow with sub-workflow nodes as children
- **FR-1.3**: Use `getChildrenValues()` to aggregate sub-workflow results
- **FR-1.4**: Maintain existing node-to-node execution pattern for main workflow (no FlowProducer)
- **FR-1.5**: Support input/output mapping for sub-workflows

### FR-2: Native Rate Limiting
- **FR-2.1**: Replace custom Redis INCR/EXPIRE rate limiting with BullMQ Worker limiter
- **FR-2.2**: Support per-node-type rate limits via worker configuration
- **FR-2.3**: Support manual rate limiting with `worker.rateLimit()` for external API responses
- **FR-2.4**: Maintain rate limit configuration in NodeRegistry

### FR-3: Job Schedulers (upsertJobScheduler)
- **FR-3.1**: Replace manual repeatable job management with `upsertJobScheduler()`
- **FR-3.2**: Idempotent schedule registration (no manual find/remove)
- **FR-3.3**: Support cron patterns with timezone
- **FR-3.4**: Support schedule updates without manual cleanup

### FR-4: Flow Dependency Options
- **FR-4.1**: Use `failParentOnFailure` for sub-workflow error propagation
- **FR-4.2**: Use `ignoreDependencyOnFailure` to replace `continueOnFail` in sub-workflows
- **FR-4.3**: Maintain existing `continueOnFail` for main workflow nodes (not using FlowProducer)

### FR-5: Sandboxed Processors (Optional/Future)
- **FR-5.1**: Create separate processor file for node execution
- **FR-5.2**: Support `useWorkerThreads` option for CPU isolation
- **FR-5.3**: Maintain compatibility with current inline processor
- **FR-5.4**: Configuration flag to enable/disable sandboxing

### FR-6: Simplified Event Streaming
- **FR-6.1**: Use `job.updateProgress()` for node status events instead of custom QueueEventsProducer
- **FR-6.2**: Leverage native QueueEvents for workflow status tracking
- **FR-6.3**: Remove custom event publishing where BullMQ native events suffice
- **FR-6.4**: Maintain SSE subscription interface for API consumers

## Non-Functional Requirements

### NFR-1: Backward Compatibility
- Existing workflow definitions must work without modification
- API contracts remain unchanged
- State store interface unchanged

### NFR-2: Performance
- No regression in job throughput
- Reduced Redis operations from native BullMQ optimizations

### NFR-3: Reliability
- Leverage BullMQ's battle-tested implementations
- Maintain exactly-once execution semantics

### NFR-4: Observability
- Maintain existing logging patterns
- Event streaming continues to work for UI updates

## Out of Scope
- Changing main workflow node-to-node data passing pattern
- BullMQ Pro features (group rate limiting, batches)
- Database schema changes
