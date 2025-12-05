/**
 * Event type definitions for real-time workflow event streaming.
 * 
 * These types define the structure of events emitted during workflow execution,
 * enabling UI clients to receive live updates via Server-Sent Events (SSE).
 */

// ============================================================================
// BASE EVENT INTERFACE
// ============================================================================

/**
 * Base interface for all workflow events
 */
export interface BaseEvent {
  /** Event type discriminator */
  type: string;
  /** Unix timestamp in milliseconds when the event was created */
  timestamp: number;
  /** Unique identifier for the workflow execution */
  executionId: string;
}

// ============================================================================
// NODE EVENTS
// ============================================================================

/** Possible states for a node during execution */
export type NodeStatus = 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Event emitted when a node's execution state changes
 */
export interface NodeProgressEvent extends BaseEvent {
  type: 'node:progress';
  /** Unique identifier for the node within the workflow */
  nodeId: string;
  /** Unique identifier for the workflow definition */
  workflowId: string;
  /** Current execution status of the node */
  status: NodeStatus;
  /** Output data from the node (present on completion) */
  data?: any;
  /** Error message (present on failure) */
  error?: string;
  /** Execution progress percentage 0-100 (optional) */
  progress?: number;
}

// ============================================================================
// WORKFLOW EVENTS
// ============================================================================

/** Possible states for a workflow during execution */
export type WorkflowStatus = 'started' | 'completed' | 'failed' | 'paused' | 'cancelled';

/**
 * Event emitted when a workflow's overall status changes
 */
export interface WorkflowStatusEvent extends BaseEvent {
  type: 'workflow:status';
  /** Unique identifier for the workflow definition */
  workflowId: string;
  /** Current execution status of the workflow */
  status: WorkflowStatus;
  /** Error details (present on failure) */
  error?: string;
}

// ============================================================================
// EXECUTION STATE EVENT
// ============================================================================

/**
 * Event containing the full execution state, sent on SSE connection
 */
export interface ExecutionStateEvent extends BaseEvent {
  type: 'execution:state';
  /** Unique identifier for the workflow definition */
  workflowId: string;
  /** Current execution status */
  status: string;
  /** Results from all completed nodes, keyed by node ID */
  nodeResults: Record<string, any>;
  /** ISO timestamp when execution started */
  startedAt: string;
  /** ISO timestamp when execution completed (if finished) */
  completedAt?: string;
}

// ============================================================================
// ERROR EVENT
// ============================================================================

/**
 * Event emitted when an error occurs (e.g., invalid executionId)
 */
export interface ErrorEvent {
  type: 'error';
  /** Human-readable error message */
  message: string;
  /** Machine-readable error code */
  code?: string;
}

// ============================================================================
// UNION TYPE
// ============================================================================

/**
 * Union type representing all possible workflow events
 */
export type WorkflowEvent =
  | NodeProgressEvent
  | WorkflowStatusEvent
  | ExecutionStateEvent
  | ErrorEvent;

// ============================================================================
// PROGRESS PAYLOAD (for job.updateProgress())
// ============================================================================

/**
 * Payload structure for BullMQ job.updateProgress() calls.
 * This is the internal format used to emit events through BullMQ's QueueEvents.
 */
export interface ProgressPayload {
  /** Event type discriminator */
  eventType: 'node' | 'workflow';
  
  /** Common fields */
  executionId: string;
  workflowId: string;
  timestamp: number;
  
  /** Node-specific fields (when eventType === 'node') */
  nodeId?: string;
  nodeStatus?: NodeStatus;
  nodeData?: any;
  nodeError?: string;
  nodeProgress?: number;
  
  /** Workflow-specific fields (when eventType === 'workflow') */
  workflowStatus?: WorkflowStatus;
  workflowError?: string;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if an event is a NodeProgressEvent
 */
export function isNodeProgressEvent(event: WorkflowEvent): event is NodeProgressEvent {
  return event.type === 'node:progress';
}

/**
 * Type guard to check if an event is a WorkflowStatusEvent
 */
export function isWorkflowStatusEvent(event: WorkflowEvent): event is WorkflowStatusEvent {
  return event.type === 'workflow:status';
}

/**
 * Type guard to check if an event is an ExecutionStateEvent
 */
export function isExecutionStateEvent(event: WorkflowEvent): event is ExecutionStateEvent {
  return event.type === 'execution:state';
}

/**
 * Type guard to check if an event is an ErrorEvent
 */
export function isErrorEvent(event: WorkflowEvent): event is ErrorEvent {
  return event.type === 'error';
}

/**
 * Validates that a payload conforms to one of the defined event interfaces.
 * Returns true if the payload is a valid WorkflowEvent.
 */
export function isValidWorkflowEvent(payload: unknown): payload is WorkflowEvent {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  
  const event = payload as Record<string, unknown>;
  
  // Check for required 'type' field
  if (typeof event.type !== 'string') {
    return false;
  }
  
  switch (event.type) {
    case 'node:progress':
      return (
        typeof event.timestamp === 'number' &&
        typeof event.executionId === 'string' &&
        typeof event.nodeId === 'string' &&
        typeof event.workflowId === 'string' &&
        typeof event.status === 'string' &&
        ['running', 'completed', 'failed', 'skipped'].includes(event.status as string)
      );
      
    case 'workflow:status':
      return (
        typeof event.timestamp === 'number' &&
        typeof event.executionId === 'string' &&
        typeof event.workflowId === 'string' &&
        typeof event.status === 'string' &&
        ['started', 'completed', 'failed', 'paused', 'cancelled'].includes(event.status as string)
      );
      
    case 'execution:state':
      return (
        typeof event.timestamp === 'number' &&
        typeof event.executionId === 'string' &&
        typeof event.workflowId === 'string' &&
        typeof event.status === 'string' &&
        typeof event.nodeResults === 'object' &&
        event.nodeResults !== null &&
        typeof event.startedAt === 'string'
      );
      
    case 'error':
      return typeof event.message === 'string';
      
    default:
      return false;
  }
}
