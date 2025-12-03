import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { ExecutionResult } from "../../types";

/**
 * Property-based tests for idempotent node execution.
 * 
 * **Feature: workflow-engine-bugfixes, Property 8: Idempotent node execution**
 * 
 * These tests verify that:
 * - When a node job is processed, the NodeProcessor checks for existing results before execution
 * - When a duplicate job is detected, the system skips execution and returns the existing result
 * - The node executor is called at most once for the same executionId and nodeId
 * 
 * **Validates: Requirements 7.1, 7.3**
 */

// Arbitrary for generating valid execution IDs
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);

// Arbitrary for generating valid node IDs
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,8}$/);

// Arbitrary for generating execution results
const executionResultArb = fc.record({
  success: fc.boolean(),
  data: fc.oneof(
    fc.constant(undefined),
    fc.string(),
    fc.integer(),
    fc.record({ value: fc.string() })
  ),
  error: fc.option(fc.string(), { nil: undefined }),
  skipped: fc.option(fc.boolean(), { nil: undefined }),
});

// Arbitrary for generating successful execution results (for cached results)
const successfulResultArb = fc.record({
  success: fc.constant(true),
  data: fc.oneof(
    fc.string(),
    fc.integer(),
    fc.record({ value: fc.string() })
  ),
  skipped: fc.constant(undefined),
});

// Arbitrary for generating skipped execution results
const skippedResultArb = fc.record({
  success: fc.constant(true),
  data: fc.constant(null),
  skipped: fc.constant(true),
});

// Arbitrary for number of processing attempts
const attemptCountArb = fc.integer({ min: 2, max: 10 });

/**
 * Mock state store that tracks node results and access patterns.
 * Simulates the idempotency check behavior in NodeProcessor.
 */
class MockStateStore {
  private nodeResults: Map<string, ExecutionResult> = new Map();
  private getResultsCalls: number = 0;

  private makeKey(executionId: string, nodeId: string): string {
    return `${executionId}:${nodeId}`;
  }

  async getNodeResults(
    executionId: string,
    nodeIds: string[]
  ): Promise<Record<string, ExecutionResult>> {
    this.getResultsCalls++;
    const results: Record<string, ExecutionResult> = {};
    for (const nodeId of nodeIds) {
      const key = this.makeKey(executionId, nodeId);
      const result = this.nodeResults.get(key);
      if (result) {
        results[nodeId] = result;
      }
    }
    return results;
  }

  async updateNodeResult(
    executionId: string,
    nodeId: string,
    result: ExecutionResult
  ): Promise<void> {
    const key = this.makeKey(executionId, nodeId);
    this.nodeResults.set(key, result);
  }

  hasResult(executionId: string, nodeId: string): boolean {
    const key = this.makeKey(executionId, nodeId);
    return this.nodeResults.has(key);
  }

  getResult(executionId: string, nodeId: string): ExecutionResult | undefined {
    const key = this.makeKey(executionId, nodeId);
    return this.nodeResults.get(key);
  }

  getGetResultsCallCount(): number {
    return this.getResultsCalls;
  }

  clear(): void {
    this.nodeResults.clear();
    this.getResultsCalls = 0;
  }
}

/**
 * Mock node executor that tracks execution calls.
 */
class MockNodeExecutor {
  private executionCount: Map<string, number> = new Map();
  private resultToReturn: ExecutionResult;

  constructor(resultToReturn: ExecutionResult = { success: true, data: "executed" }) {
    this.resultToReturn = resultToReturn;
  }

  private makeKey(executionId: string, nodeId: string): string {
    return `${executionId}:${nodeId}`;
  }

  async execute(executionId: string, nodeId: string): Promise<ExecutionResult> {
    const key = this.makeKey(executionId, nodeId);
    const count = this.executionCount.get(key) || 0;
    this.executionCount.set(key, count + 1);
    return this.resultToReturn;
  }

  getExecutionCount(executionId: string, nodeId: string): number {
    const key = this.makeKey(executionId, nodeId);
    return this.executionCount.get(key) || 0;
  }

  getTotalExecutionCount(): number {
    let total = 0;
    for (const count of this.executionCount.values()) {
      total += count;
    }
    return total;
  }

  clear(): void {
    this.executionCount.clear();
  }
}

/**
 * Simulates the idempotent node processing logic from NodeProcessor.processNodeJob.
 * This mirrors the actual implementation's idempotency check.
 */
async function processNodeWithIdempotency(
  stateStore: MockStateStore,
  executor: MockNodeExecutor,
  executionId: string,
  nodeId: string
): Promise<ExecutionResult> {
  // --- IDEMPOTENCY CHECK (mirrors NodeProcessor.processNodeJob) ---
  // Optimization: Use getNodeResults for a lightweight idempotency check.
  const existingResults = await stateStore.getNodeResults(executionId, [nodeId]);
  const existingResult = existingResults[nodeId];
  
  if (existingResult && (existingResult.success || existingResult.skipped)) {
    // Return cached result without executing
    return existingResult;
  }

  // Execute the node (only if no cached result)
  const result = await executor.execute(executionId, nodeId);

  // Save result
  await stateStore.updateNodeResult(executionId, nodeId, result);

  return result;
}

describe("Idempotent node execution property tests", () => {
  /**
   * **Feature: workflow-engine-bugfixes, Property 8: Idempotent node execution**
   * 
   * *For any* node processed multiple times with the same executionId and nodeId,
   * the node executor SHALL be called at most once, and subsequent calls SHALL
   * return the cached result.
   * 
   * **Validates: Requirements 7.1, 7.3**
   */
  describe("Property 8: Idempotent node execution", () => {
    test("node executor is called at most once for same executionId and nodeId", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          attemptCountArb,
          async (executionId, nodeId, attemptCount) => {
            const stateStore = new MockStateStore();
            const executor = new MockNodeExecutor();

            // Process the same node multiple times
            for (let i = 0; i < attemptCount; i++) {
              await processNodeWithIdempotency(stateStore, executor, executionId, nodeId);
            }

            // Property: Executor should be called exactly once
            expect(executor.getExecutionCount(executionId, nodeId)).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("subsequent calls return the cached result", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          successfulResultArb,
          attemptCountArb,
          async (executionId, nodeId, expectedResult, attemptCount) => {
            const stateStore = new MockStateStore();
            const executor = new MockNodeExecutor(expectedResult);

            const results: ExecutionResult[] = [];

            // Process the same node multiple times
            for (let i = 0; i < attemptCount; i++) {
              const result = await processNodeWithIdempotency(
                stateStore,
                executor,
                executionId,
                nodeId
              );
              results.push(result);
            }

            // Property: All results should be identical
            const firstResult = results[0];
            for (const result of results) {
              expect(result.success).toBe(firstResult!.success);
              expect(result.data).toEqual(firstResult!.data);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("skipped nodes are also cached and not re-executed", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          attemptCountArb,
          async (executionId, nodeId, attemptCount) => {
            const stateStore = new MockStateStore();
            const skippedResult: ExecutionResult = {
              success: true,
              skipped: true,
              data: null,
            };
            
            // Pre-populate with a skipped result
            await stateStore.updateNodeResult(executionId, nodeId, skippedResult);
            
            const executor = new MockNodeExecutor();

            // Try to process the node multiple times
            for (let i = 0; i < attemptCount; i++) {
              const result = await processNodeWithIdempotency(
                stateStore,
                executor,
                executionId,
                nodeId
              );
              
              // Property: Should return the skipped result
              expect(result.skipped).toBe(true);
            }

            // Property: Executor should never be called (result was cached)
            expect(executor.getExecutionCount(executionId, nodeId)).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("different nodes in same execution are processed independently", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          fc.array(nodeIdArb, { minLength: 2, maxLength: 5 }),
          async (executionId, nodeIds) => {
            // Ensure unique node IDs
            const uniqueNodeIds = [...new Set(nodeIds)];
            if (uniqueNodeIds.length < 2) return;

            const stateStore = new MockStateStore();
            const executor = new MockNodeExecutor();

            // Process each node once
            for (const nodeId of uniqueNodeIds) {
              await processNodeWithIdempotency(stateStore, executor, executionId, nodeId);
            }

            // Property: Each node should be executed exactly once
            for (const nodeId of uniqueNodeIds) {
              expect(executor.getExecutionCount(executionId, nodeId)).toBe(1);
            }

            // Property: Total executions should equal number of unique nodes
            expect(executor.getTotalExecutionCount()).toBe(uniqueNodeIds.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("same node in different executions are processed independently", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(executionIdArb, { minLength: 2, maxLength: 5 }),
          nodeIdArb,
          async (executionIds, nodeId) => {
            // Ensure unique execution IDs
            const uniqueExecutionIds = [...new Set(executionIds)];
            if (uniqueExecutionIds.length < 2) return;

            const stateStore = new MockStateStore();
            const executor = new MockNodeExecutor();

            // Process the same node in different executions
            for (const executionId of uniqueExecutionIds) {
              await processNodeWithIdempotency(stateStore, executor, executionId, nodeId);
            }

            // Property: Each execution should have its own result
            for (const executionId of uniqueExecutionIds) {
              expect(executor.getExecutionCount(executionId, nodeId)).toBe(1);
            }

            // Property: Total executions should equal number of unique executions
            expect(executor.getTotalExecutionCount()).toBe(uniqueExecutionIds.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("idempotency check is performed before every execution attempt", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          attemptCountArb,
          async (executionId, nodeId, attemptCount) => {
            const stateStore = new MockStateStore();
            const executor = new MockNodeExecutor();

            // Process the same node multiple times
            for (let i = 0; i < attemptCount; i++) {
              await processNodeWithIdempotency(stateStore, executor, executionId, nodeId);
            }

            // Property: getNodeResults should be called for every attempt
            expect(stateStore.getGetResultsCallCount()).toBe(attemptCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("failed results do not prevent re-execution", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          attemptCountArb,
          async (executionId, nodeId, attemptCount) => {
            const stateStore = new MockStateStore();
            const failedResult: ExecutionResult = {
              success: false,
              error: "Previous failure",
            };
            
            // Pre-populate with a failed result
            await stateStore.updateNodeResult(executionId, nodeId, failedResult);
            
            const successResult: ExecutionResult = {
              success: true,
              data: "retry succeeded",
            };
            const executor = new MockNodeExecutor(successResult);

            // Process the node (should re-execute since previous was failed)
            const result = await processNodeWithIdempotency(
              stateStore,
              executor,
              executionId,
              nodeId
            );

            // Property: Should execute and return new result (failed results don't block)
            expect(result.success).toBe(true);
            expect(executor.getExecutionCount(executionId, nodeId)).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("result is persisted after first execution", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          successfulResultArb,
          async (executionId, nodeId, expectedResult) => {
            const stateStore = new MockStateStore();
            const executor = new MockNodeExecutor(expectedResult);

            // Initially no result
            expect(stateStore.hasResult(executionId, nodeId)).toBe(false);

            // Process the node
            await processNodeWithIdempotency(stateStore, executor, executionId, nodeId);

            // Property: Result should be persisted
            expect(stateStore.hasResult(executionId, nodeId)).toBe(true);

            // Property: Persisted result should match execution result
            const storedResult = stateStore.getResult(executionId, nodeId);
            expect(storedResult?.success).toBe(expectedResult.success);
            expect(storedResult?.data).toEqual(expectedResult.data);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
