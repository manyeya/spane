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
export type { IExecutionStateStore, ExecutionState, ExecutionLog, ExecutionTrace, ExecutionSpan } from './types';

// ----------------------------------------------------------------------------
// Event System
// ----------------------------------------------------------------------------

export { WorkflowEventEmitter } from './engine/event-emitter';


// ----------------------------------------------------------------------------
// Production Operations
// ----------------------------------------------------------------------------

export { MetricsCollector } from './utils/metrics';
export { GracefulShutdown } from './utils/graceful-shutdown';
export { logger } from './utils/logger';

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

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




// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// DLQ Management
// ----------------------------------------------------------------------------

export type { DLQItem } from './engine/types';
