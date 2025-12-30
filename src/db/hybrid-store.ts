import type { Redis } from 'ioredis';
import type {
  ExecutionResult,
  ExecutionState,
  IExecutionStateStore,
  ExecutionLog,
  ExecutionTrace,
  ExecutionSpan,
  WorkflowDefinition,
} from '../types';

import type { DrizzleExecutionStateStore } from './drizzle-store';

export interface HybridStoreOptions {
  redisTTL: number;        // TTL for active executions in seconds (default: 24h = 86400)
  persistRetries: number;  // Retry count for DB persistence (default: 3)
}

const DEFAULT_OPTIONS: HybridStoreOptions = {
  redisTTL: 86400,      // 24 hours
  persistRetries: 3,
};

/**
 * HybridExecutionStateStore implements a Redis-first strategy for active execution state
 * with database persistence on completion.
 * 
 * - Active executions (running/paused): stored in Redis for fast access
 * - Completed executions: persisted to database for durability and audit
 * - Automatic routing based on execution status
 * 
 * Requirements: 5.1 - Unified interface that handles both Redis and database operations
 */
export class HybridExecutionStateStore implements IExecutionStateStore {
  private options: HybridStoreOptions;

  constructor(
    private redis: Redis,
    private db: DrizzleExecutionStateStore,
    options: Partial<HybridStoreOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ============================================================================
  // REDIS KEY HELPERS
  // ============================================================================

  /** Redis key for execution metadata */
  private execKey(executionId: string): string {
    return `exec:${executionId}`;
  }

  /** Redis key for node results hash */
  private resultsKey(executionId: string): string {
    return `exec:${executionId}:results`;
  }

  /** Redis key for execution logs list */
  private logsKey(executionId: string): string {
    return `exec:${executionId}:logs`;
  }

  /** Redis key for execution spans list */
  private spansKey(executionId: string): string {
    return `exec:${executionId}:spans`;
  }


  // ============================================================================
  // EXECUTION LIFECYCLE METHODS
  // ============================================================================

  /**
   * Create a new execution and store initial state in Redis.
   * Requirements: 3.1 - Store initial state in Redis with configurable TTL
   */
  async createExecution(
    workflowId: string,
    parentExecutionId?: string,
    depth: number = 0,
    initialData?: any
  ): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startedAt = new Date();

    // Store in Redis (active execution)
    const pipeline = this.redis.pipeline();
    
    // Create execution metadata hash with TTL
    pipeline.hset(this.execKey(executionId), {
      executionId,
      workflowId,
      status: 'running',
      startedAt: startedAt.toISOString(),
      parentExecutionId: parentExecutionId || '',
      depth: depth.toString(),
      initialData: initialData ? JSON.stringify(initialData) : '',
      metadata: '',
    });
    pipeline.expire(this.execKey(executionId), this.options.redisTTL);
    
    // Initialize results hash with a placeholder and TTL
    // (hset creates the key, then expire sets TTL)
    pipeline.hset(this.resultsKey(executionId), '__init__', '1');
    pipeline.expire(this.resultsKey(executionId), this.options.redisTTL);
    
    // Initialize logs list with TTL (rpush creates the key)
    pipeline.rpush(this.logsKey(executionId), JSON.stringify({ type: 'init', timestamp: Date.now() }));
    pipeline.expire(this.logsKey(executionId), this.options.redisTTL);
    
    // Initialize spans list with TTL (rpush creates the key)
    pipeline.rpush(this.spansKey(executionId), JSON.stringify({ type: 'init', timestamp: Date.now() }));
    pipeline.expire(this.spansKey(executionId), this.options.redisTTL);

    await pipeline.exec();

    return executionId;
  }

  /**
   * Get execution with hybrid routing.
   * Requirements: 3.4 - Reconstruct state from Redis for active executions
   * Requirements: 5.1 - Automatic routing based on execution status
   */
  async getExecution(executionId: string): Promise<ExecutionState | null> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Reconstruct ExecutionState from Redis hashes
      return this.reconstructFromRedis(executionId);
    }

    // Historical - delegate to database
    return this.db.getExecution(executionId);
  }

  /** Reconstruct ExecutionState from Redis hashes */
  private async reconstructFromRedis(executionId: string): Promise<ExecutionState | null> {
    // Get execution metadata
    const execData = await this.redis.hgetall(this.execKey(executionId));
    if (!execData || Object.keys(execData).length === 0) {
      return null;
    }

    // Get all node results (filter out __init__ placeholder)
    const resultsData = await this.redis.hgetall(this.resultsKey(executionId));
    const nodeResults: Record<string, ExecutionResult> = {};
    for (const [nodeId, resultJson] of Object.entries(resultsData)) {
      if (nodeId === '__init__') continue; // Skip init placeholder
      try {
        nodeResults[nodeId] = JSON.parse(resultJson);
      } catch {
        // Skip malformed results
      }
    }

    return {
      executionId: execData.executionId || executionId,
      workflowId: execData.workflowId || '',
      status: (execData.status as ExecutionState['status']) || 'running',
      nodeResults,
      startedAt: execData.startedAt ? new Date(execData.startedAt) : new Date(),
      completedAt: execData.completedAt ? new Date(execData.completedAt) : undefined,
      parentExecutionId: execData.parentExecutionId || undefined,
      depth: execData.depth ? parseInt(execData.depth, 10) : 0,
      initialData: execData.initialData ? JSON.parse(execData.initialData) : undefined,
      metadata: execData.metadata ? JSON.parse(execData.metadata) : undefined,
    };
  }

  /**
   * Get node results with Redis-first read.
   * Requirements: 3.3 - Read from Redis without hitting the database for active executions
   * Requirements: 5.1 - Automatic routing based on execution status
   */
  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    if (nodeIds.length === 0) return {};

    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Read from Redis
      const results = await this.redis.hmget(this.resultsKey(executionId), ...nodeIds);
      return this.parseResults(nodeIds, results);
    }

    // Historical - delegate to database
    return this.db.getNodeResults(executionId, nodeIds);
  }

  /** Parse Redis hmget results into ExecutionResult map */
  private parseResults(nodeIds: string[], results: (string | null)[]): Record<string, ExecutionResult> {
    const parsed: Record<string, ExecutionResult> = {};
    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i];
      const result = results[i];
      if (result && nodeId) {
        try {
          parsed[nodeId] = JSON.parse(result);
        } catch {
          // Skip malformed results
        }
      }
    }
    return parsed;
  }

  /**
   * Get pending node count for an execution.
   * Requirements: 3.3 - Read from Redis without hitting the database for active executions
   */
  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Count results in Redis hash (subtract 1 for __init__ placeholder)
      const hashLen = await this.redis.hlen(this.resultsKey(executionId));
      const completedCount = Math.max(0, hashLen - 1); // Subtract __init__ placeholder
      return totalNodes - completedCount;
    }

    // Historical - delegate to database
    return this.db.getPendingNodeCount(executionId, totalNodes);
  }

  /**
   * Update node result with Redis-first write.
   * Requirements: 3.2 - Write to Redis first and return immediately
   */
  async updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    // Check if execution is still active (main key exists)
    // This prevents writing to Redis after the execution has been persisted and cleaned up
    const isActive = await this.isActiveExecution(executionId);
    if (!isActive) {
      // Execution already completed and cleaned up - write directly to database
      console.log(`[HybridStore] Execution ${executionId} not active, writing result to database`);
      await this.db.updateNodeResult(executionId, nodeId, result);
      return;
    }
    
    // Write to Redis hash immediately (hot path - fast)
    await this.redis.hset(this.resultsKey(executionId), nodeId, JSON.stringify(result));
    // Refresh TTL to prevent expiration during active execution
    await this.setExecutionTTL(executionId);
  }

  /**
   * Cache node result - delegates to updateNodeResult for consistency.
   * Requirements: 3.2 - Write to Redis first and return immediately
   */
  async cacheNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    // Delegate to updateNodeResult for consistency - both write to Redis
    return this.updateNodeResult(executionId, nodeId, result);
  }

  /**
   * Set execution status with completion detection.
   * For terminal statuses (completed, failed, cancelled), triggers persistence to database.
   * For non-terminal statuses, updates Redis only.
   * Requirements: 4.1, 5.2
   */
  async setExecutionStatus(executionId: string, status: ExecutionState['status']): Promise<void> {
    const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';

    if (isTerminal) {
      // Terminal state - persist to DB and cleanup Redis
      await this.persistToDatabase(executionId, status);
    } else {
      // Non-terminal state - update Redis only
      await this.updateRedisStatus(executionId, status);
    }
  }

  /**
   * Update execution status in Redis (for non-terminal statuses).
   */
  private async updateRedisStatus(executionId: string, status: ExecutionState['status']): Promise<void> {
    await this.redis.hset(this.execKey(executionId), 'status', status);
    // Refresh TTL to prevent expiration during active execution
    await this.setExecutionTTL(executionId);
  }

  /**
   * Persist execution state from Redis to database and cleanup Redis keys.
   * Requirements: 4.1, 4.2, 4.3, 4.4 - Persist full state in single transaction, then delete Redis keys
   */
  private async persistToDatabase(executionId: string, status: ExecutionState['status']): Promise<void> {
    console.log(`[HybridStore] Persisting execution ${executionId} with status ${status}`);
    
    // 1. Update Redis status FIRST so queries see the correct status during persistence
    await this.redis.hset(this.execKey(executionId), 'status', status);
    await this.redis.hset(this.execKey(executionId), 'completedAt', new Date().toISOString());
    
    // 2. Gather all state from Redis
    const state = await this.gatherRedisState(executionId, status);
    
    if (!state) {
      // Execution not found in Redis - might already be persisted or never existed
      console.warn(`[HybridStore] Execution ${executionId} not found in Redis during persistence`);
      return;
    }

    console.log(`[HybridStore] Gathered state for ${executionId}: ${Object.keys(state.nodeResults).length} node results, ${state.logs.length} logs`);

    // 3. Persist to DB in transaction (with retry logic)
    // If this throws after all retries, Redis state is preserved
    try {
      await this.persistWithRetry(state);
      console.log(`[HybridStore] Successfully persisted execution ${executionId} to database`);
    } catch (error) {
      // Persistence failed after all retries - Redis state is preserved
      console.error(`[HybridStore] Failed to persist execution ${executionId} to database:`, error);
      console.error(`[HybridStore] Redis state preserved for manual intervention`);
      return;
    }

    // 4. Cleanup Redis keys on success only
    await this.cleanupRedisKeys(executionId);
    console.log(`[HybridStore] Cleaned up Redis keys for execution ${executionId}`);
  }

  /**
   * Gather all execution state from Redis for persistence.
   */
  private async gatherRedisState(executionId: string, status: ExecutionState['status']): Promise<{
    executionId: string;
    workflowId: string;
    status: ExecutionState['status'];
    startedAt: Date;
    completedAt: Date;
    parentExecutionId?: string;
    depth: number;
    initialData?: any;
    metadata?: any;
    nodeResults: Record<string, ExecutionResult>;
    logs: ExecutionLog[];
    spans: ExecutionSpan[];
  } | null> {
    // Get execution metadata
    const execData = await this.redis.hgetall(this.execKey(executionId));
    if (!execData || Object.keys(execData).length === 0) {
      return null;
    }

    // Get all node results (filter out __init__ placeholder)
    const resultsData = await this.redis.hgetall(this.resultsKey(executionId));
    const nodeResults: Record<string, ExecutionResult> = {};
    for (const [nodeId, resultJson] of Object.entries(resultsData)) {
      if (nodeId === '__init__') continue; // Skip init placeholder
      try {
        nodeResults[nodeId] = JSON.parse(resultJson);
      } catch {
        // Skip malformed results
      }
    }

    // Get all logs (filter out init placeholder)
    const logsData = await this.redis.lrange(this.logsKey(executionId), 0, -1);
    const logs: ExecutionLog[] = [];
    for (const logJson of logsData) {
      try {
        const log = JSON.parse(logJson);
        if (log.type === 'init') continue; // Skip init placeholder
        // Ensure timestamp is a Date object
        if (log.timestamp && typeof log.timestamp === 'string') {
          log.timestamp = new Date(log.timestamp);
        } else if (log.timestamp && typeof log.timestamp === 'number') {
          log.timestamp = new Date(log.timestamp);
        }
        logs.push(log);
      } catch {
        // Skip malformed logs
      }
    }

    // Get all spans (filter out init placeholder)
    const spansData = await this.redis.lrange(this.spansKey(executionId), 0, -1);
    const spans: ExecutionSpan[] = [];
    for (const spanJson of spansData) {
      try {
        const span = JSON.parse(spanJson);
        if (span.type === 'init') continue; // Skip init placeholder
        spans.push(span);
      } catch {
        // Skip malformed spans
      }
    }

    return {
      executionId: execData.executionId || executionId,
      workflowId: execData.workflowId || '',
      status,
      startedAt: execData.startedAt ? new Date(execData.startedAt) : new Date(),
      completedAt: new Date(),
      parentExecutionId: execData.parentExecutionId || undefined,
      depth: execData.depth ? parseInt(execData.depth, 10) : 0,
      initialData: execData.initialData ? JSON.parse(execData.initialData) : undefined,
      metadata: execData.metadata ? JSON.parse(execData.metadata) : undefined,
      nodeResults,
      logs,
      spans,
    };
  }

  /**
   * Delete all Redis keys for an execution after successful persistence.
   * Requirements: 4.3 - Remove execution state from Redis after persistence
   */
  private async cleanupRedisKeys(executionId: string): Promise<void> {
    const keysToDelete = [
      this.execKey(executionId),
      this.resultsKey(executionId),
      this.logsKey(executionId),
      this.spansKey(executionId)
    ];
    console.log(`[HybridStore] Deleting Redis keys:`, keysToDelete);
    const deleted = await this.redis.del(...keysToDelete);
    console.log(`[HybridStore] Deleted ${deleted} Redis keys`);
  }

  /**
   * Persist execution state to database with exponential backoff retry.
   * Requirements: 4.4 - Retry with exponential backoff, keep Redis state on failure
   */
  private async persistWithRetry(state: {
    executionId: string;
    workflowId: string;
    status: ExecutionState['status'];
    startedAt: Date;
    completedAt: Date;
    parentExecutionId?: string;
    depth: number;
    initialData?: any;
    metadata?: any;
    nodeResults: Record<string, ExecutionResult>;
    logs: ExecutionLog[];
    spans: ExecutionSpan[];
  }): Promise<void> {
    const delays = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.persistRetries; attempt++) {
      try {
        await this.db.persistCompleteExecution(state);
        return; // Success - exit retry loop
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.options.persistRetries) {
          const delay = delays[attempt] ?? delays[delays.length - 1] ?? 1000;
          console.warn(
            `Database persistence failed for execution ${state.executionId}, ` +
            `attempt ${attempt + 1}/${this.options.persistRetries + 1}, ` +
            `retrying in ${delay}ms:`,
            error
          );
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted - log error and keep Redis state
    console.error(
      `Database persistence failed for execution ${state.executionId} ` +
      `after ${this.options.persistRetries + 1} attempts. ` +
      `Redis state preserved for manual intervention.`,
      lastError
    );
    
    // Re-throw to signal failure (caller should not cleanup Redis)
    throw lastError;
  }

  /**
   * Sleep helper for retry delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update execution metadata.
   * Requirements: 3.2 - Write to Redis first for active executions
   */
  async updateExecutionMetadata(executionId: string, metadata: ExecutionState['metadata']): Promise<void> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Update metadata field in Redis hash
      await this.redis.hset(this.execKey(executionId), 'metadata', JSON.stringify(metadata || {}));
      // Refresh TTL to prevent expiration during active execution
      await this.setExecutionTTL(executionId);
    } else {
      // Historical - delegate to database
      await this.db.updateExecutionMetadata(executionId, metadata);
    }
  }

  async getChildExecutions(executionId: string): Promise<ExecutionState[]> {
    // Delegate to database - child executions are tracked there
    return this.db.getChildExecutions(executionId);
  }

  async getParentExecution(executionId: string): Promise<ExecutionState | null> {
    // Delegate to database - parent relationships are tracked there
    return this.db.getParentExecution(executionId);
  }

  // ============================================================================
  // WORKFLOW PERSISTENCE METHODS (passthrough to database)
  // ============================================================================

  async saveWorkflow(workflow: WorkflowDefinition, changeNotes?: string, createdBy?: string): Promise<number> {
    return this.db.saveWorkflow(workflow, changeNotes, createdBy);
  }

  async getWorkflow(workflowId: string, version?: number): Promise<WorkflowDefinition | null> {
    return this.db.getWorkflow(workflowId, version);
  }

  async getWorkflowVersion(workflowId: string): Promise<number | null> {
    return this.db.getWorkflowVersion(workflowId);
  }

  async listWorkflows(activeOnly?: boolean, limit?: number, offset?: number): Promise<WorkflowDefinition[]> {
    return this.db.listWorkflows(activeOnly, limit, offset);
  }

  async deactivateWorkflow(workflowId: string): Promise<void> {
    return this.db.deactivateWorkflow(workflowId);
  }

  async listExecutions(workflowId?: string, limit: number = 100, offset: number = 0): Promise<Array<{
    executionId: string;
    workflowId: string;
    status: string;
    startedAt: Date;
    completedAt?: Date;
  }>> {
    // Get active executions from Redis first
    const activeExecutions = await this.getActiveExecutionsFromRedis(workflowId);
    
    // Get historical executions from database
    const dbExecutions = await this.db.listExecutions(workflowId, limit, offset);
    
    // Merge: active executions first (most recent), then historical
    // Filter out any DB executions that are also in Redis (shouldn't happen but be safe)
    const activeIds = new Set(activeExecutions.map(e => e.executionId));
    const filteredDbExecutions = dbExecutions.filter(e => !activeIds.has(e.executionId));
    
    // Combine and sort by startedAt descending
    const allExecutions = [...activeExecutions, ...filteredDbExecutions]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    
    // Apply pagination to combined results
    return allExecutions.slice(offset, offset + limit);
  }

  /**
   * Get all active executions from Redis.
   * Scans Redis for execution keys and reconstructs summary data.
   */
  private async getActiveExecutionsFromRedis(workflowId?: string): Promise<Array<{
    executionId: string;
    workflowId: string;
    status: string;
    startedAt: Date;
    completedAt?: Date;
  }>> {
    const executions: Array<{
      executionId: string;
      workflowId: string;
      status: string;
      startedAt: Date;
      completedAt?: Date;
    }> = [];

    try {
      // Scan for all execution keys
      const executionIds = await this.scanExecutionKeys();
      
      // Get metadata for each execution
      for (const executionId of executionIds) {
        const execData = await this.redis.hgetall(this.execKey(executionId));
        if (execData && Object.keys(execData).length > 0) {
          // Filter by workflowId if specified
          if (workflowId && execData.workflowId !== workflowId) {
            continue;
          }
          
          executions.push({
            executionId: execData.executionId || executionId,
            workflowId: execData.workflowId || '',
            status: execData.status || 'running',
            startedAt: execData.startedAt ? new Date(execData.startedAt) : new Date(),
            completedAt: execData.completedAt ? new Date(execData.completedAt) : undefined,
          });
        }
      }
    } catch (error) {
      console.warn('Failed to get active executions from Redis:', error);
      // Return empty array on error - fall back to DB only
    }

    return executions;
  }

  async getWorkflowCount(activeOnly?: boolean): Promise<number> {
    return this.db.getWorkflowCount(activeOnly);
  }

  async getExecutionCount(workflowId?: string): Promise<number> {
    // Count active executions in Redis
    const activeExecutions = await this.getActiveExecutionsFromRedis(workflowId);
    const activeCount = activeExecutions.length;
    
    // Count historical executions in database
    const dbCount = await this.db.getExecutionCount(workflowId);
    
    return activeCount + dbCount;
  }

  // ============================================================================
  // OBSERVABILITY METHODS
  // ============================================================================

  /**
   * Add a log entry.
   * Requirements: 5.1 - Store logs in Redis list during active execution
   */
  async addLog(log: ExecutionLog): Promise<void> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(log.executionId);

    if (isActive) {
      // Store in Redis list during active execution
      await this.redis.rpush(this.logsKey(log.executionId), JSON.stringify(log));
      // Refresh TTL to prevent expiration during active execution
      await this.setExecutionTTL(log.executionId);
    } else {
      // Delegate to database for completed executions
      await this.db.addLog(log);
    }
  }

  /**
   * Get logs for an execution.
   * Requirements: 5.1 - Automatic routing based on execution status
   */
  async getLogs(executionId: string): Promise<ExecutionLog[]> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Read from Redis list (filter out init placeholder)
      const logsData = await this.redis.lrange(this.logsKey(executionId), 0, -1);
      const logs: ExecutionLog[] = [];
      for (const logJson of logsData) {
        try {
          const log = JSON.parse(logJson);
          if (log.type === 'init') continue; // Skip init placeholder
          // Ensure timestamp is a Date object
          if (log.timestamp && typeof log.timestamp === 'string') {
            log.timestamp = new Date(log.timestamp);
          }
          logs.push(log);
        } catch {
          // Skip malformed logs
        }
      }
      return logs;
    }

    // Delegate to database for completed executions
    return this.db.getLogs(executionId);
  }

  /**
   * Add a span for tracing.
   * Requirements: 5.1 - Store spans in Redis during active execution
   */
  async addSpan(executionId: string, span: ExecutionSpan): Promise<void> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Store in Redis list during active execution
      await this.redis.rpush(this.spansKey(executionId), JSON.stringify(span));
      // Refresh TTL to prevent expiration during active execution
      await this.setExecutionTTL(executionId);
    } else {
      // Delegate to database for completed executions
      await this.db.addSpan(executionId, span);
    }
  }

  /**
   * Update a span.
   * Requirements: 5.1 - Handle spans in Redis during active execution
   */
  async updateSpan(executionId: string, spanId: string, update: Partial<ExecutionSpan>): Promise<void> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // For Redis, we need to find and update the span in the list
      // This is less efficient but maintains consistency
      const spansData = await this.redis.lrange(this.spansKey(executionId), 0, -1);
      const spans: ExecutionSpan[] = [];
      let updated = false;

      for (const spanJson of spansData) {
        try {
          const span = JSON.parse(spanJson);
          if (span.id === spanId) {
            // Apply update
            Object.assign(span, update);
            updated = true;
          }
          spans.push(span);
        } catch {
          // Skip malformed spans
        }
      }

      if (updated) {
        // Replace the entire list with updated spans
        const pipeline = this.redis.pipeline();
        pipeline.del(this.spansKey(executionId));
        for (const span of spans) {
          pipeline.rpush(this.spansKey(executionId), JSON.stringify(span));
        }
        pipeline.expire(this.spansKey(executionId), this.options.redisTTL);
        await pipeline.exec();
      }
    } else {
      // Delegate to database for completed executions
      await this.db.updateSpan(executionId, spanId, update);
    }
  }

  /**
   * Get execution trace.
   * Requirements: 5.1 - Automatic routing based on execution status
   */
  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Reconstruct trace from Redis
      const execData = await this.redis.hgetall(this.execKey(executionId));
      if (!execData || Object.keys(execData).length === 0) {
        return null;
      }

      // Filter out init placeholder from spans
      const spansData = await this.redis.lrange(this.spansKey(executionId), 0, -1);
      const spans: ExecutionSpan[] = [];
      for (const spanJson of spansData) {
        try {
          const span = JSON.parse(spanJson);
          if (span.type === 'init') continue; // Skip init placeholder
          spans.push(span);
        } catch {
          // Skip malformed spans
        }
      }

      return {
        executionId,
        workflowId: execData.workflowId || '',
        spans,
      };
    }

    // Delegate to database for completed executions
    return this.db.getTrace(executionId);
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /** Check if execution exists in Redis (active execution) */
  private async isActiveExecution(executionId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.execKey(executionId));
    return exists === 1;
  }

  /** Set TTL on all Redis keys for an execution */
  private async setExecutionTTL(executionId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.expire(this.execKey(executionId), this.options.redisTTL);
    pipeline.expire(this.resultsKey(executionId), this.options.redisTTL);
    pipeline.expire(this.logsKey(executionId), this.options.redisTTL);
    pipeline.expire(this.spansKey(executionId), this.options.redisTTL);
    await pipeline.exec();
  }

  // ============================================================================
  // STARTUP RECOVERY METHODS
  // ============================================================================

  /**
   * Recover orphaned Redis executions on startup.
   * Scans for executions with expiring TTL and attempts to persist them to database.
   * Requirements: 4.4 - Recovery for orphaned executions
   * @param ttlThresholdSeconds - Persist executions with TTL below this threshold (default: 3600 = 1 hour)
   * @returns Recovery results with counts and any failures
   */
  async recoverOrphanedExecutions(ttlThresholdSeconds: number = 3600): Promise<{
    scanned: number;
    recovered: number;
    failed: number;
    failures: Array<{ executionId: string; error: string }>;
  }> {
    const results = {
      scanned: 0,
      recovered: 0,
      failed: 0,
      failures: [] as Array<{ executionId: string; error: string }>,
    };

    try {
      // Scan for all execution keys in Redis
      const executionIds = await this.scanExecutionKeys();
      results.scanned = executionIds.length;

      for (const executionId of executionIds) {
        try {
          // Check TTL of the execution key
          const ttl = await this.redis.ttl(this.execKey(executionId));
          
          // Skip if TTL is -1 (no expiry) or -2 (key doesn't exist)
          if (ttl < 0) continue;
          
          // Check if TTL is below threshold (approaching expiration)
          if (ttl <= ttlThresholdSeconds) {
            console.log(`🔄 Recovering orphaned execution ${executionId} (TTL: ${ttl}s)`);
            
            // Get the current status from Redis
            const status = await this.redis.hget(this.execKey(executionId), 'status');
            
            // Only recover executions that are in a terminal state or have been running too long
            // For running executions with low TTL, we should persist them as 'failed' (orphaned)
            const finalStatus = (status === 'completed' || status === 'failed' || status === 'cancelled')
              ? status as 'completed' | 'failed' | 'cancelled'
              : 'failed'; // Mark orphaned running executions as failed
            
            // Attempt to persist to database
            await this.persistToDatabase(executionId, finalStatus);
            results.recovered++;
            
            console.log(`✅ Recovered execution ${executionId} with status '${finalStatus}'`);
          }
        } catch (error) {
          results.failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.failures.push({ executionId, error: errorMessage });
          console.warn(`⚠️ Failed to recover execution ${executionId}: ${errorMessage}`);
        }
      }
    } catch (error) {
      console.error('❌ Error during orphaned execution recovery:', error);
    }

    if (results.scanned > 0) {
      console.log(
        `📊 Orphaned execution recovery complete: ` +
        `${results.scanned} scanned, ${results.recovered} recovered, ${results.failed} failed`
      );
    }

    return results;
  }

  /**
   * Scan Redis for all execution keys.
   * Uses SCAN to avoid blocking Redis with large keyspaces.
   */
  private async scanExecutionKeys(): Promise<string[]> {
    const executionIds: string[] = [];
    let cursor = '0';
    
    do {
      // Use SCAN with pattern matching to find execution keys
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'exec:*',
        'COUNT',
        100
      );
      cursor = nextCursor;
      
      // Extract execution IDs from keys (format: exec:{executionId})
      for (const key of keys) {
        // Only process main execution keys, not results/logs/spans
        if (key.match(/^exec:[^:]+$/) && !key.includes(':results') && !key.includes(':logs') && !key.includes(':spans')) {
          const executionId = key.replace('exec:', '');
          executionIds.push(executionId);
        }
      }
    } while (cursor !== '0');
    
    return executionIds;
  }

  // ============================================================================
  // HEALTH CHECK METHODS
  // ============================================================================

  /**
   * Perform health check on both Redis and database backends.
   * Requirements: 5.4 - Report 'degraded' if either is unhealthy
   * @returns Health status with details for each backend
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    redis: { healthy: boolean; message?: string };
    database: { healthy: boolean; message?: string };
  }> {
    const redisHealth = await this.checkRedisHealth();
    const dbHealth = await this.checkDatabaseHealth();

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (redisHealth.healthy && dbHealth.healthy) {
      status = 'healthy';
    } else if (!redisHealth.healthy && !dbHealth.healthy) {
      status = 'unhealthy';
    } else {
      status = 'degraded';
    }

    return {
      status,
      redis: redisHealth,
      database: dbHealth,
    };
  }

  /**
   * Check Redis connection health.
   */
  private async checkRedisHealth(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.redis.ping();
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Redis connection failed',
      };
    }
  }

  /**
   * Check database connection health.
   */
  private async checkDatabaseHealth(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.db.healthCheck();
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Database connection failed',
      };
    }
  }
}
