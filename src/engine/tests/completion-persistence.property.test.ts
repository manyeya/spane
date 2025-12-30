import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fc from "fast-check";
import Redis from "ioredis";
import type { ExecutionResult, ExecutionState, ExecutionLog, ExecutionSpan } from "../../types";

/**
 * Property-based tests for completion persistence.
 * 
 * **Feature: architecture-refactor, Property 5: Completion triggers persistence**
 * **Validates: Requirements 4.1, 4.2**
 * 
 * These tests verify that:
 * - When an execution completes (status: completed, failed, or cancelled),
 *   the full execution state is persisted to the database in a single transaction
 * - All node results, logs, and spans are included in the persistence
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{4,8}$/);
const executionIdArb = fc.stringMatching(/^exec_[0-9]{13}_[a-z0-9]{9}$/);

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
    const delays = [1000, 2000, 4000];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.persistRetries; attempt++) {
      try {
        await this.mockDb.persistCompleteExecution(state);
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.persistRetries) {
          // Skip actual delay in tests
        }
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

describe("Completion persistence property tests", () => {
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
   * **Feature: architecture-refactor, Property 5: Completion triggers persistence**
   * 
   * *For any* execution transitioning to a terminal status (completed, failed, cancelled),
   * the full execution state (metadata, all node results, logs) SHALL be persisted
   * to the database in a single transaction.
   * 
   * **Validates: Requirements 4.1, 4.2**
   */
  describe("Property 5: Completion triggers persistence", () => {
    
    test("terminal status triggers database persistence (Req 4.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          terminalStatusArb,
          async (workflowId, terminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Set terminal status
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: database should have received the execution
            expect(mockDb.persistedExecutions.has(executionId)).toBe(true);
            
            const persisted = mockDb.persistedExecutions.get(executionId)!;
            expect(persisted.status).toBe(terminalStatus);
            expect(persisted.workflowId).toBe(workflowId);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("non-terminal status does NOT trigger database persistence", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          nonTerminalStatusArb,
          async (workflowId, nonTerminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Set non-terminal status
            await store.setExecutionStatus(executionId, nonTerminalStatus);

            // Property: database should NOT have received the execution
            expect(mockDb.persistedExecutions.has(executionId)).toBe(false);
            expect(mockDb.persistCallCount).toBe(0);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("all node results are included in persistence (Req 4.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 5 }),
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

            // Property: all node results should be persisted
            const persisted = mockDb.persistedExecutions.get(executionId)!;
            const uniqueNodeIds = [...new Set(nodeResults.map(([id]) => id))];
            
            expect(Object.keys(persisted.nodeResults).length).toBe(uniqueNodeIds.length);
            
            for (const nodeId of uniqueNodeIds) {
              expect(persisted.nodeResults[nodeId]).toBeDefined();
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    test("logs are included in persistence (Req 4.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
          terminalStatusArb,
          async (workflowId, logMessages, terminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

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

            // Set terminal status
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: all logs should be persisted
            const persisted = mockDb.persistedExecutions.get(executionId)!;
            expect(persisted.logs.length).toBe(logMessages.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("spans are included in persistence (Req 4.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(nodeIdArb, { minLength: 1, maxLength: 5 }),
          terminalStatusArb,
          async (workflowId, nodeIds, terminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add spans
            for (let i = 0; i < nodeIds.length; i++) {
              await store.addSpan(executionId, {
                id: `span-${i}`,
                nodeId: nodeIds[i]!,
                name: `process-${nodeIds[i]}`,
                startTime: Date.now(),
                status: 'completed',
              });
            }

            // Set terminal status
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: all spans should be persisted
            const persisted = mockDb.persistedExecutions.get(executionId)!;
            expect(persisted.spans.length).toBe(nodeIds.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("persistence includes complete state (metadata, results, logs, spans)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 3 }),
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 3 }),
          terminalStatusArb,
          async (workflowId, nodeResults, logMessages, terminalStatus) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Add node results
            for (const [nodeId, result] of nodeResults) {
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

            // Add spans
            for (let i = 0; i < nodeResults.length; i++) {
              await store.addSpan(executionId, {
                id: `span-${i}`,
                nodeId: nodeResults[i]![0],
                name: `process-${nodeResults[i]![0]}`,
                startTime: Date.now(),
                status: 'completed',
              });
            }

            // Set terminal status
            await store.setExecutionStatus(executionId, terminalStatus);

            // Property: complete state should be persisted
            const persisted = mockDb.persistedExecutions.get(executionId)!;
            
            expect(persisted.executionId).toBe(executionId);
            expect(persisted.workflowId).toBe(workflowId);
            expect(persisted.status).toBe(terminalStatus);
            expect(persisted.completedAt).toBeInstanceOf(Date);
            
            const uniqueNodeIds = [...new Set(nodeResults.map(([id]) => id))];
            expect(Object.keys(persisted.nodeResults).length).toBe(uniqueNodeIds.length);
            expect(persisted.logs.length).toBe(logMessages.length);
            expect(persisted.spans.length).toBe(nodeResults.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
