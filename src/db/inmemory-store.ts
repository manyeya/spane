import type { ExecutionResult, ExecutionState, IExecutionStateStore, ExecutionLog, ExecutionTrace, ExecutionSpan } from "../types";
import { logger } from "../utils/logger";

/**
 * Configuration options for InMemoryExecutionStore.
 *
 * WARNING: This store is for development and testing only.
 * Data is lost on process restart and not suitable for production use.
 */
export interface InMemoryStoreConfig {
  /** Maximum number of executions to keep in memory (default: 1000) */
  maxExecutions?: number;
  /** Maximum number of logs to keep per execution (default: 1000) */
  maxLogsPerExecution?: number;
  /** Maximum number of spans to keep per execution trace (default: 500) */
  maxSpansPerExecution?: number;
  /** TTL in milliseconds for completed/failed executions (default: 1 hour) */
  completedExecutionTtl?: number;
  /** Interval in milliseconds for cleanup (default: 5 minutes) */
  cleanupInterval?: number;
  /** Whether to enable automatic cleanup (default: true) */
  enableCleanup?: boolean;
}

const DEFAULT_CONFIG: Required<InMemoryStoreConfig> = {
  maxExecutions: 1000,
  maxLogsPerExecution: 1000,
  maxSpansPerExecution: 500,
  completedExecutionTtl: 60 * 60 * 1000, // 1 hour
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  enableCleanup: true,
};

// Track insertion order for LRU eviction
interface TimestampedValue<T> {
  value: T;
  insertedAt: number;
  lastAccessedAt: number;
}

/**
 * In-memory execution state store with TTL and LRU eviction.
 *
 * DEVELOPMENT USE ONLY - Not suitable for production due to:
 * - Data loss on process restart
 * - No persistence guarantees
 * - Memory limits
 * - No distributed execution support
 *
 * Use DrizzleStore for production deployments.
 */
export class InMemoryExecutionStore implements IExecutionStateStore {
  private executions: Map<string, TimestampedValue<ExecutionState>> = new Map();
  private logs: Map<string, TimestampedValue<ExecutionLog[]>> = new Map();
  private traces: Map<string, TimestampedValue<ExecutionTrace>> = new Map();

  private config: Required<InMemoryStoreConfig>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: InMemoryStoreConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.warn(
      'InMemoryExecutionStore initialized - This store is for development only. ' +
      'Data is not persisted and will be lost on restart. ' +
      'Use DrizzleStore for production.'
    );

    if (this.config.enableCleanup) {
      this.startCleanup();
    }
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);

    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clean up expired entries and enforce size limits.
   * Runs automatically on a timer, but can also be called manually.
   */
  cleanup(): void {
    const now = Date.now();
    let removedExecutions = 0;
    let removedLogs = 0;
    let removedTraces = 0;

    // Remove completed/failed executions past TTL
    for (const [id, { value, lastAccessedAt }] of this.executions) {
      const isTerminal = value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled';
      const age = now - (value.completedAt?.getTime() || lastAccessedAt);

      if (isTerminal && age > this.config.completedExecutionTtl) {
        this.executions.delete(id);
        this.logs.delete(id);
        this.traces.delete(id);
        removedExecutions++;
      }
    }

    // Enforce max executions limit with LRU eviction
    if (this.executions.size > this.config.maxExecutions) {
      const entries = Array.from(this.executions.entries())
        .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

      const toRemove = this.executions.size - this.config.maxExecutions;
      for (let i = 0; i < toRemove; i++) {
        const entry = entries[i];
        if (entry) {
          const [id] = entry;
          this.executions.delete(id);
          this.logs.delete(id);
          this.traces.delete(id);
          removedExecutions++;
        }
      }
    }

    // Trim oversized logs and traces
    for (const [id, { value: logs }] of this.logs) {
      if (logs.length > this.config.maxLogsPerExecution) {
        const trimmed = logs.slice(-this.config.maxLogsPerExecution);
        this.logs.set(id, { value: trimmed, insertedAt: Date.now(), lastAccessedAt: Date.now() });
        removedLogs += logs.length - trimmed.length;
      }
    }

    for (const [id, { value: trace }] of this.traces) {
      if (trace.spans.length > this.config.maxSpansPerExecution) {
        const trimmed = trace.spans.slice(-this.config.maxSpansPerExecution);
        this.traces.set(id, {
          value: { ...trace, spans: trimmed },
          insertedAt: Date.now(),
          lastAccessedAt: Date.now()
        });
        removedTraces += trace.spans.length - trimmed.length;
      }
    }

    if (removedExecutions > 0 || removedLogs > 0 || removedTraces > 0) {
      logger.debug({
        removedExecutions,
        removedLogs,
        removedTraces,
        totalExecutions: this.executions.size,
      }, 'InMemoryExecutionStore: Cleanup completed');
    }
  }

  /**
   * Get current store statistics for monitoring.
   */
  getStats(): {
    executionCount: number;
    logCount: number;
    traceCount: number;
    config: InMemoryStoreConfig;
  } {
    let logCount = 0;
    for (const logs of this.logs.values()) {
      logCount += logs.value.length;
    }

    let spanCount = 0;
    for (const trace of this.traces.values()) {
      spanCount += trace.value.spans.length;
    }

    return {
      executionCount: this.executions.size,
      logCount,
      traceCount: spanCount,
      config: this.config,
    };
  }

  /**
   * Clear all stored data. Useful for testing.
   */
  clear(): void {
    this.executions.clear();
    this.logs.clear();
    this.traces.clear();
  }

  /**
   * Cleanup resources when the store is no longer needed.
   */
  destroy(): void {
    this.stopCleanup();
    this.clear();
  }

  private wrapExecution(value: ExecutionState): TimestampedValue<ExecutionState> {
    const now = Date.now();
    return { value, insertedAt: now, lastAccessedAt: now };
  }

  private updateAccess<T>(timestamped: TimestampedValue<T>): TimestampedValue<T> {
    timestamped.lastAccessedAt = Date.now();
    return timestamped;
  }

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
    this.executions.set(executionId, this.wrapExecution(execution));

    // Trigger cleanup if we're approaching the limit
    if (this.executions.size > this.config.maxExecutions * 0.9) {
      this.cleanup();
    }

    return executionId;
  }

  async updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    const timestamped = this.executions.get(executionId);
    if (timestamped) {
      timestamped.value.nodeResults[nodeId] = result;
      this.updateAccess(timestamped);
    }
  }

  async cacheNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    // For in-memory, caching is the same as updating the main object
    return this.updateNodeResult(executionId, nodeId, result);
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    const timestamped = this.executions.get(executionId);
    if (timestamped) {
      this.updateAccess(timestamped);
      return timestamped.value;
    }
    return null;
  }

  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    const timestamped = this.executions.get(executionId);
    if (!timestamped) return {};

    this.updateAccess(timestamped);
    const execution = timestamped.value;

    const results: Record<string, ExecutionResult> = {};
    for (const nodeId of nodeIds) {
      if (execution.nodeResults[nodeId]) {
        results[nodeId] = execution.nodeResults[nodeId];
      }
    }
    return results;
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    const timestamped = this.executions.get(executionId);
    if (!timestamped) return totalNodes;

    this.updateAccess(timestamped);
    return totalNodes - Object.keys(timestamped.value.nodeResults).length;
  }

  async setExecutionStatus(executionId: string, status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'): Promise<void> {
    const timestamped = this.executions.get(executionId);
    if (timestamped) {
      timestamped.value.status = status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        timestamped.value.completedAt = new Date();
      }
      this.updateAccess(timestamped);
    }
  }

  async updateExecutionMetadata(executionId: string, metadata: ExecutionState['metadata']): Promise<void> {
    const timestamped = this.executions.get(executionId);
    if (timestamped) {
      timestamped.value.metadata = metadata;
      this.updateAccess(timestamped);
    }
  }

  async getChildExecutions(executionId: string): Promise<ExecutionState[]> {
    const children: ExecutionState[] = [];
    for (const timestamped of this.executions.values()) {
      if (timestamped.value.parentExecutionId === executionId) {
        children.push(timestamped.value);
      }
    }
    return children;
  }

  async getParentExecution(executionId: string): Promise<ExecutionState | null> {
    const timestamped = this.executions.get(executionId);
    if (!timestamped || !timestamped.value.parentExecutionId) {
      return null;
    }
    const parentTimestamped = this.executions.get(timestamped.value.parentExecutionId);
    return parentTimestamped?.value || null;
  }

  // Observability
  async addLog(log: ExecutionLog): Promise<void> {
    const existing = this.logs.get(log.executionId);
    const now = Date.now();

    if (existing) {
      existing.value.push(log);
      existing.lastAccessedAt = now;

      // Trim if over limit
      if (existing.value.length > this.config.maxLogsPerExecution) {
        existing.value = existing.value.slice(-this.config.maxLogsPerExecution);
      }
    } else {
      this.logs.set(log.executionId, { value: [log], insertedAt: now, lastAccessedAt: now });
    }
  }

  async getLogs(executionId: string): Promise<ExecutionLog[]> {
    const timestamped = this.logs.get(executionId);
    if (timestamped) {
      timestamped.lastAccessedAt = Date.now();
      return timestamped.value;
    }
    return [];
  }

  async addSpan(executionId: string, span: ExecutionSpan): Promise<void> {
    const executionTimestamped = this.executions.get(executionId);
    if (!executionTimestamped) {
      throw new Error(`Cannot add span: execution ${executionId} not found`);
    }

    const existing = this.traces.get(executionId);
    const now = Date.now();

    if (existing) {
      existing.value.spans.push(span);
      existing.lastAccessedAt = now;

      // Trim if over limit
      if (existing.value.spans.length > this.config.maxSpansPerExecution) {
        existing.value.spans = existing.value.spans.slice(-this.config.maxSpansPerExecution);
      }
    } else {
      this.traces.set(executionId, {
        value: {
          executionId,
          workflowId: executionTimestamped.value.workflowId,
          spans: [span]
        },
        insertedAt: now,
        lastAccessedAt: now
      });
    }
  }

  async updateSpan(executionId: string, spanId: string, update: Partial<ExecutionSpan>): Promise<void> {
    const timestamped = this.traces.get(executionId);
    if (timestamped) {
      const spanIndex = timestamped.value.spans.findIndex(s => s.id === spanId);
      if (spanIndex !== -1) {
        const existingSpan = timestamped.value.spans[spanIndex];
        timestamped.value.spans[spanIndex] = { ...existingSpan, ...update } as ExecutionSpan;
        timestamped.lastAccessedAt = Date.now();
      }
    }
  }

  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    const timestamped = this.traces.get(executionId);
    if (timestamped) {
      timestamped.lastAccessedAt = Date.now();
      return timestamped.value;
    }
    return null;
  }

  // Workflow Persistence - Not supported in memory store
  async saveWorkflow(workflow: any, changeNotes?: string, createdBy?: string): Promise<number> {
    // Log warning but don't throw - allow in-memory operation
    logger.warn('InMemoryExecutionStore: Workflow not persisted (use DrizzleStore for persistence)');
    return 0; // Return dummy version ID
  }

  async getWorkflow(workflowId: string, version?: number): Promise<any | null> {
    // In-memory store doesn't persist workflows, return null to allow lazy loading from database
    return null;
  }

  async getWorkflowVersion(workflowId: string): Promise<number | null> {
    return null; // No version tracking in memory
  }

  async listWorkflows(activeOnly?: boolean, limit?: number, offset?: number): Promise<any[]> {
    return []; // No workflows stored in memory
  }

  async getWorkflowCount(activeOnly?: boolean): Promise<number> {
    return 0;
  }

  async listExecutions(workflowId?: string, limit: number = 100, offset: number = 0): Promise<Array<{
    executionId: string;
    workflowId: string;
    status: string;
    startedAt: Date;
    completedAt?: Date;
  }>> {
    let executions = Array.from(this.executions.values()).map(t => t.value);

    if (workflowId) {
      executions = executions.filter(e => e.workflowId === workflowId);
    }

    // Sort by startedAt descending
    executions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    // Apply pagination
    return executions.slice(offset, offset + limit).map(e => ({
      executionId: e.executionId,
      workflowId: e.workflowId,
      status: e.status,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
    }));
  }

  async getExecutionCount(workflowId?: string): Promise<number> {
    if (workflowId) {
      return Array.from(this.executions.values()).filter(t => t.value.workflowId === workflowId).length;
    }
    return this.executions.size;
  }

  async deactivateWorkflow(workflowId: string): Promise<void> {
    // No-op in memory store
  }
}