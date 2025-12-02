import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { 
  ExecutionResult, 
  ExecutionState, 
  IExecutionStateStore, 
  ExecutionLog, 
  ExecutionTrace, 
  ExecutionSpan 
} from './types';
import * as schema from './schema-pg';

export class DrizzleExecutionStateStore implements IExecutionStateStore {
  private db: ReturnType<typeof drizzle>;
  private client: ReturnType<typeof postgres>;
  private redisCache: Redis;
  private cacheTTL: number;

  constructor(connectionString: string, redisCache: Redis, cacheTTL: number = 3600) {
    this.client = postgres(connectionString);
    this.db = drizzle(this.client);
    this.redisCache = redisCache;
    this.cacheTTL = cacheTTL;
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async createExecution(
    workflowId: string, 
    parentExecutionId?: string, 
    depth: number = 0, 
    initialData?: any
  ): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.db.insert(schema.executions).values({
      executionId,
      workflowId,
      status: 'running',
      startedAt: new Date(),
      parentExecutionId: parentExecutionId || null,
      depth,
      initialData: initialData || null,
      metadata: null,
    });

    return executionId;
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    const [execution] = await this.db
      .select()
      .from(schema.executions)
      .where(eq(schema.executions.executionId, executionId))
      .limit(1);

    if (!execution) return null;

    // Fetch all node results for this execution
    const results = await this.db
      .select()
      .from(schema.nodeResults)
      .where(eq(schema.nodeResults.executionId, executionId));

    const nodeResultsMap: Record<string, ExecutionResult> = {};
    for (const result of results) {
      nodeResultsMap[result.nodeId] = {
        success: result.success,
        data: result.data || undefined,
        error: result.error || undefined,
        nextNodes: result.nextNodes as string[] | undefined,
        skipped: result.skipped || false,
      };
    }

    return {
      executionId: execution.executionId,
      workflowId: execution.workflowId,
      status: execution.status as ExecutionState['status'],
      nodeResults: nodeResultsMap,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt || undefined,
      parentExecutionId: execution.parentExecutionId || undefined,
      depth: execution.depth,
      initialData: execution.initialData || undefined,
      metadata: execution.metadata as ExecutionState['metadata'] | undefined,
    };
  }
  async cacheNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    const cacheKey = `results:${executionId}`;
    await this.redisCache.hset(cacheKey, nodeId, JSON.stringify(result));
    await this.redisCache.expire(cacheKey, this.cacheTTL);
  }

  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    if (nodeIds.length === 0) return {};

    const cacheKey = `results:${executionId}`;
    const results: Record<string, ExecutionResult> = {};
    const cacheMissNodeIds: string[] = [];

    // 1. Try fetching from Redis cache first
    if (nodeIds.length > 0) {
      const cachedResults = await this.redisCache.hmget(cacheKey, ...nodeIds);
      for (let i = 0; i < nodeIds.length; i++) {
        const nodeId = nodeIds[i];
        const cachedResult = cachedResults[i];
        if (cachedResult) {
          results[nodeId] = JSON.parse(cachedResult);
        } else {
          cacheMissNodeIds.push(nodeId);
        }
      }
    }

    // 2. For any cache misses, fetch from the database
    if (cacheMissNodeIds.length > 0) {
      const dbResults = await this.db
        .select()
        .from(schema.nodeResults)
        .where(and(
          eq(schema.nodeResults.executionId, executionId),
          inArray(schema.nodeResults.nodeId, cacheMissNodeIds)
        ));

      const pipeline = this.redisCache.pipeline();
      let updatedCache = false;

      for (const result of dbResults) {
        const nodeResult = {
          success: result.success,
          data: result.data || undefined,
          error: result.error || undefined,
          nextNodes: result.nextNodes as string[] | undefined,
          skipped: result.skipped || false,
        };
        results[result.nodeId] = nodeResult;
        // 3. Populate the cache for next time
        pipeline.hset(cacheKey, result.nodeId, JSON.stringify(nodeResult));
        updatedCache = true;
      }

      if (updatedCache) {
        pipeline.expire(cacheKey, this.cacheTTL); // Reset TTL
        await pipeline.exec();
      }
    }

    return results;
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.nodeResults)
      .where(eq(schema.nodeResults.executionId, executionId));

    return totalNodes - count;
  }


  async updateNodeResult(
    executionId: string, 
    nodeId: string, 
    result: ExecutionResult
  ): Promise<void> {
    // Check if result already exists
    const [existing] = await this.db
      .select()
      .from(schema.nodeResults)
      .where(and(
        eq(schema.nodeResults.executionId, executionId),
        eq(schema.nodeResults.nodeId, nodeId)
      ))
      .limit(1);

    if (existing) {
      // Update existing result
      await this.db
        .update(schema.nodeResults)
        .set({
          success: result.success,
          data: result.data || null,
          error: result.error || null,
          nextNodes: result.nextNodes || null,
          skipped: result.skipped || false,
        })
        .where(and(
          eq(schema.nodeResults.executionId, executionId),
          eq(schema.nodeResults.nodeId, nodeId)
        ));
    } else {
      // Insert new result
      await this.db.insert(schema.nodeResults).values({
        executionId,
        nodeId,
        success: result.success,
        data: result.data || null,
        error: result.error || null,
        nextNodes: result.nextNodes || null,
        skipped: result.skipped || false,
      });
    }
  }

  async setExecutionStatus(
    executionId: string, 
    status: ExecutionState['status']
  ): Promise<void> {
    const updateData: any = { status };
    
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completedAt = new Date();
    }

    await this.db
      .update(schema.executions)
      .set(updateData)
      .where(eq(schema.executions.executionId, executionId));
  }

  async updateExecutionMetadata(
    executionId: string, 
    metadata: ExecutionState['metadata']
  ): Promise<void> {
    await this.db
      .update(schema.executions)
      .set({ metadata: metadata || null })
      .where(eq(schema.executions.executionId, executionId));
  }

  async getChildExecutions(executionId: string): Promise<ExecutionState[]> {
    // Fetch all child executions with their node results in batch to avoid N+1 queries
    const children = await this.db
      .select()
      .from(schema.executions)
      .where(eq(schema.executions.parentExecutionId, executionId));

    if (children.length === 0) return [];

    const childExecutionIds = children.map(c => c.executionId);

    // Fetch all node results for all children in one query
    const allResults = await this.db
      .select()
      .from(schema.nodeResults)
      .where(inArray(schema.nodeResults.executionId, childExecutionIds));

    // Group results by executionId
    const resultsByExecution: Record<string, typeof allResults> = {};
    for (const result of allResults) {
      const execId = result.executionId;
      if (!resultsByExecution[execId]) {
        resultsByExecution[execId] = [];
      }
      resultsByExecution[execId]!.push(result);
    }

    // Build execution states
    const childStates: ExecutionState[] = [];
    for (const child of children) {
      const results = resultsByExecution[child.executionId] || [];
      const nodeResultsMap: Record<string, ExecutionResult> = {};
      for (const result of results) {
        nodeResultsMap[result.nodeId] = {
          success: result.success,
          data: result.data || undefined,
          error: result.error || undefined,
          nextNodes: result.nextNodes as string[] | undefined,
          skipped: result.skipped || false,
        };
      }

      childStates.push({
        executionId: child.executionId,
        workflowId: child.workflowId,
        status: child.status as ExecutionState['status'],
        nodeResults: nodeResultsMap,
        startedAt: child.startedAt,
        completedAt: child.completedAt || undefined,
        parentExecutionId: child.parentExecutionId || undefined,
        depth: child.depth,
        initialData: child.initialData || undefined,
        metadata: child.metadata as ExecutionState['metadata'] | undefined,
      });
    }

    return childStates;
  }

  async getParentExecution(executionId: string): Promise<ExecutionState | null> {
    const [execution] = await this.db
      .select()
      .from(schema.executions)
      .where(eq(schema.executions.executionId, executionId))
      .limit(1);

    if (!execution || !execution.parentExecutionId) {
      return null;
    }

    return this.getExecution(execution.parentExecutionId);
  }

  // Observability
  async addLog(log: ExecutionLog): Promise<void> {
    await this.db.insert(schema.logs).values({
      id: log.id,
      executionId: log.executionId,
      nodeId: log.nodeId || null,
      level: log.level,
      message: log.message,
      timestamp: log.timestamp,
      metadata: log.metadata || null,
    });
  }

  async getLogs(executionId: string): Promise<ExecutionLog[]> {
    const logRecords = await this.db
      .select()
      .from(schema.logs)
      .where(eq(schema.logs.executionId, executionId));

    return logRecords.map(log => ({
      id: log.id,
      executionId: log.executionId,
      nodeId: log.nodeId || undefined,
      level: log.level as ExecutionLog['level'],
      message: log.message,
      timestamp: log.timestamp,
      metadata: log.metadata || undefined,
    }));
  }

  async addSpan(executionId: string, span: ExecutionSpan): Promise<void> {
    await this.db.insert(schema.spans).values({
      id: span.id,
      executionId,
      nodeId: span.nodeId,
      name: span.name,
      startTime: span.startTime,
      endTime: span.endTime || null,
      status: span.status,
      error: span.error || null,
      metadata: span.metadata || null,
    });
  }

  async updateSpan(
    executionId: string,
    spanId: string,
    update: Partial<ExecutionSpan>
  ): Promise<void> {
    const updateData: any = {};

    if (update.endTime !== undefined) updateData.endTime = update.endTime;
    if (update.status !== undefined) updateData.status = update.status;
    if (update.error !== undefined) updateData.error = update.error;
    if (update.metadata !== undefined) updateData.metadata = update.metadata;

    await this.db
      .update(schema.spans)
      .set(updateData)
      .where(and(
        eq(schema.spans.id, spanId),
        eq(schema.spans.executionId, executionId)
      ));
  }

  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    const [execution] = await this.db
      .select()
      .from(schema.executions)
      .where(eq(schema.executions.executionId, executionId))
      .limit(1);

    if (!execution) return null;

    const spanRecords = await this.db
      .select()
      .from(schema.spans)
      .where(eq(schema.spans.executionId, executionId));

    const spansList: ExecutionSpan[] = spanRecords.map(span => ({
      id: span.id,
      nodeId: span.nodeId,
      name: span.name,
      startTime: span.startTime,
      endTime: span.endTime || undefined,
      status: span.status as ExecutionSpan['status'],
      error: span.error || undefined,
      metadata: span.metadata || undefined,
    }));

    return {
      executionId: execution.executionId,
      workflowId: execution.workflowId,
      spans: spansList,
    };
  }
}
