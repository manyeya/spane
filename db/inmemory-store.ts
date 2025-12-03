import type { ExecutionResult, ExecutionState, IExecutionStateStore, ExecutionLog, ExecutionTrace, ExecutionSpan } from "../types";

export class InMemoryExecutionStore implements IExecutionStateStore {
  private executions: Map<string, ExecutionState> = new Map();

  async createExecution(workflowId: string, parentExecutionId?: string, depth: number = 0, initialData?: any): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const execution: ExecutionState = {
      executionId,
      workflowId,
      status: 'running',
      nodeResults: {},
      startedAt: new Date(),
      parentExecutionId,
      depth,
      initialData,
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

  async cacheNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    // For in-memory, caching is the same as updating the main object
    return this.updateNodeResult(executionId, nodeId, result);
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    return this.executions.get(executionId) || null;
  }

  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    const execution = this.executions.get(executionId);
    if (!execution) return {};

    const results: Record<string, ExecutionResult> = {};
    for (const nodeId of nodeIds) {
      if (execution.nodeResults[nodeId]) {
        results[nodeId] = execution.nodeResults[nodeId];
      }
    }
    return results;
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    const execution = this.executions.get(executionId);
    if (!execution) return totalNodes;

    return totalNodes - Object.keys(execution.nodeResults).length;
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

  // Observability
  private logs: Map<string, ExecutionLog[]> = new Map();
  private traces: Map<string, ExecutionTrace> = new Map();

  async addLog(log: ExecutionLog): Promise<void> {
    const logs = this.logs.get(log.executionId) || [];
    logs.push(log);
    this.logs.set(log.executionId, logs);
  }

  async getLogs(executionId: string): Promise<ExecutionLog[]> {
    return this.logs.get(executionId) || [];
  }

  async addSpan(executionId: string, span: ExecutionSpan): Promise<void> {
    if (!this.traces.has(executionId)) {
      const execution = this.executions.get(executionId);
      if (!execution) {
        throw new Error(`Cannot add span: execution ${executionId} not found`);
      }
      this.traces.set(executionId, {
        executionId,
        workflowId: execution.workflowId,
        spans: []
      });
    }
    this.traces.get(executionId)!.spans.push(span);
  }

  async updateSpan(executionId: string, spanId: string, update: Partial<ExecutionSpan>): Promise<void> {
    const trace = this.traces.get(executionId);
    if (trace) {
      const spanIndex = trace.spans.findIndex(s => s.id === spanId);
      if (spanIndex !== -1) {
        const existingSpan = trace.spans[spanIndex];
        trace.spans[spanIndex] = { ...existingSpan, ...update } as ExecutionSpan;
      }
    }
  }

  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    return this.traces.get(executionId) || null;
  }

  // Workflow Persistence - Not supported in memory store
  async saveWorkflow(workflow: any, changeNotes?: string, createdBy?: string): Promise<number> {
    // Log warning but don't throw - allow in-memory operation
    console.warn('InMemoryExecutionStore: Workflow not persisted (use DrizzleStore for persistence)');
    return 0; // Return dummy version ID
  }

  async getWorkflow(workflowId: string, version?: number): Promise<any | null> {
    // In-memory store doesn't persist workflows, return null to allow lazy loading from database
    return null;
  }

  async getWorkflowVersion(workflowId: string): Promise<number | null> {
    return null; // No version tracking in memory
  }

  async listWorkflows(activeOnly?: boolean): Promise<any[]> {
    return []; // No workflows stored in memory
  }

  async deactivateWorkflow(workflowId: string): Promise<void> {
    // No-op in memory store
  }
}