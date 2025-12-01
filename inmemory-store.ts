import type { ExecutionResult, ExecutionState, IExecutionStateStore } from "./types";

export class InMemoryExecutionStore implements IExecutionStateStore {
  private executions: Map<string, ExecutionState> = new Map();

  async createExecution(workflowId: string): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const execution: ExecutionState = {
      executionId,
      workflowId,
      status: 'running',
      nodeResults: {},
      startedAt: new Date(),
      retryCount: 0,
      maxRetries: 3,
      errorPropagation: {},
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

  async setExecutionStatus(executionId: string, status: 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying'): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.status = status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        execution.completedAt = new Date();
      }
      if (status === 'failed') {
        execution.failedAt = new Date();
      }
    }
  }

  async incrementRetryCount(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.retryCount = (execution.retryCount || 0) + 1;
    }
  }

  async setErrorPropagation(executionId: string, nodeId: string, dependentIds: string[]): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      if (!execution.errorPropagation) {
        execution.errorPropagation = {};
      }
      execution.errorPropagation[nodeId] = dependentIds;
    }
  }

  async getFailedNodes(executionId: string): Promise<string[]> {
    const execution = this.executions.get(executionId);
    if (!execution) return [];

    return Object.entries(execution.nodeResults)
      .filter(([_, result]) => !result.success)
      .map(([nodeId, _]) => nodeId);
  }
}