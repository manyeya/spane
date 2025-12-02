import type { ExecutionResult, ExecutionState, IExecutionStateStore } from "./types";

export class InMemoryExecutionStore implements IExecutionStateStore {
  private executions: Map<string, ExecutionState> = new Map();

  async createExecution(workflowId: string, parentExecutionId?: string, depth: number = 0): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const execution: ExecutionState = {
      executionId,
      workflowId,
      status: 'running',
      nodeResults: {},
      startedAt: new Date(),
      parentExecutionId,
      depth,
    };
    this.executions.set(executionId, execution);
    return executionId;
  }

  async updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.nodeResults[nodeId] = result;
    }
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    return this.executions.get(executionId) || null;
  }

  async setExecutionStatus(executionId: string, status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.status = status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        execution.completedAt = new Date();
      }
    }
  }

  async updateExecutionMetadata(executionId: string, metadata: ExecutionState['metadata']): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.metadata = metadata;
    }
  }

  async getChildExecutions(executionId: string): Promise<ExecutionState[]> {
    const children: ExecutionState[] = [];
    for (const execution of this.executions.values()) {
      if (execution.parentExecutionId === executionId) {
        children.push(execution);
      }
    }
    return children;
  }

  async getParentExecution(executionId: string): Promise<ExecutionState | null> {
    const execution = this.executions.get(executionId);
    if (!execution || !execution.parentExecutionId) {
      return null;
    }
    return this.executions.get(execution.parentExecutionId) || null;
  }
}