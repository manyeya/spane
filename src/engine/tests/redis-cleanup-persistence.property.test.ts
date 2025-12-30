import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import Redis from "ioredis";
import type { ExecutionResult, ExecutionState, ExecutionLog, ExecutionSpan } from "../../types";

/**
 * Property-based tests for Redis cleanup after persistence.
 * 
 * **Feature: architecture-refactor, Property 6: Redis cleanup after persistence**
 * **Validates: Requirements 4.3**
 * 
 * These tests verify that:
 * - After successful database persistence, all Redis keys for the execution are deleted
 * - Redis state is preserved if database persistence fails
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

interface PersistedState {
  executionId: string;
  workflowId: string;
  status: ExecutionState['status'];
  startedAt: Date;
  completedAt: Date;
  nodeResults: Record<string, ExecutionResult>;
  logs: ExecutionLog[];
  spans: ExecutionSpan[];
}

class MockDatabaseStore {
  public persistedExecutions: Map<string, PersistedState> = new Map();
  public persistCallCount = 0;
  public shouldFail = false;
  public failCount = 0;
  public maxFailures = 0;

  async persistCompleteExecution(state: PersistedState): Promise<void> {
    this.persistCallCount++;
    
    if (this.shouldFail && this.failCount < this.maxFailures) {
      this.failCount++;
      throw new Error('Database connection failed');
    }
    
    this.persistedExecutions.set(state.executionId, state);
  }

  reset() {
    this.persistedExecutions.clear();
    this.persistCallCount = 0;
    this.shouldFail = false;
    this.failCount = 0;
    this.maxFailures = 0;
  }

  setFailure(maxFailures: number) {
    this.shouldFail = true;
    this.maxFailures = maxFailures;
    this.failCount = 0;
  }
}

// ============================================================================
// TEST HYBRID STORE WITH MOCK DATABASE
// ============================================================================

class TestHybridStoreWithMockDb {
  private redisTTL: number;
  private persistRetries: number;

  constructor(
    private redis: Redis,
    private mockDb: MockDatabaseStore,
    options: { redisTTL?: number; persistRetries?: number } = {}
  ) {
    this.redisTTL = options.redisTTL ?? 3600;
    this.persistRetries = options.persistRetries ?? 3;
  }

  private execKey(executionId: string): string {
    return `test:exec:${executionId}`;
  }

  private resultsKey(executionId: string): string {
    return `test:exec:${executionId}:results`;
  }

  private logsKey(executionId: string): string {
    return `test:exec:${executionId}:logs`;
  }

  private spansKey(executionId: string): string {
    return `test:exec:${executionId}:spans`;
  }

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

  async updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    await this.redis.hset(this.resultsKey(executionId), nodeId, JSON.stringify(result));
  }

  async addLog(log: ExecutionLog): Promise<void> {
    await this.redis.rpush(this.logsKey(log.executionId), JSON.stringify(log));
  }

  async addSpan(executionId: string, span: ExecutionSpan): Promise<void> {
    await this.redis.rpush(this.spansKey(executionId), JSON.stringify(span));
  }

  async setExecutionStatus(executionId: string, status: ExecutionState['status']): Promise<void> {
    const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';

    if (isTerminal) {
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

    try {
      await this.persistWithRetry(state);
    } catch (error) {
      // Persistence failed - Redis state preserved
      return;
    }

    // Only cleanup Redis on successful persistence
    await this.cleanupRedisKeys(executionId);
  }

  private async gatherRedisState(executionId: string, status: ExecutionState['status']): Promise<PersistedState | null> {
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
    };
  }

  private async persistWithRetry(state: PersistedState): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.persistRetries; attempt++) {
      try {
        await this.mockDb.persistCompleteExecution(state);
        return;
      } catch (error) {
        lastError = error as Error;
        // Skip actual delay in tests
      }
    }

    throw lastError;
  }

  private async cleanupRedisKeys(executionId: string): Promise<void> {
    await this.redis.del(
      this.execKey(executionId),
      this.resultsKey(executionId),
      this.logsKey(executionId),
      this.spansKey(executionId)
    );
  }

  async isActiveExecution(executionId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.execKey(executionId));
    return exists === 1;
  }

  async hasRedisKeys(executionId: string): Promise<{
    exec: boolean;
    results: boolean;
    logs: boolean;
    spans: boolean;
  }> {
    const [exec, results, logs, spans] = await Promise.all([
      this.redis.exists(this.execKey(executionId)),
      this.redis.exists(this.resultsKey(executionId)),
      this.redis.exists(this.logsKey(executionId)),
      this.redis.exists(this.spansKey(executionId)),
    ]);
    return {
      exec: exec === 1,
      results: results === 1,
      logs: logs === 1,
      spans: spans === 1,
    };
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

describe("Redis cleanup after persistence property tests", () => {
  let redis: Redis;
  let mockDb: MockDatabaseStore;
  let store: TestHybridStoreWithMockDb;
  const createdExecutionIds: string[] = [];

  beforeEach(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    mockDb = new MockDatabaseStore();
    store = new TestHybridStoreWithMockDb(redis, mockDb, { persistRetries: 0 });
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
   * **Feature: architecture-refactor, Property 6: Redis cleanup after persistence**
   * 
   * *For any* execution successfully persisted to the database,
   * all Redis keys for that execution SHALL be deleted.
   * 
   * **Validates: Requirements 4.3**
   */
  describe("Property 6: Redis cleanup after persistence", () => {
    
    test("all Redis keys are deleted after successful persistence (Req 4.3)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 3 }),
          terminalStatusArb,
          async (workflowId, nodeResults, terminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add node results
            for (const [nodeId, result] of nodeResults) {
              await store.updateNodeResult(executionId, nodeId, result);
            }

            // Add logs
            await store.addLog({
              id: `log-1`,
              executionId,
              level: 'info',
              message: 'Test log',
              timestamp: new Date(),
            });

            // Add spans
            await store.addSpan(executionId, {
              id: `span-1`,
              nodeId: nodeResults[0]![0],
              name: 'test-span',
              startTime: Date.now(),
              status: 'completed',
            });

            // Verify Redis keys exist before completion
            const keysBefore = await store.hasRedisKeys(executionId);
            expect(keysBefore.exec).toBe(true);

            // Set terminal status (triggers persistence)
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: all Redis keys should be deleted after successful persistence
            const keysAfter = await store.hasRedisKeys(executionId);
            expect(keysAfter.exec).toBe(false);
            expect(keysAfter.results).toBe(false);
            expect(keysAfter.logs).toBe(false);
            expect(keysAfter.spans).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("Redis state is preserved when database persistence fails (Req 4.4)", async () => {
      // Use a store with retries disabled for this test
      const failingStore = new TestHybridStoreWithMockDb(redis, mockDb, { persistRetries: 0 });
      
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 3 }),
          terminalStatusArb,
          async (workflowId, nodeResults, terminalStatus) => {
            // Configure mock to always fail
            mockDb.setFailure(100); // Fail all attempts

            const executionId = await failingStore.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add node results
            for (const [nodeId, result] of nodeResults) {
              await failingStore.updateNodeResult(executionId, nodeId, result);
            }

            // Verify Redis keys exist before completion
            const keysBefore = await failingStore.hasRedisKeys(executionId);
            expect(keysBefore.exec).toBe(true);

            // Set terminal status (triggers persistence which will fail)
            await failingStore.setExecutionStatus(executionId, terminalStatus);

            // Property: Redis keys should be preserved when persistence fails
            const keysAfter = await failingStore.hasRedisKeys(executionId);
            expect(keysAfter.exec).toBe(true);
            
            // Reset mock for next iteration
            mockDb.reset();
          }
        ),
        { numRuns: 50 }
      );
    });

    test("execution is no longer active in Redis after successful persistence", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          terminalStatusArb,
          async (workflowId, terminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Verify execution is active before completion
            const isActiveBefore = await store.isActiveExecution(executionId);
            expect(isActiveBefore).toBe(true);

            // Set terminal status
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: execution should no longer be active in Redis
            const isActiveAfter = await store.isActiveExecution(executionId);
            expect(isActiveAfter).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("database receives execution before Redis cleanup", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 3 }),
          terminalStatusArb,
          async (workflowId, nodeResults, terminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add node results
            for (const [nodeId, result] of nodeResults) {
              await store.updateNodeResult(executionId, nodeId, result);
            }

            // Set terminal status
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: database should have the execution
            expect(mockDb.persistedExecutions.has(executionId)).toBe(true);
            
            // Property: Redis should be cleaned up
            const keysAfter = await store.hasRedisKeys(executionId);
            expect(keysAfter.exec).toBe(false);
            
            // Property: persisted data should match what was in Redis
            const persisted = mockDb.persistedExecutions.get(executionId)!;
            const uniqueNodeIds = [...new Set(nodeResults.map(([id]) => id))];
            expect(Object.keys(persisted.nodeResults).length).toBe(uniqueNodeIds.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
