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
  triggers?: WorkflowTrigger[]; // Triggers that start this workflow
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
  createExecution(workflowId: string, parentExecutionId?: string, depth?: number): Promise<string>;
  getExecution(executionId: string): Promise<ExecutionState | null>;
  updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void>;
  setExecutionStatus(executionId: string, status: ExecutionState['status']): Promise<void>;
  updateExecutionMetadata(executionId: string, metadata: ExecutionState['metadata']): Promise<void>;
  getChildExecutions?(executionId: string): Promise<ExecutionState[]>;
  getParentExecution?(executionId: string): Promise<ExecutionState | null>;
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
  metadata?: {
    parentNodeId?: string;
    parentWorkflowId?: string;
    [key: string]: any;
  };
}

export interface INodeExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
