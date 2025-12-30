import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import * as fc from "fast-check";
import { Redis } from "ioredis";
import { DistributedLock } from "../../utils/distributed-lock";
import type { ExecutionState, ExecutionResult, WorkflowDefinition } from "../../types";
import { InMemoryExecutionStore } from "../../db/inmemory-store";

/**
 * Property-based tests for atomic workflow completion.
 * 
 * **Feature: workflow-engine-bugfixes, Property 3: Atomic workflow completion**
 * 
 * These tests verify that:
 * - When multiple nodes complete simultaneously, the workflow status is updated to 'completed' exactly once
 * - Distributed locking prevents race conditions during completion checks
 * - Only one process successfully updates the workflow status
 * 
 * **Validates: Requirements 3.1**
 */

// Arbitrary for generating valid execution IDs
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);

// Arbitrary for generating valid workflow IDs
const workflowIdArb = fc.stringMatching(/^workflow-[a-z0-9]{4,12}$/);

// Arbitrary for number of concurrent completion attempts
const concurrentAttemptsArb = fc.integer({ min: 2, max: 10 });

// Arbitrary for number of nodes in a workflow
const nodeCountArb = fc.integer({ min: 2, max: 10 });

/**
 * Extended InMemoryExecutionStore that tracks status update calls
 */
class TrackingExecutionStore extends InMemoryExecutionStore {
  private statusUpdateCalls: number = 0;
  private completedStatusUpdates: number = 0;
  private executionData: Map<string, ExecutionState> = new Map();

  async createTestExecution(executionId: string, workflowId: string, nodeCount: number): Promise<void> {
    const nodeResults: Record<string, ExecutionResult> = {};
    // Pre-populate all nodes as completed (simulating all nodes finished)
    for (let i = 0; i < nodeCount; i++) {
      nodeResults[`node-${i}`] = { success: true, data: `result-${i}` };
    }

    const execution: ExecutionState = {
      executionId,
      workflowId,
      status: 'running',
      nodeResults,
      startedAt: new Date(),
      depth: 0,
    };
    this.executionData.set(executionId, execution);
  }

  override async getExecution(executionId: string): Promise<ExecutionState | null> {
    return this.executionData.get(executionId) || null;
  }

  override async getPendingNodeCount(executionId: string, totalNodes: number): Promise<number> {
    const execution = this.executionData.get(executionId);
    if (!execution) return totalNodes;
    
    const completedCount = Object.values(execution.nodeResults).filter(
      r => r.success || r.skipped
    ).length;
    
    return totalNodes - completedCount;
  }

  override async setExecutionStatus(executionId: string, status: ExecutionState['status']): Promise<void> {
    this.statusUpdateCalls++;
    
    const execution = this.executionData.get(executionId);
    if (execution) {
      execution.status = status;
      if (status === 'completed') {
        this.completedStatusUpdates++;
        execution.completedAt = new Date();
      }
    }
  }

  getStatusUpdateCalls(): number {
    return this.statusUpdateCalls;
  }

  getCompletedStatusUpdates(): number {
    return this.completedStatusUpdates;
  }

  getExecutionStatus(executionId: string): ExecutionState['status'] | undefined {
    return this.executionData.get(executionId)?.status;
  }

  resetCounters(): void {
    this.statusUpdateCalls = 0;
    this.completedStatusUpdates = 0;
  }

  clearAll(): void {
    this.executionData.clear();
    this.resetCounters();
  }
}

/**
 * Creates a test workflow definition
 */
function createTestWorkflow(workflowId: string, nodeCount: number): WorkflowDefinition {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node-${i}`,
      type: 'action',
      config: {},
      inputs: i === 0 ? [] : [`node-${i - 1}`],
      outputs: i === nodeCount - 1 ? [] : [`node-${i + 1}`],
    });
  }
  return {
    id: workflowId,
    name: `Test Workflow ${workflowId}`,
    entryNodeId: 'node-0',
    nodes,
  };
}


/**
 * Simulates the checkWorkflowCompletion logic from NodeProcessor.
 * This mirrors the ACTUAL implementation's distributed locking behavior.
 */
async function checkWorkflowCompletionWithLock(
  distributedLock: DistributedLock,
  stateStore: TrackingExecutionStore,
  executionId: string,
  workflow: WorkflowDefinition,
  notifyParent: () => Promise<void> = async () => {}
): Promise<boolean> {
  // Check if already failed/cancelled (mirrors NodeProcessor line ~320)
  const currentExecution = await stateStore.getExecution(executionId);
  if (currentExecution?.status === 'failed' || currentExecution?.status === 'cancelled') {
    return false;
  }

  // Use distributed lock to prevent race condition (mirrors NodeProcessor line ~325-327)
  const lockKey = `completion:${executionId}`;
  const lockToken = await distributedLock.acquire(lockKey, 5000);
  
  if (!lockToken) {
    // Another process is checking completion, skip (mirrors NodeProcessor line ~329-332)
    return false;
  }

  try {
    const totalNodes = workflow.nodes.length;
    const pendingCount = await stateStore.getPendingNodeCount(executionId, totalNodes);

    if (pendingCount === 0) {
      await stateStore.setExecutionStatus(executionId, 'completed');
      await notifyParent();
      return true;
    }
    return false;
  } finally {
    await distributedLock.release(lockKey, lockToken);
  }
}

/**
 * Simulates concurrent completion checks WITHOUT distributed locking.
 * This demonstrates the race condition that the lock prevents.
 */
async function checkWorkflowCompletionWithoutLock(
  stateStore: TrackingExecutionStore,
  executionId: string,
  workflow: WorkflowDefinition
): Promise<boolean> {
  const currentExecution = await stateStore.getExecution(executionId);
  if (currentExecution?.status === 'failed' || currentExecution?.status === 'cancelled') {
    return false;
  }

  const totalNodes = workflow.nodes.length;
  const pendingCount = await stateStore.getPendingNodeCount(executionId, totalNodes);

  if (pendingCount === 0) {
    await stateStore.setExecutionStatus(executionId, 'completed');
    return true;
  }
  return false;
}

describe("Atomic workflow completion property tests", () => {
  let redis: Redis;
  let distributedLock: DistributedLock;
  let stateStore: TrackingExecutionStore;

  beforeAll(async () => {
    // Connect to real Redis for testing the actual distributed lock
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    });
    distributedLock = new DistributedLock(redis);
    stateStore = new TrackingExecutionStore();
  });

  afterAll(async () => {
    await redis.quit();
  });

  afterEach(async () => {
    stateStore.clearAll();
    // Clean up any test locks
    const keys = await redis.keys('lock:completion:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  /**
   * **Feature: workflow-engine-bugfixes, Property 3: Atomic workflow completion**
   * 
   * *For any* workflow with N nodes completing concurrently, the workflow status
   * SHALL be updated to 'completed' exactly once.
   * 
   * **Validates: Requirements 3.1**
   */
  describe("Property 3: Atomic workflow completion", () => {
    test("workflow status is updated to 'completed' exactly once with real distributed locking", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeCountArb,
          concurrentAttemptsArb,
          async (executionId, workflowId, nodeCount, concurrentAttempts) => {
            // Setup
            stateStore.clearAll();
            const workflow = createTestWorkflow(workflowId, nodeCount);
            await stateStore.createTestExecution(executionId, workflowId, nodeCount);

            // Clean up any existing lock for this execution
            await redis.del(`lock:completion:${executionId}`);

            // Simulate concurrent completion checks using real Redis distributed lock
            const completionPromises: Promise<boolean>[] = [];
            for (let i = 0; i < concurrentAttempts; i++) {
              completionPromises.push(
                checkWorkflowCompletionWithLock(
                  distributedLock,
                  stateStore,
                  executionId,
                  workflow
                )
              );
            }

            const results = await Promise.all(completionPromises);

            // Property: Exactly one completion check should succeed in updating status
            const successfulCompletions = results.filter(r => r === true).length;
            expect(successfulCompletions).toBe(1);

            // Property: Status should be 'completed'
            expect(stateStore.getExecutionStatus(executionId)).toBe('completed');

            // Property: setExecutionStatus should be called exactly once with 'completed'
            expect(stateStore.getCompletedStatusUpdates()).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("failed/cancelled executions are not marked as completed", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeCountArb,
          fc.constantFrom('failed', 'cancelled') as fc.Arbitrary<'failed' | 'cancelled'>,
          concurrentAttemptsArb,
          async (executionId, workflowId, nodeCount, initialStatus, concurrentAttempts) => {
            // Setup
            stateStore.clearAll();
            const workflow = createTestWorkflow(workflowId, nodeCount);
            await stateStore.createTestExecution(executionId, workflowId, nodeCount);
            
            // Set initial status to failed or cancelled
            await stateStore.setExecutionStatus(executionId, initialStatus);
            stateStore.resetCounters(); // Reset after setting initial status

            // Clean up any existing lock
            await redis.del(`lock:completion:${executionId}`);

            const completionPromises: Promise<boolean>[] = [];
            for (let i = 0; i < concurrentAttempts; i++) {
              completionPromises.push(
                checkWorkflowCompletionWithLock(
                  distributedLock,
                  stateStore,
                  executionId,
                  workflow
                )
              );
            }

            const results = await Promise.all(completionPromises);

            // Property: No completion check should succeed
            const successfulCompletions = results.filter(r => r === true).length;
            expect(successfulCompletions).toBe(0);

            // Property: Status should remain unchanged
            expect(stateStore.getExecutionStatus(executionId)).toBe(initialStatus);

            // Property: No status updates should occur
            expect(stateStore.getStatusUpdateCalls()).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("without locking, multiple status updates can occur (demonstrating the race condition)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeCountArb,
          fc.integer({ min: 5, max: 15 }),
          async (executionId, workflowId, nodeCount, concurrentAttempts) => {
            // Setup
            stateStore.clearAll();
            const workflow = createTestWorkflow(workflowId, nodeCount);
            await stateStore.createTestExecution(executionId, workflowId, nodeCount);

            // Simulate concurrent completion checks WITHOUT locking
            const completionPromises: Promise<boolean>[] = [];
            for (let i = 0; i < concurrentAttempts; i++) {
              completionPromises.push(
                checkWorkflowCompletionWithoutLock(
                  stateStore,
                  executionId,
                  workflow
                )
              );
            }

            const results = await Promise.all(completionPromises);

            // Without locking, ALL concurrent checks will succeed (race condition!)
            const successfulCompletions = results.filter(r => r === true).length;
            
            // Property: Without locking, multiple completions occur (this is the bug we're preventing)
            expect(successfulCompletions).toBe(concurrentAttempts);
            expect(stateStore.getCompletedStatusUpdates()).toBe(concurrentAttempts);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("different executions can complete independently with real locking", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(executionIdArb, { minLength: 2, maxLength: 5 }),
          workflowIdArb,
          nodeCountArb,
          async (executionIds, workflowId, nodeCount) => {
            // Ensure unique execution IDs
            const uniqueExecutionIds = [...new Set(executionIds)];
            if (uniqueExecutionIds.length < 2) return;

            // Setup
            stateStore.clearAll();
            const workflow = createTestWorkflow(workflowId, nodeCount);

            // Create all executions and clean up locks
            for (const execId of uniqueExecutionIds) {
              await stateStore.createTestExecution(execId, workflowId, nodeCount);
              await redis.del(`lock:completion:${execId}`);
            }

            // Complete all executions concurrently
            const completionPromises: Promise<boolean>[] = [];
            for (const execId of uniqueExecutionIds) {
              completionPromises.push(
                checkWorkflowCompletionWithLock(
                  distributedLock,
                  stateStore,
                  execId,
                  workflow
                )
              );
            }

            const results = await Promise.all(completionPromises);

            // Property: Each execution should complete exactly once
            const successfulCompletions = results.filter(r => r === true).length;
            expect(successfulCompletions).toBe(uniqueExecutionIds.length);

            // Property: All executions should be marked as completed
            for (const execId of uniqueExecutionIds) {
              expect(stateStore.getExecutionStatus(execId)).toBe('completed');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("lock is always released after completion check (real Redis)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeCountArb,
          async (executionId, workflowId, nodeCount) => {
            // Setup
            stateStore.clearAll();
            const workflow = createTestWorkflow(workflowId, nodeCount);
            await stateStore.createTestExecution(executionId, workflowId, nodeCount);
            
            const lockKey = `completion:${executionId}`;
            await redis.del(`lock:${lockKey}`);

            // First completion check
            await checkWorkflowCompletionWithLock(
              distributedLock,
              stateStore,
              executionId,
              workflow
            );

            // Property: Lock should be released, allowing another acquisition
            const newToken = await distributedLock.acquire(lockKey, 5000);
            
            // Should be able to acquire lock again (proves it was released)
            expect(newToken).not.toBeNull();
            
            // Clean up
            if (newToken) {
              await distributedLock.release(lockKey, newToken);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("parent notification is called exactly once on completion", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeCountArb,
          concurrentAttemptsArb,
          async (executionId, workflowId, nodeCount, concurrentAttempts) => {
            // Setup
            stateStore.clearAll();
            const workflow = createTestWorkflow(workflowId, nodeCount);
            await stateStore.createTestExecution(executionId, workflowId, nodeCount);
            await redis.del(`lock:completion:${executionId}`);
            
            let parentNotificationCount = 0;
            const notifyParent = async () => {
              parentNotificationCount++;
            };

            const completionPromises: Promise<boolean>[] = [];
            for (let i = 0; i < concurrentAttempts; i++) {
              completionPromises.push(
                checkWorkflowCompletionWithLock(
                  distributedLock,
                  stateStore,
                  executionId,
                  workflow,
                  notifyParent
                )
              );
            }

            await Promise.all(completionPromises);

            // Property: Parent notification should be called exactly once
            expect(parentNotificationCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
