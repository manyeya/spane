import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import Redis from "ioredis";
import type { ExecutionResult, ExecutionState, ExecutionLog, ExecutionSpan } from "../../types";

/**
 * Property-based tests for transparent routing.
 * 
 * **Feature: architecture-refactor, Property 8: Transparent routing**
 * **Validates: Requirements 5.1, 5.2**
 * 
 * These tests verify that:
 * - For any IExecutionStateStore method call, the caller SHALL NOT need to specify
 *   whether to use Redis or database - routing SHALL be automatic based on execution status
 * - When an execution transitions from active to completed, the system SHALL handle
 *   the Redis-to-database migration transparently
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{4,8}$/);

const executionResultArb: fc.Arbitrary<ExecutionResult> = fc.record({
  success: fc.boolean(),
  data: fc.option(fc.jsonValue(), { nil: undefined }),
  error: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  nextNodes: fc.option(fc.array(nodeIdArb, { minLength: 0, maxLength: 3 }), { nil: undefined }),
  skipped: fc.option(fc.boolean(), { nil: undefined }),
});

const terminalStatusArb: fc.Arbitrary<'completed' | 'failed' | 'cancelled'> = 
  fc.constantFrom('completed', 'failed', 'cancelled');

const nonTerminalStatusArb: fc.Arbitrary<'running' | 'paused'> = 
  fc.constantFrom('running', 'paused');

const anyStatusArb: fc.Arbitrary<ExecutionState['status']> = 
  fc.constantFrom('running', 'paused', 'completed', 'failed', 'cancelled');

// ============================================================================
// MOCK DATABASE STORE FOR TESTING
// ============================================================================

interface StoredExecution {
  executionId: string;
  workflowId: string;
  status: ExecutionState['status'];
  startedAt: Date;
  completedAt?: Date;
  nodeResults: Record<string, ExecutionResult>;
  logs: ExecutionLog[];
  spans: ExecutionSpan[];
  depth: number;
  parentExecutionId?: string;
  initialData?: any;
  metadata?: any;
}

class MockDatabaseStore {
  public executions: Map<string, StoredExecution> = new Map();

  async persistCompleteExecution(state: StoredExecution): Promise<void> {
    this.executions.set(state.executionId, state);
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    const stored = this.executions.get(executionId);
    if (!stored) return null;
    
    return {
      executionId: stored.executionId,
      workflowId: stored.workflowId,
      status: stored.status,
      nodeResults: stored.nodeResults,
      startedAt: stored.startedAt,
      completedAt: stored.completedAt,
      depth: stored.depth,
      parentExecutionId: stored.parentExecutionId,
      initialData: stored.initialData,
      metadata: stored.metadata,
    };
  }

  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    const stored = this.executions.get(executionId);
    if (!stored) return {};
    
    const results: Record<string, ExecutionResult> = {};
    for (const nodeId of nodeIds) {
      if (stored.nodeResults[nodeId]) {
        results[nodeId] = stored.nodeResults[nodeId];
      }
    }
    return results;
  }

  async getLogs(executionId: string): Promise<ExecutionLog[]> {
    const stored = this.executions.get(executionId);
    return stored?.logs || [];
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    const stored = this.executions.get(executionId);
    if (!stored) return totalNodes;
    return totalNodes - Object.keys(stored.nodeResults).length;
  }

  async updateExecutionMetadata(executionId: string, metadata: any): Promise<void> {
    const stored = this.executions.get(executionId);
    if (stored) {
      stored.metadata = metadata;
    }
  }

  reset() {
    this.executions.clear();
  }
}

// ============================================================================
// TEST HYBRID STORE FOR TRANSPARENT ROUTING
// ============================================================================

class TestHybridStoreForRouting {
  private redisTTL: number;

  constructor(
    private redis: Redis,
    private mockDb: MockDatabaseStore,
    options: { redisTTL?: number } = {}
  ) {
    this.redisTTL = options.redisTTL ?? 3600;
  }

  private execKey(executionId: string): string {
    return `test:route:exec:${executionId}`;
  }

  private resultsKey(executionId: string): string {
    return `test:route:exec:${executionId}:results`;
  }

  private logsKey(executionId: string): string {
    return `test:route:exec:${executionId}:logs`;
  }

  private spansKey(executionId: string): string {
    return `test:route:exec:${executionId}:spans`;
  }

  async isActiveExecution(executionId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.execKey(executionId));
    return exists === 1;
  }

  // ============================================================================
  // UNIFIED INTERFACE METHODS (transparent routing)
  // ============================================================================

  async createExecution(
    workflowId: string,
    parentExecutionId?: string,
    depth: number = 0,
    initialData?: any
  ): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const startedAt = new Date();

    const pipeline = this.redis.pipeline();
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
    pipeline.expire(this.execKey(executionId), this.redisTTL);
    pipeline.expire(this.resultsKey(executionId), this.redisTTL);
    pipeline.expire(this.logsKey(executionId), this.redisTTL);
    pipeline.expire(this.spansKey(executionId), this.redisTTL);

    await pipeline.exec();
    return executionId;
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    // Automatic routing based on execution status
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      return this.reconstructFromRedis(executionId);
    }

    return this.mockDb.getExecution(executionId);
  }

  private async reconstructFromRedis(executionId: string): Promise<ExecutionState | null> {
    const execData = await this.redis.hgetall(this.execKey(executionId));
    if (!execData || Object.keys(execData).length === 0) {
      return null;
    }

    const resultsData = await this.redis.hgetall(this.resultsKey(executionId));
    const nodeResults: Record<string, ExecutionResult> = {};
    for (const [nodeId, resultJson] of Object.entries(resultsData)) {
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
      metadata: execData.metadata && execData.metadata !== '' ? JSON.parse(execData.metadata) : undefined,
    };
  }

  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    if (nodeIds.length === 0) return {};

    // Automatic routing based on execution status
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      const results = await this.redis.hmget(this.resultsKey(executionId), ...nodeIds);
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

    return this.mockDb.getNodeResults(executionId, nodeIds);
  }

  async updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    // Always write to Redis for active executions
    await this.redis.hset(this.resultsKey(executionId), nodeId, JSON.stringify(result));
  }

  async cacheNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    // Delegate to updateNodeResult for consistency
    return this.updateNodeResult(executionId, nodeId, result);
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    // Automatic routing based on execution status
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      const completedCount = await this.redis.hlen(this.resultsKey(executionId));
      return totalNodes - completedCount;
    }

    return this.mockDb.getPendingNodeCount(executionId, totalNodes);
  }

  async updateExecutionMetadata(executionId: string, metadata: any): Promise<void> {
    // Automatic routing based on execution status
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      await this.redis.hset(this.execKey(executionId), 'metadata', JSON.stringify(metadata || {}));
    } else {
      await this.mockDb.updateExecutionMetadata(executionId, metadata);
    }
  }

  async addLog(log: ExecutionLog): Promise<void> {
    // Automatic routing based on execution status
    const isActive = await this.isActiveExecution(log.executionId);

    if (isActive) {
      await this.redis.rpush(this.logsKey(log.executionId), JSON.stringify(log));
    }
    // For completed executions, logs would go to database (not implemented in mock)
  }

  async getLogs(executionId: string): Promise<ExecutionLog[]> {
    // Automatic routing based on execution status
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      const logsData = await this.redis.lrange(this.logsKey(executionId), 0, -1);
      const logs: ExecutionLog[] = [];
      for (const logJson of logsData) {
        try {
          const log = JSON.parse(logJson);
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

    return this.mockDb.getLogs(executionId);
  }

  async setExecutionStatus(executionId: string, status: ExecutionState['status']): Promise<void> {
    const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';

    if (isTerminal) {
      // Transparent migration from Redis to database
      await this.persistToDatabase(executionId, status);
    } else {
      await this.redis.hset(this.execKey(executionId), 'status', status);
    }
  }

  private async persistToDatabase(executionId: string, status: ExecutionState['status']): Promise<void> {
    const state = await this.gatherRedisState(executionId, status);
    
    if (!state) {
      return;
    }

    await this.mockDb.persistCompleteExecution(state);
    await this.cleanupRedisKeys(executionId);
  }

  private async gatherRedisState(executionId: string, status: ExecutionState['status']): Promise<StoredExecution | null> {
    const execData = await this.redis.hgetall(this.execKey(executionId));
    if (!execData || Object.keys(execData).length === 0) {
      return null;
    }

    const resultsData = await this.redis.hgetall(this.resultsKey(executionId));
    const nodeResults: Record<string, ExecutionResult> = {};
    for (const [nodeId, resultJson] of Object.entries(resultsData)) {
      try {
        nodeResults[nodeId] = JSON.parse(resultJson);
      } catch {
        // Skip malformed results
      }
    }

    const logsData = await this.redis.lrange(this.logsKey(executionId), 0, -1);
    const logs: ExecutionLog[] = [];
    for (const logJson of logsData) {
      try {
        logs.push(JSON.parse(logJson));
      } catch {
        // Skip malformed logs
      }
    }

    const spansData = await this.redis.lrange(this.spansKey(executionId), 0, -1);
    const spans: ExecutionSpan[] = [];
    for (const spanJson of spansData) {
      try {
        spans.push(JSON.parse(spanJson));
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
      nodeResults,
      logs,
      spans,
      depth: execData.depth ? parseInt(execData.depth, 10) : 0,
      parentExecutionId: execData.parentExecutionId || undefined,
      initialData: execData.initialData ? JSON.parse(execData.initialData) : undefined,
      metadata: execData.metadata && execData.metadata !== '' ? JSON.parse(execData.metadata) : undefined,
    };
  }

  private async cleanupRedisKeys(executionId: string): Promise<void> {
    await this.redis.del(
      this.execKey(executionId),
      this.resultsKey(executionId),
      this.logsKey(executionId),
      this.spansKey(executionId)
    );
  }

  async cleanup(executionId: string): Promise<void> {
    await this.redis.del(
      this.execKey(executionId),
      this.resultsKey(executionId),
      this.logsKey(executionId),
      this.spansKey(executionId)
    );
  }
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Transparent routing property tests", () => {
  let redis: Redis;
  let mockDb: MockDatabaseStore;
  let store: TestHybridStoreForRouting;
  const createdExecutionIds: string[] = [];

  beforeEach(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    mockDb = new MockDatabaseStore();
    store = new TestHybridStoreForRouting(redis, mockDb);
  });

  afterEach(async () => {
    for (const execId of createdExecutionIds) {
      await store.cleanup(execId);
    }
    createdExecutionIds.length = 0;
    mockDb.reset();
    await redis.quit();
  });

  /**
   * **Feature: architecture-refactor, Property 8: Transparent routing**
   * 
   * *For any* IExecutionStateStore method call, the caller SHALL NOT need to specify
   * whether to use Redis or database - routing SHALL be automatic based on execution status.
   * 
   * **Validates: Requirements 5.1, 5.2**
   */
  describe("Property 8: Transparent routing", () => {
    
    test("same API works for both active and completed executions (Req 5.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 5 }),
          terminalStatusArb,
          async (workflowId, nodeResultPairs, terminalStatus) => {
            // Create execution (starts in Redis)
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add node results using the same API
            for (const [nodeId, result] of nodeResultPairs) {
              await store.updateNodeResult(executionId, nodeId, result);
            }

            // Property: getExecution works while active
            const activeExecution = await store.getExecution(executionId);
            expect(activeExecution).not.toBeNull();
            expect(activeExecution!.status).toBe('running');

            // Property: getNodeResults works while active
            const uniqueNodeIds = [...new Set(nodeResultPairs.map(([id]) => id))];
            const activeResults = await store.getNodeResults(executionId, uniqueNodeIds);
            expect(Object.keys(activeResults).length).toBe(uniqueNodeIds.length);

            // Transition to completed (migrates to database)
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: same getExecution API works after completion
            const completedExecution = await store.getExecution(executionId);
            expect(completedExecution).not.toBeNull();
            expect(completedExecution!.status).toBe(terminalStatus);
            expect(completedExecution!.workflowId).toBe(workflowId);

            // Property: same getNodeResults API works after completion
            const completedResults = await store.getNodeResults(executionId, uniqueNodeIds);
            expect(Object.keys(completedResults).length).toBe(uniqueNodeIds.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("caller does not need to specify storage backend (Req 5.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          nodeIdArb,
          executionResultArb,
          async (workflowId, nodeId, result) => {
            // Create execution
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Property: updateNodeResult works without specifying backend
            await store.updateNodeResult(executionId, nodeId, result);

            // Property: cacheNodeResult works without specifying backend
            await store.cacheNodeResult(executionId, nodeId, result);

            // Property: getNodeResults works without specifying backend
            const results = await store.getNodeResults(executionId, [nodeId]);
            expect(results[nodeId]).toBeDefined();

            // Property: getPendingNodeCount works without specifying backend
            const pending = await store.getPendingNodeCount(executionId, 5);
            expect(pending).toBe(4); // 5 total - 1 completed

            // Property: updateExecutionMetadata works without specifying backend
            await store.updateExecutionMetadata(executionId, { test: 'value' });
            const execution = await store.getExecution(executionId);
            expect(execution!.metadata).toEqual({ test: 'value' });
          }
        ),
        { numRuns: 50 }
      );
    });

    test("transparent migration from Redis to database on completion (Req 5.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 5 }),
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 3 }),
          terminalStatusArb,
          async (workflowId, nodeResultPairs, logMessages, terminalStatus) => {
            // Create execution
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add node results
            for (const [nodeId, result] of nodeResultPairs) {
              await store.updateNodeResult(executionId, nodeId, result);
            }

            // Add logs
            for (let i = 0; i < logMessages.length; i++) {
              await store.addLog({
                id: `log-${i}`,
                executionId,
                level: 'info',
                message: logMessages[i]!,
                timestamp: new Date(),
              });
            }

            // Property: execution is in Redis before completion
            const isActiveBefore = await store.isActiveExecution(executionId);
            expect(isActiveBefore).toBe(true);

            // Complete execution (triggers transparent migration)
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: execution is NOT in Redis after completion
            const isActiveAfter = await store.isActiveExecution(executionId);
            expect(isActiveAfter).toBe(false);

            // Property: execution is in database after completion
            expect(mockDb.executions.has(executionId)).toBe(true);

            // Property: all data was migrated
            const dbExecution = mockDb.executions.get(executionId)!;
            expect(dbExecution.status).toBe(terminalStatus);
            expect(dbExecution.workflowId).toBe(workflowId);
            
            const uniqueNodeIds = [...new Set(nodeResultPairs.map(([id]) => id))];
            expect(Object.keys(dbExecution.nodeResults).length).toBe(uniqueNodeIds.length);
            expect(dbExecution.logs.length).toBe(logMessages.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("non-terminal status changes stay in Redis (Req 5.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          nonTerminalStatusArb,
          async (workflowId, nonTerminalStatus) => {
            // Create execution
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Change to non-terminal status
            await store.setExecutionStatus(executionId, nonTerminalStatus);

            // Property: execution is still in Redis
            const isActive = await store.isActiveExecution(executionId);
            expect(isActive).toBe(true);

            // Property: execution is NOT in database
            expect(mockDb.executions.has(executionId)).toBe(false);

            // Property: status was updated in Redis
            const execution = await store.getExecution(executionId);
            expect(execution!.status).toBe(nonTerminalStatus);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("data consistency across storage transition (Req 5.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 5 }),
          terminalStatusArb,
          async (workflowId, nodeResultPairs, terminalStatus) => {
            // Create execution
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add node results
            for (const [nodeId, result] of nodeResultPairs) {
              await store.updateNodeResult(executionId, nodeId, result);
            }

            // Get data before transition
            const uniqueNodeIds = [...new Set(nodeResultPairs.map(([id]) => id))];
            const resultsBefore = await store.getNodeResults(executionId, uniqueNodeIds);

            // Transition to completed
            await store.setExecutionStatus(executionId, terminalStatus);

            // Get data after transition
            const resultsAfter = await store.getNodeResults(executionId, uniqueNodeIds);

            // Property: data is consistent across transition
            expect(Object.keys(resultsAfter).length).toBe(Object.keys(resultsBefore).length);
            
            for (const nodeId of uniqueNodeIds) {
              expect(resultsAfter[nodeId]).toBeDefined();
              expect(resultsAfter[nodeId]!.success).toBe(resultsBefore[nodeId]!.success);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
