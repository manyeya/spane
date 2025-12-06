import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import Redis from "ioredis";
import type { ExecutionResult, ExecutionState, ExecutionLog, ExecutionSpan, ExecutionTrace } from "../../types";

/**
 * Property-based tests for historical queries using database.
 * 
 * **Feature: architecture-refactor, Property 7: Historical queries use database**
 * **Validates: Requirements 4.5, 5.1**
 * 
 * These tests verify that:
 * - For any execution not present in Redis (completed executions),
 *   getExecution() and getNodeResults() SHALL read from the database only
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
  public getExecutionCallCount = 0;
  public getNodeResultsCallCount = 0;
  public getLogsCallCount = 0;
  public getTraceCallCount = 0;

  async persistCompleteExecution(state: StoredExecution): Promise<void> {
    this.executions.set(state.executionId, state);
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    this.getExecutionCallCount++;
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
    this.getNodeResultsCallCount++;
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
    this.getLogsCallCount++;
    const stored = this.executions.get(executionId);
    return stored?.logs || [];
  }

  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    this.getTraceCallCount++;
    const stored = this.executions.get(executionId);
    if (!stored) return null;
    
    return {
      executionId: stored.executionId,
      workflowId: stored.workflowId,
      spans: stored.spans,
    };
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    const stored = this.executions.get(executionId);
    if (!stored) return totalNodes;
    return totalNodes - Object.keys(stored.nodeResults).length;
  }

  reset() {
    this.executions.clear();
    this.getExecutionCallCount = 0;
    this.getNodeResultsCallCount = 0;
    this.getLogsCallCount = 0;
    this.getTraceCallCount = 0;
  }
}

// ============================================================================
// TEST HYBRID STORE FOR HISTORICAL QUERIES
// ============================================================================

class TestHybridStoreForHistorical {
  private redisTTL: number;

  constructor(
    private redis: Redis,
    private mockDb: MockDatabaseStore,
    options: { redisTTL?: number } = {}
  ) {
    this.redisTTL = options.redisTTL ?? 3600;
  }

  private execKey(executionId: string): string {
    return `test:hist:exec:${executionId}`;
  }

  private resultsKey(executionId: string): string {
    return `test:hist:exec:${executionId}:results`;
  }

  private logsKey(executionId: string): string {
    return `test:hist:exec:${executionId}:logs`;
  }

  private spansKey(executionId: string): string {
    return `test:hist:exec:${executionId}:spans`;
  }

  async isActiveExecution(executionId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.execKey(executionId));
    return exists === 1;
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Reconstruct from Redis
      return this.reconstructFromRedis(executionId);
    }

    // Historical - delegate to database
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

    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Read from Redis
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

    // Historical - delegate to database
    return this.mockDb.getNodeResults(executionId, nodeIds);
  }

  async getLogs(executionId: string): Promise<ExecutionLog[]> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Read from Redis list
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

    // Delegate to database for completed executions
    return this.mockDb.getLogs(executionId);
  }

  async getTrace(executionId: string): Promise<ExecutionTrace | null> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Reconstruct trace from Redis
      const execData = await this.redis.hgetall(this.execKey(executionId));
      if (!execData || Object.keys(execData).length === 0) {
        return null;
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
        executionId,
        workflowId: execData.workflowId || '',
        spans,
      };
    }

    // Delegate to database for completed executions
    return this.mockDb.getTrace(executionId);
  }

  async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    // Check if execution is active (in Redis)
    const isActive = await this.isActiveExecution(executionId);

    if (isActive) {
      // Count results in Redis hash
      const completedCount = await this.redis.hlen(this.resultsKey(executionId));
      return totalNodes - completedCount;
    }

    // Historical - delegate to database
    return this.mockDb.getPendingNodeCount(executionId, totalNodes);
  }

  // Helper to create an execution directly in the database (simulating completed execution)
  async createCompletedExecutionInDb(
    workflowId: string,
    status: 'completed' | 'failed' | 'cancelled',
    nodeResults: Record<string, ExecutionResult>,
    logs: ExecutionLog[] = [],
    spans: ExecutionSpan[] = []
  ): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    await this.mockDb.persistCompleteExecution({
      executionId,
      workflowId,
      status,
      startedAt: new Date(Date.now() - 10000),
      completedAt: new Date(),
      nodeResults,
      logs,
      spans,
      depth: 0,
    });
    
    return executionId;
  }

  // Helper to create an active execution in Redis
  async createActiveExecutionInRedis(workflowId: string): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const startedAt = new Date();

    const pipeline = this.redis.pipeline();
    pipeline.hset(this.execKey(executionId), {
      executionId,
      workflowId,
      status: 'running',
      startedAt: startedAt.toISOString(),
      parentExecutionId: '',
      depth: '0',
      initialData: '',
      metadata: '',
    });
    pipeline.expire(this.execKey(executionId), this.redisTTL);
    pipeline.expire(this.resultsKey(executionId), this.redisTTL);
    pipeline.expire(this.logsKey(executionId), this.redisTTL);
    pipeline.expire(this.spansKey(executionId), this.redisTTL);

    await pipeline.exec();
    return executionId;
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

describe("Historical queries use database property tests", () => {
  let redis: Redis;
  let mockDb: MockDatabaseStore;
  let store: TestHybridStoreForHistorical;
  const createdExecutionIds: string[] = [];

  beforeEach(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    mockDb = new MockDatabaseStore();
    store = new TestHybridStoreForHistorical(redis, mockDb);
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
   * **Feature: architecture-refactor, Property 7: Historical queries use database**
   * 
   * *For any* execution not present in Redis (completed executions),
   * getExecution() and getNodeResults() SHALL read from the database only.
   * 
   * **Validates: Requirements 4.5, 5.1**
   */
  describe("Property 7: Historical queries use database", () => {
    
    test("getExecution() reads from database for completed executions (Req 4.5)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          terminalStatusArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 0, maxLength: 5 }),
          async (workflowId, status, nodeResultPairs) => {
            // Create node results map
            const nodeResults: Record<string, ExecutionResult> = {};
            for (const [nodeId, result] of nodeResultPairs) {
              nodeResults[nodeId] = result;
            }

            // Create completed execution directly in database (not in Redis)
            const executionId = await store.createCompletedExecutionInDb(
              workflowId,
              status,
              nodeResults
            );
            createdExecutionIds.push(executionId);

            // Reset call counts
            mockDb.getExecutionCallCount = 0;

            // Property: execution should NOT be in Redis
            const isActive = await store.isActiveExecution(executionId);
            expect(isActive).toBe(false);

            // Property: getExecution should delegate to database
            const execution = await store.getExecution(executionId);
            expect(execution).not.toBeNull();
            expect(execution!.executionId).toBe(executionId);
            expect(execution!.workflowId).toBe(workflowId);
            expect(execution!.status).toBe(status);

            // Property: database was called
            expect(mockDb.getExecutionCallCount).toBe(1);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("getNodeResults() reads from database for completed executions (Req 4.5)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          terminalStatusArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 5 }),
          async (workflowId, status, nodeResultPairs) => {
            // Create node results map
            const nodeResults: Record<string, ExecutionResult> = {};
            const nodeIds: string[] = [];
            for (const [nodeId, result] of nodeResultPairs) {
              nodeResults[nodeId] = result;
              nodeIds.push(nodeId);
            }

            // Create completed execution directly in database
            const executionId = await store.createCompletedExecutionInDb(
              workflowId,
              status,
              nodeResults
            );
            createdExecutionIds.push(executionId);

            // Reset call counts
            mockDb.getNodeResultsCallCount = 0;

            // Property: getNodeResults should delegate to database
            const uniqueNodeIds = [...new Set(nodeIds)];
            const results = await store.getNodeResults(executionId, uniqueNodeIds);
            
            expect(Object.keys(results).length).toBe(uniqueNodeIds.length);

            // Property: database was called
            expect(mockDb.getNodeResultsCallCount).toBe(1);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("getLogs() reads from database for completed executions (Req 5.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          terminalStatusArb,
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
          async (workflowId, status, logMessages) => {
            // Generate execution ID first
            const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            
            // Create logs with the execution ID
            const logs: ExecutionLog[] = logMessages.map((msg, i) => ({
              id: `log-${i}`,
              executionId,
              level: 'info' as const,
              message: msg,
              timestamp: new Date(),
            }));

            // Create completed execution directly in database
            await mockDb.persistCompleteExecution({
              executionId,
              workflowId,
              status,
              startedAt: new Date(Date.now() - 10000),
              completedAt: new Date(),
              nodeResults: {},
              logs,
              spans: [],
              depth: 0,
            });
            createdExecutionIds.push(executionId);

            // Reset call counts
            mockDb.getLogsCallCount = 0;

            // Property: getLogs should delegate to database
            const retrievedLogs = await store.getLogs(executionId);
            expect(retrievedLogs.length).toBe(logMessages.length);

            // Property: database was called
            expect(mockDb.getLogsCallCount).toBe(1);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("getTrace() reads from database for completed executions (Req 5.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          terminalStatusArb,
          fc.array(nodeIdArb, { minLength: 1, maxLength: 5 }),
          async (workflowId, status, nodeIds) => {
            // Create spans
            const spans: ExecutionSpan[] = nodeIds.map((nodeId, i) => ({
              id: `span-${i}`,
              nodeId,
              name: `process-${nodeId}`,
              startTime: Date.now(),
              status: 'completed' as const,
            }));

            // Create completed execution directly in database
            const executionId = await store.createCompletedExecutionInDb(
              workflowId,
              status,
              {},
              [],
              spans
            );
            createdExecutionIds.push(executionId);

            // Reset call counts
            mockDb.getTraceCallCount = 0;

            // Property: getTrace should delegate to database
            const trace = await store.getTrace(executionId);
            expect(trace).not.toBeNull();
            expect(trace!.spans.length).toBe(nodeIds.length);

            // Property: database was called
            expect(mockDb.getTraceCallCount).toBe(1);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("active executions do NOT query database (Req 5.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          async (workflowId) => {
            // Create active execution in Redis
            const executionId = await store.createActiveExecutionInRedis(workflowId);
            createdExecutionIds.push(executionId);

            // Reset call counts
            mockDb.getExecutionCallCount = 0;
            mockDb.getNodeResultsCallCount = 0;

            // Property: execution should be in Redis
            const isActive = await store.isActiveExecution(executionId);
            expect(isActive).toBe(true);

            // Property: getExecution should NOT call database
            const execution = await store.getExecution(executionId);
            expect(execution).not.toBeNull();
            expect(mockDb.getExecutionCallCount).toBe(0);

            // Property: getNodeResults should NOT call database
            await store.getNodeResults(executionId, ['node-1', 'node-2']);
            expect(mockDb.getNodeResultsCallCount).toBe(0);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
