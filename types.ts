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
}

export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  nodeId: string;
  inputData: any;
  previousResults: Record<string, any>; // Results from upstream nodes
}

export interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface IExecutionStateStore {
  createExecution(workflowId: string): Promise<string>;
  updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void>;
  getExecution(executionId: string): Promise<ExecutionState | null>;
  setExecutionStatus(executionId: string, status: 'running' | 'completed' | 'failed'): Promise<void>;
}

export interface ExecutionState {
  executionId: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  nodeResults: Record<string, ExecutionResult>;
  startedAt: Date;
  completedAt?: Date;
}

export interface INodeExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
