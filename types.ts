// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface NodeDefinition {
  id: string;
  type: string;
  config: Record<string, any>;
  inputs: string[]; // IDs of nodes that feed into this node
  outputs: string[]; // IDs of nodes this feeds into
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: NodeDefinition[];
  entryNodeId: string; // Starting node for full workflow execution
  maxConcurrency?: number; // Maximum number of concurrent nodes for this workflow
  concurrencyLockTTL?: number; // TTL for the concurrency lock in seconds
  triggers?: WorkflowTrigger[]; // Triggers that start this workflow
  // Advanced Queue Features
  priority?: number; // Job priority (1-10, higher = more important, default: 5)
  delay?: number; // Delay in milliseconds before execution
  jobId?: string; // Custom job ID for deduplication (prevents duplicate executions)
}

export type WorkflowTrigger = WebhookTrigger | ScheduleTrigger;

/**
 * Configuration for sub-workflow node type
 * Allows calling another workflow as a reusable component
 */
export interface SubWorkflowConfig {
  workflowId: string; // ID of the sub-workflow to execute
  inputMapping?: Record<string, string>; // Map parent data keys to sub-workflow input keys
  outputMapping?: Record<string, string>; // Map sub-workflow output keys to parent data keys
}

/**
 * Configuration for delay node type.
 * Allows pausing workflow execution for a specified duration.
 * 
 * Duration precedence (first found is used):
 * 1. duration (milliseconds) - highest priority
 * 2. durationSeconds (converted to milliseconds)
 * 3. durationMinutes (converted to milliseconds)
 */
export interface DelayNodeConfig {
  /** Duration in milliseconds (highest priority) */
  duration?: number;
  /** Duration in seconds (converted to milliseconds internally) */
  durationSeconds?: number;
  /** Duration in minutes (converted to milliseconds internally) */
  durationMinutes?: number;
}

export interface WebhookTrigger {
  type: 'webhook';
  config: {
    path: string; // URL path segment, e.g. "user-signup" -> /api/webhooks/user-signup
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; // Default POST
  };
}

export interface ScheduleTrigger {
  type: 'schedule';
  config: {
    cron: string; // Standard cron expression
    timezone?: string;
  };
}

/**
 * Parent outputs when a node has multiple parents (merge scenario)
 * Keys are parent node IDs, values are their execution results
 */
export type ParentOutputs = Record<string, any>;

/**
 * Execution context provided to node executors
 * 
 * Data Passing Behavior:
 * - Entry nodes: `inputData` contains the initial workflow data
 * - Single parent nodes: `inputData` contains the parent's output data directly
 * - Multiple parent nodes: `inputData` contains an object with parent node IDs as keys
 * - All nodes: `previousResults` contains all completed node results for complex scenarios
 */
export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  nodeId: string;
  /** 
   * Input data for this node:
   * - For entry nodes: initial workflow data
   * - For single parent: parent's output.data
   * - For multiple parents: { 'parent-id': output.data, ... }
   */
  inputData: any;
  /** The node's own configuration (from workflow definition) */
  nodeConfig?: Record<string, any>;
  /** All completed node results, keyed by node ID */
  previousResults: Record<string, ExecutionResult>; // Results from upstream nodes
  /** ID of parent execution if this is a sub-workflow (undefined for root workflows) */
  parentExecutionId?: string;
  /** Nesting depth (0 for root workflows, increments for each sub-workflow level) */
  depth: number;
}

export interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  /** IDs of nodes to execute next. If undefined, all outputs are executed. */
  nextNodes?: string[];
  /** Indicates if the node was skipped (not executed) */
  skipped?: boolean;
}

export interface IExecutionStateStore {
  createExecution(workflowId: string, parentExecutionId?: string, depth?: number, initialData?: any): Promise<string>;
  getExecution(executionId: string): Promise<ExecutionState | null>;
  getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>>;
  getPendingNodeCount(executionId: string, totalNodes: number): Promise<number>;
  updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void>;
  cacheNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void>;
  setExecutionStatus(executionId: string, status: ExecutionState['status']): Promise<void>;
  updateExecutionMetadata(executionId: string, metadata: ExecutionState['metadata']): Promise<void>;
  getChildExecutions?(executionId: string): Promise<ExecutionState[]>;
  getParentExecution?(executionId: string): Promise<ExecutionState | null>;

  // Workflow Persistence (with pagination support)
  saveWorkflow(workflow: WorkflowDefinition, changeNotes?: string, createdBy?: string): Promise<number>; // Returns version ID
  getWorkflow(workflowId: string, version?: number): Promise<WorkflowDefinition | null>;
  getWorkflowVersion(workflowId: string): Promise<number | null>; // Get current version ID
  listWorkflows(activeOnly?: boolean, limit?: number, offset?: number): Promise<WorkflowDefinition[]>;
  deactivateWorkflow(workflowId: string): Promise<void>;

  // Execution listing (with pagination support)
  listExecutions?(workflowId?: string, limit?: number, offset?: number): Promise<Array<{
    executionId: string;
    workflowId: string;
    status: string;
    startedAt: Date;
    completedAt?: Date;
  }>>;

  // Count methods for pagination
  getWorkflowCount?(activeOnly?: boolean): Promise<number>;
  getExecutionCount?(workflowId?: string): Promise<number>;

  // Observability
  addLog(log: ExecutionLog): Promise<void>;
  getLogs(executionId: string): Promise<ExecutionLog[]>;
  addSpan(executionId: string, span: ExecutionSpan): Promise<void>;
  updateSpan(executionId: string, spanId: string, update: Partial<ExecutionSpan>): Promise<void>;
  getTrace(executionId: string): Promise<ExecutionTrace | null>;

  // Data Retention / Pruning
  pruneExecutions?(criteria: { maxAgeHours?: number; maxCount?: number }): Promise<number>;
}

export interface ExecutionState {
  executionId: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  nodeResults: Record<string, ExecutionResult>;
  startedAt: Date;
  completedAt?: Date;
  /** ID of parent execution if this is a sub-workflow */
  parentExecutionId?: string;
  /** Nesting depth (0 for root, increments for sub-workflows) */
  depth: number;
  /** Initial data passed to the workflow execution */
  initialData?: any;
  metadata?: {
    parentNodeId?: string;
    parentWorkflowId?: string;
    [key: string]: any;
  };
}

export interface ExecutionLog {
  id: string;
  executionId: string;
  nodeId?: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: Date;
  metadata?: any;
}

export interface ExecutionTrace {
  executionId: string;
  workflowId: string;
  spans: ExecutionSpan[];
}

export interface ExecutionSpan {
  id: string;
  nodeId: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
  metadata?: any;
}

/**
 * Configuration for bulk workflow enqueue operations
 */
export interface BulkWorkflowEnqueue {
  workflowId: string;
  initialData?: any;
  priority?: number; // Job priority (1-10, higher = more important)
  delay?: number; // Delay in milliseconds before execution
  jobId?: string; // Custom job ID for deduplication
}

export interface INodeExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
