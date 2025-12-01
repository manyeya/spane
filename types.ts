// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface NodeJobData {
  executionId: string;
  workflowId: string;
  nodeId: string;
  inputData?: any;
}

export interface WorkflowJobData {
  workflowId: string;
  initialData?: any;
}

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
  retryable?: boolean;
  failureReason?: 'timeout' | 'error' | 'cancelled' | 'dependency_failed';
}

export interface IExecutionStateStore {
  createExecution(workflowId: string): Promise<string>;
  updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void>;
  getExecution(executionId: string): Promise<ExecutionState | null>;
  setExecutionStatus(executionId: string, status: 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying'): Promise<void>;
  incrementRetryCount(executionId: string): Promise<void>;
  getRetryCount(executionId: string): Promise<number>;
  setRetryCount(executionId: string, count: number): Promise<void>;
  setErrorPropagation(executionId: string, nodeId: string, dependentIds: string[]): Promise<void>;
  getFailedNodes(executionId: string): Promise<string[]>;
}

export interface ExecutionState {
  executionId: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';
  nodeResults: Record<string, ExecutionResult>;
  startedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  retryCount?: number;
  maxRetries?: number;
  errorPropagation?: Record<string, string[]>; // nodeId -> array of dependent node IDs
}

export interface INodeExecutor {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}

// Dead Letter Queue Types
export interface DLQJobData {
  executionId: string;
  workflowId: string;
  nodeId: string;
  originalJobData: NodeJobData;
  failureReason: string;
  failureCount: number;
  lastFailedAt: Date;
  errorDetails?: any;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffStrategy: 'exponential' | 'fixed' | 'linear';
  baseDelay: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

export interface ErrorRecoveryOptions {
  retryPolicy: RetryPolicy;
  deadLetterQueue: boolean;
  errorPropagation: boolean;
  timeoutMs?: number;
}

export interface IDeadLetterQueueManager {
  addToDLQ(jobData: DLQJobData): Promise<void>;
  retryFromDLQ(executionId: string, nodeId: string): Promise<boolean>;
  getDLQJobs(executionId?: string): Promise<DLQJobData[]>;
  purgeDLQJob(executionId: string, nodeId: string): Promise<boolean>;
}
