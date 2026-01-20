// ============================================================================
// SPANE - Parallel Asynchronous Node Execution
// Main Library Export
// ============================================================================

// ----------------------------------------------------------------------------
// Core Engine
// ----------------------------------------------------------------------------

export { WorkflowEngine } from './engine/workflow-engine';
export type { EngineConfig, RateLimiterConfig } from './engine/config';
export type { WorkflowCacheOptions } from './engine/workflow-engine';
export { DEFAULT_ENGINE_CONFIG, mergeEngineConfig } from './engine/config';
export type { ValidationError, ValidationErrorType, ValidationResult } from './engine/graph-validation';
export {
  detectCycle,
  findUnreachableNodes,
  findMissingReferences,
  findDuplicateNodeIds,
  validateEntryNode,
  validateWorkflow,
  isValidWorkflow
} from './engine/graph-validation';

// ----------------------------------------------------------------------------
// Node Registry
// ----------------------------------------------------------------------------

export { NodeRegistry } from './engine/registry';
export type { INodeExecutor } from './types';

// ----------------------------------------------------------------------------
// State Stores
// ----------------------------------------------------------------------------

export { InMemoryExecutionStore } from './db/inmemory-store';
export { DrizzleExecutionStateStore } from './db/drizzle-store';
export { HybridExecutionStateStore } from './db/hybrid-store';
export type { IExecutionStateStore, ExecutionState, ExecutionLog, ExecutionTrace, ExecutionSpan } from './types';

// ----------------------------------------------------------------------------
// Event System
// ----------------------------------------------------------------------------

export { WorkflowEventEmitter } from './engine/event-emitter';
export { EventStreamManager } from './engine/event-stream';
export type { 
  BaseEvent,
  NodeProgressEvent,
  WorkflowStatusEvent,
  ExecutionStateEvent,
  ErrorEvent,
  WorkflowEvent,
  NodeStatus,
  WorkflowStatus,
  ProgressPayload
} from './engine/event-types';

export {
  isValidWorkflowEvent,
  isNodeProgressEvent,
  isWorkflowStatusEvent,
  isExecutionStateEvent,
  isErrorEvent
} from './engine/event-types';

// ----------------------------------------------------------------------------
// Production Operations
// ----------------------------------------------------------------------------

export { MetricsCollector } from './utils/metrics';
export { CircuitBreakerRegistry } from './utils/circuit-breaker';
export { HealthMonitor } from './utils/health';
export { GracefulShutdown } from './utils/graceful-shutdown';
export { TimeoutMonitor } from './utils/timeout-monitor';
export { logger } from './utils/logger';

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

export { applyAutoLayout } from './utils/layout';

// ----------------------------------------------------------------------------
// BullMQ Exports (for sub-workflows)
// ----------------------------------------------------------------------------

export { FlowProducer } from 'bullmq';
export type { FlowJob, FlowChildJob, FlowOpts, FlowProducerListener, RateLimitError } from 'bullmq';
export { RateLimitError as WorkerRateLimitError, isRateLimitError } from './engine/worker-manager';

// ----------------------------------------------------------------------------
// Core Types
// ----------------------------------------------------------------------------

export type {
  NodeDefinition,
  WorkflowDefinition,
  WorkflowTrigger,
  WebhookTrigger,
  ScheduleTrigger,
  SubWorkflowConfig,
  DelayNodeConfig,
  RetryPolicy,
  ExecutionContext,
  ExecutionResult,
  ParentOutputs,
  BulkWorkflowEnqueue
} from './types';

// ----------------------------------------------------------------------------
// Payload Management
// ----------------------------------------------------------------------------

export { PayloadManager } from './engine/payload-manager';

// ----------------------------------------------------------------------------
// Worker Management
// ----------------------------------------------------------------------------

export { WorkerManager } from './engine/worker-manager';

// ----------------------------------------------------------------------------
// Queue Management
// ----------------------------------------------------------------------------

export { QueueManager } from './engine/queue-manager';

// ----------------------------------------------------------------------------
// DLQ Management
// ----------------------------------------------------------------------------

export { DLQManager } from './engine/dlq-manager';
export type { DLQItem } from './engine/types';
