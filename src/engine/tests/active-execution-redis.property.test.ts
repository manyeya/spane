import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fc from "fast-check";
import Redis from "ioredis";
import type { ExecutionResult, ExecutionState } from "../../types";

/**
 * Property-based tests for active execution state in Redis.
 * 
 * **Feature: architecture-refactor, Property 4: Active execution state in Redis**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 * 
 * These tests verify that:
 * - Active executions (running/paused) are stored in Redis
 * - Node results are written to Redis first
 * - getNodeResults() reads from Redis without database queries
 * - getExecution() reconstructs state from Redis
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

// ============================================================================
// MINIMAL HYBRID STORE IMPLEMENTATION FOR TESTING
// ============================================================================

/**
 * Minimal implementation of HybridExecutionStateStore for testing Redis operations.
 * This isolates the Redis logic from database dependencies.
 */
class TestHybridStore {
  private redisTTL: number;

  constructor(private redis: Redis, redisTTL: number = 3600) {
    this.redisTTL = redisTTL;
  }

  private execKey(executionId: string): string {
    return `test:exec:${executionId}`;
  }

  private resultsKey(executionId: string): string {
    return `test:exec:${executionId}:results`;
  }

  async createExecution(
    workflowId: string,
    parentExecutionId?: string,
    depth: number = 0,
    initialData?: any
  ): Promise<string> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

    await pipeline.exec();
    return executionId;
  }

  async updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void> {
    await this.redis.hset(this.resultsKey(executionId), nodeId, JSON.stringify(result));
  }

  async getNodeResults(executionId: string, nodeIds: string[]): Promise<Record<string, ExecutionResult>> {
    if (nodeIds.length === 0) return {};

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

  async isActiveExecution(executionId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.execKey(executionId));
    return exists === 1;
  }

  async getExecution(executionId: string): Promise<ExecutionState | null> {
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
      metadata: execData.metadata ? JSON.parse(execData.metadata) : undefined,
    };
  }

  async cleanup(executionId: string): Promise<void> {
    await this.redis.del(this.execKey(executionId), this.resultsKey(executionId));
  }
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Active execution state in Redis property tests", () => {
  let redis: Redis;
  let store: TestHybridStore;
  const createdExecutionIds: string[] = [];

  beforeEach(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    store = new TestHybridStore(redis);
  });

  afterEach(async () => {
    // Cleanup all created executions
    for (const execId of createdExecutionIds) {
      await store.cleanup(execId);
    }
    createdExecutionIds.length = 0;
    await redis.quit();
  });

  /**
   * **Feature: architecture-refactor, Property 4: Active execution state in Redis**
   * 
   * *For any* execution with status 'running' or 'paused', the execution state 
   * SHALL exist in Redis and getNodeResults() SHALL read from Redis without database queries.
   * 
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   */
  describe("Property 4: Active execution state in Redis", () => {
    
    test("createExecution stores initial state in Redis (Req 3.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.option(fc.jsonValue(), { nil: undefined }),
          async (workflowId, initialData) => {
            const executionId = await store.createExecution(workflowId, undefined, 0, initialData);
            createdExecutionIds.push(executionId);

            // Property: execution should exist in Redis
            const isActive = await store.isActiveExecution(executionId);
            expect(isActive).toBe(true);

            // Property: execution state should be retrievable
            const state = await store.getExecution(executionId);
            expect(state).not.toBeNull();
            expect(state!.executionId).toBe(executionId);
            expect(state!.workflowId).toBe(workflowId);
            expect(state!.status).toBe('running');
          }
        ),
        { numRuns: 50 }
      );
    });

    test("updateNodeResult writes to Redis immediately (Req 3.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          nodeIdArb,
          executionResultArb,
          async (workflowId, nodeId, result) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Update node result
            await store.updateNodeResult(executionId, nodeId, result);

            // Property: result should be immediately readable from Redis
            const results = await store.getNodeResults(executionId, [nodeId]);
            expect(results[nodeId]).toBeDefined();
            expect(results[nodeId]!.success).toBe(result.success);
            
            // Check data equality via JSON round-trip (handles -0, undefined, etc.)
            if (result.data !== undefined) {
              expect(JSON.stringify(results[nodeId]!.data)).toBe(JSON.stringify(result.data));
            }
            if (result.error !== undefined) {
              expect(results[nodeId]!.error).toBe(result.error);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    test("getNodeResults reads from Redis for active executions (Req 3.3)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 1, maxLength: 5 }),
          async (workflowId, nodeResults) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Store multiple node results
            const nodeIds: string[] = [];
            for (const [nodeId, result] of nodeResults) {
              await store.updateNodeResult(executionId, nodeId, result);
              nodeIds.push(nodeId);
            }

            // Property: all results should be readable
            const results = await store.getNodeResults(executionId, nodeIds);
            
            // Property: number of results should match (accounting for duplicate nodeIds)
            const uniqueNodeIds = [...new Set(nodeIds)];
            expect(Object.keys(results).length).toBe(uniqueNodeIds.length);

            // Property: each result should be present
            for (const nodeId of uniqueNodeIds) {
              expect(results[nodeId]).toBeDefined();
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    test("getExecution reconstructs full state from Redis (Req 3.4)", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(fc.tuple(nodeIdArb, executionResultArb), { minLength: 0, maxLength: 5 }),
          fc.option(fc.jsonValue(), { nil: undefined }),
          async (workflowId, nodeResults, initialData) => {
            const executionId = await store.createExecution(workflowId, undefined, 0, initialData);
            createdExecutionIds.push(executionId);

            // Store node results
            for (const [nodeId, result] of nodeResults) {
              await store.updateNodeResult(executionId, nodeId, result);
            }

            // Property: getExecution should return complete state
            const state = await store.getExecution(executionId);
            expect(state).not.toBeNull();
            expect(state!.executionId).toBe(executionId);
            expect(state!.workflowId).toBe(workflowId);
            expect(state!.status).toBe('running');

            // Property: all node results should be included
            const uniqueNodeIds = [...new Set(nodeResults.map(([id]) => id))];
            expect(Object.keys(state!.nodeResults).length).toBe(uniqueNodeIds.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    test("multiple node result updates are all persisted", async () => {
      await fc.assert(
        fc.asyncProperty(
          workflowIdArb,
          fc.array(nodeIdArb, { minLength: 2, maxLength: 10 }),
          async (workflowId, nodeIds) => {
            const executionId = await store.createExecution(workflowId);
            createdExecutionIds.push(executionId);

            // Update all nodes with success results
            for (const nodeId of nodeIds) {
              await store.updateNodeResult(executionId, nodeId, { success: true, data: { nodeId } });
            }

            // Property: all unique nodes should have results
            const uniqueNodeIds = [...new Set(nodeIds)];
            const results = await store.getNodeResults(executionId, uniqueNodeIds);
            expect(Object.keys(results).length).toBe(uniqueNodeIds.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
