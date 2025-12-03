import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, inArray, sql, desc, isNotNull, lt } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type {
  ExecutionResult,
  ExecutionState,
  IExecutionStateStore,
  ExecutionLog,
  ExecutionTrace,
  ExecutionSpan
} from '../types';
import * as schema from './schema';

export class DrizzleExecutionStateStore implements IExecutionStateStore {
  private db: ReturnType<typeof drizzle>;
  private client: any; // postgres client type
  private redisCache?: Redis; // Optional cache
  private cacheTTL: number;
  private cacheEnabled: boolean;

  constructor(
    connectionString: string,
    redisCache?: Redis,
    cacheTTL: number = 3600,
    enableCache: boolean = true
  ) {
    this.client = postgres(connectionString);
    this.db = drizzle(this.client);
    this.redisCache = redisCache;
    this.cacheTTL = cacheTTL;
    // Only enable cache if Redis is provided and enableCache is true
    this.cacheEnabled = enableCache && !!redisCache;

    if (!this.cacheEnabled) {
      console.log('💡 Redis cache disabled - using database only');
    }
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
    // Use transactional version for atomicity
    return await this.createExecutionWithTransaction(workflowId, parentExecutionId, depth, initialData);
  }

  // Transactional execution creation (atomic with initial log)
  async createExecutionWithTransaction(
    workflowId: string,
    parentExecutionId?: string,
    depth: number = 0,
    initialData?: any
  ): Promise<string> {
    return await this.db.transaction(async (tx) => {
      const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Get current workflow version
      const versionId = await this.getWorkflowVersion(workflowId);

      // Insert execution
      await tx.insert(schema.executions).values({
        executionId,
        workflowId,
        workflowVersionId: versionId,
        status: 'running',
        startedAt: new Date(),
        parentExecutionId: parentExecutionId || null,
        depth,
        initialData: initialData || null,
        metadata: null,
        timeoutAt: null,
        timedOut: false,
      });

      // Initialize execution log (atomic with execution creation)
      await tx.insert(schema.logs).values({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        executionId,
        nodeId: null,
        level: 'info',
        message: `Workflow ${workflowId} execution started`,
        timestamp: new Date(),
        metadata: { depth, parentExecutionId },
      });

      return executionId;
    });
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
    // Write-through: Update database first (source of truth)
    await this.updateNodeResult(executionId, nodeId, result);

    // Then update cache for fast reads (if enabled)
    if (this.cacheEnabled && this.redisCache) {
      try {
        const cacheKey = `results:${executionId}`;
        await this.redisCache.hset(cacheKey, nodeId, JSON.stringify(result));
        await this.redisCache.expire(cacheKey, this.cacheTTL);
      } catch (cacheError) {
        // Cache failure should not fail the operation
        console.warn(`Cache update failed for ${executionId}:${nodeId}:`, cacheError);
      }
    }
  }

  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    if (nodeIds.length === 0) return {};

    const results: Record<string, ExecutionResult> = {};
    let cacheMissNodeIds: string[] = nodeIds; // Assume all are cache misses initially

    // 1. Try fetching from Redis cache first (if enabled)
    if (this.cacheEnabled && this.redisCache) {
      try {
        const cacheKey = `results:${executionId}`;
        const cachedResults = await this.redisCache.hmget(cacheKey, ...nodeIds);
        cacheMissNodeIds = []; // Reset cache misses

        for (let i = 0; i < nodeIds.length; i++) {
          const nodeId = nodeIds[i];
          const cachedResult = cachedResults[i];
          if (cachedResult && nodeId) {
            results[nodeId] = JSON.parse(cachedResult);
          } else if (nodeId) {
            cacheMissNodeIds.push(nodeId);
          }
        }
      } catch (cacheError) {
        console.warn(`Cache read failed for ${executionId}, falling back to database:`, cacheError);
        cacheMissNodeIds = nodeIds; // Fetch all from database on cache error
      }
    }

    // 2. For any cache misses (or if cache disabled), fetch from the database
    if (cacheMissNodeIds.length > 0) {
      const dbResults = await this.db
        .select()
        .from(schema.nodeResults)
        .where(and(
          eq(schema.nodeResults.executionId, executionId),
          inArray(schema.nodeResults.nodeId, cacheMissNodeIds)
        ));

      // 3. Populate the cache for next time (if enabled)
      if (this.cacheEnabled && this.redisCache && dbResults.length > 0) {
        try {
          const cacheKey = `results:${executionId}`;
          const pipeline = this.redisCache.pipeline();

          for (const result of dbResults) {
            const nodeResult = {
              success: result.success,
              data: result.data || undefined,
              error: result.error || undefined,
              nextNodes: result.nextNodes as string[] | undefined,
              skipped: result.skipped || false,
            };
            results[result.nodeId] = nodeResult;
            pipeline.hset(cacheKey, result.nodeId, JSON.stringify(nodeResult));
          }

          pipeline.expire(cacheKey, this.cacheTTL);
          await pipeline.exec();
        } catch (cacheError) {
          console.warn(`Cache population failed for ${executionId}:`, cacheError);
          // Continue - we have the data from database
        }
      } else {
        // Cache disabled - just add to results
        for (const result of dbResults) {
          results[result.nodeId] = {
            success: result.success,
            data: result.data || undefined,
            error: result.error || undefined,
            nextNodes: result.nextNodes as string[] | undefined,
            skipped: result.skipped || false,
          };
        }
      }
    }

    return results;
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.nodeResults)
      .where(eq(schema.nodeResults.executionId, executionId));

    const count = result[0]?.count ?? 0;
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

    // Invalidate cache to ensure consistency (if enabled)
    if (this.cacheEnabled && this.redisCache) {
      try {
        const cacheKey = `results:${executionId}`;
        await this.redisCache.hdel(cacheKey, nodeId);
      } catch (cacheError) {
        console.warn(`Cache invalidation failed for ${executionId}:${nodeId}:`, cacheError);
        // Continue - database is updated
      }
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

  // ============================================================================
  // WORKFLOW PERSISTENCE METHODS
  // ============================================================================

  async saveWorkflow(workflow: any, changeNotes?: string, createdBy?: string): Promise<number> {
    return await this.db.transaction(async (tx) => {
      // Upsert workflow
      const [workflowRecord] = await tx
        .insert(schema.workflows)
        .values({
          workflowId: workflow.id,
          name: workflow.name || workflow.id,
          description: workflow.description || null,
          isActive: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.workflows.workflowId,
          set: {
            name: workflow.name || workflow.id,
            description: workflow.description || null,
            updatedAt: new Date()
          },
        })
        .returning();

      // Get next version number
      const versions = await tx
        .select()
        .from(schema.workflowVersions)
        .where(eq(schema.workflowVersions.workflowId, workflow.id))
        .orderBy(desc(schema.workflowVersions.version))
        .limit(1);

      const nextVersion = (versions[0]?.version || 0) + 1;

      // Insert new version
      const [versionRecord] = await tx
        .insert(schema.workflowVersions)
        .values({
          workflowId: workflow.id,
          version: nextVersion,
          definition: workflow,
          createdBy: createdBy || null,
          changeNotes: changeNotes || null,
        })
        .returning();

      if (!versionRecord) {
        throw new Error(`Failed to create workflow version for ${workflow.id}`);
      }

      // Update current version pointer
      await tx
        .update(schema.workflows)
        .set({ currentVersionId: versionRecord.id })
        .where(eq(schema.workflows.workflowId, workflow.id));

      return versionRecord.id;
    });
  }

  async getWorkflow(workflowId: string, version?: number): Promise<any | null> {
    if (version !== undefined) {
      // Get specific version
      const [versionRecord] = await this.db
        .select()
        .from(schema.workflowVersions)
        .where(and(
          eq(schema.workflowVersions.workflowId, workflowId),
          eq(schema.workflowVersions.version, version)
        ))
        .limit(1);

      return versionRecord?.definition || null;
    }

    // Get current version
    const [workflowRecord] = await this.db
      .select()
      .from(schema.workflows)
      .where(eq(schema.workflows.workflowId, workflowId))
      .limit(1);

    if (!workflowRecord?.currentVersionId) return null;

    const [versionRecord] = await this.db
      .select()
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.id, workflowRecord.currentVersionId))
      .limit(1);

    return versionRecord?.definition || null;
  }

  async getWorkflowVersion(workflowId: string): Promise<number | null> {
    const [workflowRecord] = await this.db
      .select()
      .from(schema.workflows)
      .where(eq(schema.workflows.workflowId, workflowId))
      .limit(1);

    return workflowRecord?.currentVersionId || null;
  }

  async listWorkflows(activeOnly: boolean = true, limit: number = 100, offset: number = 0): Promise<any[]> {
    const conditions = activeOnly
      ? eq(schema.workflows.isActive, true)
      : undefined;

    // Fetch workflows with pagination
    const workflowRecords = await this.db
      .select()
      .from(schema.workflows)
      .where(conditions)
      .orderBy(desc(schema.workflows.updatedAt))
      .limit(limit)
      .offset(offset);

    if (workflowRecords.length === 0) return [];

    // Collect all version IDs to fetch in a single query (fixes N+1)
    const versionIds = workflowRecords
      .map(r => r.currentVersionId)
      .filter((id): id is number => id !== null);

    if (versionIds.length === 0) return [];

    // Batch fetch all versions in one query
    const versionRecords = await this.db
      .select()
      .from(schema.workflowVersions)
      .where(inArray(schema.workflowVersions.id, versionIds));

    // Create a map for quick lookup
    const versionMap = new Map(
      versionRecords.map(v => [v.id, v.definition])
    );

    // Build result array maintaining order
    const workflows: any[] = [];
    for (const record of workflowRecords) {
      if (record.currentVersionId) {
        const definition = versionMap.get(record.currentVersionId);
        if (definition) {
          workflows.push(definition);
        }
      }
    }

    return workflows;
  }

  /**
   * Get total count of workflows (for pagination)
   */
  async getWorkflowCount(activeOnly: boolean = true): Promise<number> {
    const conditions = activeOnly
      ? eq(schema.workflows.isActive, true)
      : undefined;

    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.workflows)
      .where(conditions);

    return result[0]?.count ?? 0;
  }

  async deactivateWorkflow(workflowId: string): Promise<void> {
    await this.db
      .update(schema.workflows)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.workflows.workflowId, workflowId));
  }

  // ============================================================================
  // TRANSACTION SUPPORT METHODS
  // ============================================================================

  /**
   * Handle permanent job failure atomically
   * Combines: DLQ entry + node result update + error log
   */
  async handlePermanentFailure(
    executionId: string,
    nodeId: string,
    jobData: any,
    errorMessage: string,
    attemptsMade: number
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const dlqId = `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const logId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // 1. Insert DLQ entry
      await tx.insert(schema.dlqItems).values({
        id: dlqId,
        executionId,
        nodeId,
        jobId: jobData.jobId || null,
        jobData: jobData,
        error: errorMessage,
        failedAt: new Date(),
        attemptsMade,
        retried: false,
        retriedAt: null,
      });

      // 2. Update node result
      await this.updateNodeResultInTransaction(tx, executionId, nodeId, {
        success: false,
        error: errorMessage,
      });

      // 3. Add error log
      await tx.insert(schema.logs).values({
        id: logId,
        executionId,
        nodeId,
        level: 'error',
        message: `Node permanently failed after ${attemptsMade} attempts: ${errorMessage}`,
        timestamp: new Date(),
        metadata: { dlqId, attemptsMade },
      });
    });
  }

  /**
   * Update node result and check workflow completion atomically
   * Returns completion status
   */
  async updateNodeResultWithCompletion(
    executionId: string,
    nodeId: string,
    result: ExecutionResult,
    totalNodes: number
  ): Promise<{ completed: boolean; status: 'completed' | 'failed' | 'running' }> {
    return await this.db.transaction(async (tx) => {
      // 1. Update node result
      await this.updateNodeResultInTransaction(tx, executionId, nodeId, result);

      // 2. Check completion
      const resultCount = await tx
        .select({ count: sql<number>`count(*)` })
        .from(schema.nodeResults)
        .where(eq(schema.nodeResults.executionId, executionId));

      const count = resultCount[0]?.count ?? 0;
      const pendingCount = totalNodes - count;

      if (pendingCount === 0) {
        // All nodes completed - check if any failed
        const failedNodes = await tx
          .select()
          .from(schema.nodeResults)
          .where(and(
            eq(schema.nodeResults.executionId, executionId),
            eq(schema.nodeResults.success, false),
            sql`${schema.nodeResults.skipped} IS NOT TRUE` // Exclude skipped nodes
          ))
          .limit(1);

        const status = failedNodes.length > 0 ? 'failed' : 'completed';

        // 3. Update execution status
        await tx
          .update(schema.executions)
          .set({ status, completedAt: new Date() })
          .where(eq(schema.executions.executionId, executionId));

        // 4. Add completion log
        await tx.insert(schema.logs).values({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          executionId,
          nodeId: null,
          level: status === 'completed' ? 'info' : 'error',
          message: `Workflow execution ${status}`,
          timestamp: new Date(),
          metadata: { totalNodes, failedNodes: failedNodes.length },
        });

        return { completed: true, status };
      }

      return { completed: false, status: 'running' };
    });
  }

  /**
   * Helper: Update node result within a transaction
   * Used by other transactional methods
   */
  private async updateNodeResultInTransaction(
    tx: any, // Drizzle transaction type
    executionId: string,
    nodeId: string,
    result: ExecutionResult
  ): Promise<void> {
    // Check if result already exists
    const [existing] = await tx
      .select()
      .from(schema.nodeResults)
      .where(and(
        eq(schema.nodeResults.executionId, executionId),
        eq(schema.nodeResults.nodeId, nodeId)
      ))
      .limit(1);

    if (existing) {
      // Update existing result
      await tx
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
      await tx.insert(schema.nodeResults).values({
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

  // ============================================================================
  // TIMEOUT MONITORING METHODS
  // ============================================================================

  /**
   * Find executions that have exceeded their timeout
   */
  async findTimedOutExecutions(): Promise<Array<{ executionId: string; workflowId: string }>> {
    const now = new Date();

    const timedOut = await this.db
      .select({
        executionId: schema.executions.executionId,
        workflowId: schema.executions.workflowId,
      })
      .from(schema.executions)
      .where(and(
        eq(schema.executions.status, 'running'),
        isNotNull(schema.executions.timeoutAt),
        lt(schema.executions.timeoutAt, now),
        eq(schema.executions.timedOut, false)
      ));

    return timedOut;
  }

  /**
   * Handle execution timeout (mark as failed and timed out)
   */
  async handleExecutionTimeout(executionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 1. Update execution status
      await tx
        .update(schema.executions)
        .set({
          status: 'failed',
          timedOut: true,
          completedAt: new Date(),
        })
        .where(eq(schema.executions.executionId, executionId));

      // 2. Add timeout log
      await tx.insert(schema.logs).values({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        executionId,
        nodeId: null,
        level: 'error',
        message: 'Execution timed out',
        timestamp: new Date(),
        metadata: { reason: 'timeout' },
      });
    });
  }

  /**
   * Set timeout for an execution
   */
  async setExecutionTimeout(executionId: string, timeoutAt: Date): Promise<void> {
    await this.db
      .update(schema.executions)
      .set({ timeoutAt })
      .where(eq(schema.executions.executionId, executionId));
  }

  /**
   * Clear timeout for an execution
   */
  async clearExecutionTimeout(executionId: string): Promise<void> {
    await this.db
      .update(schema.executions)
      .set({ timeoutAt: null, timedOut: false })
      .where(eq(schema.executions.executionId, executionId));
  }

  // ============================================================================
  // HEALTH MONITORING METHODS
  // ============================================================================

  /**
   * Find long-running executions (for health monitoring)
   */
  async findLongRunningExecutions(thresholdMs: number): Promise<Array<{ executionId: string; workflowId: string; startedAt: Date }>> {
    const threshold = new Date(Date.now() - thresholdMs);

    const longRunning = await this.db
      .select({
        executionId: schema.executions.executionId,
        workflowId: schema.executions.workflowId,
        startedAt: schema.executions.startedAt,
      })
      .from(schema.executions)
      .where(and(
        eq(schema.executions.status, 'running'),
        lt(schema.executions.startedAt, threshold)
      ));

    return longRunning;
  }

  /**
   * Health check - verify database connection
   */
  async healthCheck(): Promise<void> {
    // Simple query to verify database is responsive
    await this.db.select({ count: sql<number>`count(*)` }).from(schema.executions).limit(1);
  }

  // ============================================================================
  // EXECUTION LISTING METHODS
  // ============================================================================

  /**
   * List executions with optional workflow filter and pagination
   */
  async listExecutions(
    workflowId?: string, 
    limit: number = 100,
    offset: number = 0
  ): Promise<Array<{
    executionId: string;
    workflowId: string;
    status: string;
    startedAt: Date;
    completedAt?: Date;
    initialData?: any;
    metadata?: any;
  }>> {
    const conditions = workflowId 
      ? eq(schema.executions.workflowId, workflowId)
      : undefined;

    const executionRecords = await this.db
      .select({
        executionId: schema.executions.executionId,
        workflowId: schema.executions.workflowId,
        status: schema.executions.status,
        startedAt: schema.executions.startedAt,
        completedAt: schema.executions.completedAt,
        initialData: schema.executions.initialData,
        metadata: schema.executions.metadata,
      })
      .from(schema.executions)
      .where(conditions)
      .orderBy(desc(schema.executions.startedAt))
      .limit(limit)
      .offset(offset);

    return executionRecords.map(record => ({
      executionId: record.executionId,
      workflowId: record.workflowId,
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt || undefined,
      initialData: record.initialData || undefined,
      metadata: record.metadata || undefined,
    }));
  }

  /**
   * Get total count of executions (for pagination)
   */
  async getExecutionCount(workflowId?: string): Promise<number> {
    const conditions = workflowId 
      ? eq(schema.executions.workflowId, workflowId)
      : undefined;

    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.executions)
      .where(conditions);

    return result[0]?.count ?? 0;
  }

  /**
   * Get workflow versions for version history
   */
  async getWorkflowVersions(workflowId: string): Promise<Array<{
    versionId: number;
    version: number;
    createdAt: Date;
    changeNotes?: string;
    createdBy?: string;
  }>> {
    const versions = await this.db
      .select({
        versionId: schema.workflowVersions.id,
        version: schema.workflowVersions.version,
        createdAt: schema.workflowVersions.createdAt,
        changeNotes: schema.workflowVersions.changeNotes,
        createdBy: schema.workflowVersions.createdBy,
      })
      .from(schema.workflowVersions)
      .where(eq(schema.workflowVersions.workflowId, workflowId))
      .orderBy(desc(schema.workflowVersions.version));

    return versions.map(v => ({
      versionId: v.versionId,
      version: v.version,
      createdAt: v.createdAt,
      changeNotes: v.changeNotes || undefined,
      createdBy: v.createdBy || undefined,
    }));
  }
}

