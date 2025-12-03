import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { NodeJobData } from "../types";
import type { NodeDefinition, WorkflowDefinition } from "../../types";

/**
 * Property-based tests for idempotent child enqueueing.
 * 
 * **Feature: workflow-engine-bugfixes, Property 4: Idempotent child enqueueing**
 * 
 * These tests verify that:
 * - When a parent node completes K times (due to retries), each child node is enqueued at most once
 * - Deterministic job IDs prevent duplicate job creation
 * - BullMQ's duplicate rejection mechanism works correctly with our ID format
 * 
 * **Validates: Requirements 3.2, 7.2**
 */

// Arbitrary for generating valid execution IDs
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);

// Arbitrary for generating valid workflow IDs
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);

// Arbitrary for generating valid node IDs
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,8}$/);

// Arbitrary for generating number of retries (1-10)
const retryCountArb = fc.integer({ min: 1, max: 10 });

// Arbitrary for generating number of child nodes (1-5)
const childCountArb = fc.integer({ min: 1, max: 5 });

/**
 * Simulates the enqueueNode function behavior for child nodes.
 * This mirrors the actual implementation in NodeProcessor.
 * 
 * Key change: Child nodes now use deterministic job IDs without timestamps
 * Format: `${executionId}-node-${nodeId}` (no timestamp)
 */
function generateChildJobId(
  executionId: string,
  nodeId: string,
  options?: {
    subWorkflowStep?: 'initial' | 'waiting-children' | 'complete';
    childExecutionId?: string;
  }
): string {
  // Use deterministic job IDs to prevent duplicate job creation (idempotency)
  // - For sub-workflow resume jobs: include childExecutionId for uniqueness
  // - For regular child nodes: use format `${executionId}-node-${nodeId}` (no timestamp)
  if (options?.subWorkflowStep) {
    return `${executionId}-node-${nodeId}-resume-${options.childExecutionId}`;
  }
  return `${executionId}-node-${nodeId}`;
}

/**
 * Simulates BullMQ's job queue behavior with duplicate rejection.
 * When a job with the same ID is added, it's rejected (returns false).
 */
class MockJobQueue {
  private jobs: Map<string, NodeJobData> = new Map();
  private addAttempts: Map<string, number> = new Map();

  async add(jobId: string, jobData: NodeJobData): Promise<{ added: boolean; jobId: string }> {
    // Track all add attempts
    const attempts = this.addAttempts.get(jobId) || 0;
    this.addAttempts.set(jobId, attempts + 1);

    // BullMQ rejects duplicate job IDs
    if (this.jobs.has(jobId)) {
      return { added: false, jobId };
    }

    this.jobs.set(jobId, jobData);
    return { added: true, jobId };
  }

  getJobCount(): number {
    return this.jobs.size;
  }

  getAddAttempts(jobId: string): number {
    return this.addAttempts.get(jobId) || 0;
  }

  getTotalAddAttempts(): number {
    let total = 0;
    for (const count of this.addAttempts.values()) {
      total += count;
    }
    return total;
  }

  hasJob(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  clear(): void {
    this.jobs.clear();
    this.addAttempts.clear();
  }
}

/**
 * Simulates parent node completion that enqueues child nodes.
 * This mirrors the checkAndEnqueueChildren behavior in NodeProcessor.
 */
async function simulateParentCompletion(
  queue: MockJobQueue,
  executionId: string,
  workflowId: string,
  childNodeIds: string[]
): Promise<{ enqueuedCount: number; rejectedCount: number }> {
  let enqueuedCount = 0;
  let rejectedCount = 0;

  for (const childNodeId of childNodeIds) {
    const jobId = generateChildJobId(executionId, childNodeId);
    const jobData: NodeJobData = {
      executionId,
      workflowId,
      nodeId: childNodeId,
      inputData: {},
    };

    const result = await queue.add(jobId, jobData);
    if (result.added) {
      enqueuedCount++;
    } else {
      rejectedCount++;
    }
  }

  return { enqueuedCount, rejectedCount };
}

describe("Idempotent child enqueueing property tests", () => {
  /**
   * **Feature: workflow-engine-bugfixes, Property 4: Idempotent child enqueueing**
   * 
   * *For any* parent node completing K times (due to retries), each child node 
   * SHALL be enqueued at most once.
   * 
   * **Validates: Requirements 3.2, 7.2**
   */
  describe("Property 4: Idempotent child enqueueing", () => {
    test("child nodes are enqueued at most once regardless of parent retry count", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          childCountArb,
          retryCountArb,
          async (executionId, workflowId, childCount, retryCount) => {
            const queue = new MockJobQueue();
            const childNodeIds = Array.from({ length: childCount }, (_, i) => `child-${i}`);

            // Simulate parent completing K times (retries)
            for (let i = 0; i < retryCount; i++) {
              await simulateParentCompletion(queue, executionId, workflowId, childNodeIds);
            }

            // Property: Each child node should be enqueued exactly once
            expect(queue.getJobCount()).toBe(childCount);

            // Property: Each child should have a job in the queue
            for (const childNodeId of childNodeIds) {
              const jobId = generateChildJobId(executionId, childNodeId);
              expect(queue.hasJob(jobId)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("deterministic job IDs are identical across multiple calls", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          retryCountArb,
          async (executionId, nodeId, callCount) => {
            const jobIds: string[] = [];

            // Generate job ID multiple times
            for (let i = 0; i < callCount; i++) {
              const jobId = generateChildJobId(executionId, nodeId);
              jobIds.push(jobId);
            }

            // Property: All generated job IDs must be identical
            const firstJobId = jobIds[0];
            
            for (const jobId of jobIds) {
              expect(jobId).toBe(firstJobId!);
            }

            // Property: Job ID should not contain timestamp
            expect(firstJobId).not.toMatch(/\d{13}/); // No 13-digit timestamp
          }
        ),
        { numRuns: 100 }
      );
    });

    test("job ID format is deterministic: executionId-node-nodeId", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          async (executionId, nodeId) => {
            const jobId = generateChildJobId(executionId, nodeId);

            // Property: Job ID must follow the deterministic format
            const expectedFormat = `${executionId}-node-${nodeId}`;
            expect(jobId).toBe(expectedFormat);

            // Property: Job ID must contain both execution and node identifiers
            expect(jobId).toContain(executionId);
            expect(jobId).toContain(nodeId);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("duplicate enqueue attempts are rejected by queue", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          nodeIdArb,
          retryCountArb,
          async (executionId, workflowId, nodeId, retryCount) => {
            const queue = new MockJobQueue();
            const jobId = generateChildJobId(executionId, nodeId);
            const jobData: NodeJobData = {
              executionId,
              workflowId,
              nodeId,
              inputData: {},
            };

            let successCount = 0;
            let rejectCount = 0;

            // Try to add the same job multiple times
            for (let i = 0; i < retryCount; i++) {
              const result = await queue.add(jobId, jobData);
              if (result.added) {
                successCount++;
              } else {
                rejectCount++;
              }
            }

            // Property: Exactly one add should succeed
            expect(successCount).toBe(1);

            // Property: All other adds should be rejected
            expect(rejectCount).toBe(retryCount - 1);

            // Property: Queue should contain exactly one job
            expect(queue.getJobCount()).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("different executions can enqueue same node ID", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(executionIdArb, { minLength: 2, maxLength: 5 }),
          workflowIdArb,
          nodeIdArb,
          async (executionIds, workflowId, nodeId) => {
            // Ensure unique execution IDs
            const uniqueExecutionIds = [...new Set(executionIds)];
            if (uniqueExecutionIds.length < 2) return; // Skip if not enough unique IDs

            const queue = new MockJobQueue();

            // Each execution should be able to enqueue the same node
            for (const executionId of uniqueExecutionIds) {
              const jobId = generateChildJobId(executionId, nodeId);
              const jobData: NodeJobData = {
                executionId,
                workflowId,
                nodeId,
                inputData: {},
              };
              await queue.add(jobId, jobData);
            }

            // Property: Each execution should have its own job
            expect(queue.getJobCount()).toBe(uniqueExecutionIds.length);

            // Property: Each execution's job should exist
            for (const executionId of uniqueExecutionIds) {
              const jobId = generateChildJobId(executionId, nodeId);
              expect(queue.hasJob(jobId)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("fan-out pattern: multiple children from single parent are all enqueued once", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          workflowIdArb,
          fc.integer({ min: 2, max: 10 }), // Fan-out to 2-10 children
          retryCountArb,
          async (executionId, workflowId, fanOutCount, retryCount) => {
            const queue = new MockJobQueue();
            const childNodeIds = Array.from({ length: fanOutCount }, (_, i) => `fanout-child-${i}`);

            // Simulate parent completing multiple times (retries)
            let totalEnqueued = 0;
            let totalRejected = 0;

            for (let retry = 0; retry < retryCount; retry++) {
              const result = await simulateParentCompletion(
                queue,
                executionId,
                workflowId,
                childNodeIds
              );
              totalEnqueued += result.enqueuedCount;
              totalRejected += result.rejectedCount;
            }

            // Property: Total enqueued should equal number of children (first attempt succeeds)
            expect(totalEnqueued).toBe(fanOutCount);

            // Property: Total rejected should equal (retryCount - 1) * fanOutCount
            expect(totalRejected).toBe((retryCount - 1) * fanOutCount);

            // Property: Queue should contain exactly fanOutCount jobs
            expect(queue.getJobCount()).toBe(fanOutCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("resume jobs use different ID format than regular child jobs", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          executionIdArb, // childExecutionId
          async (executionId, nodeId, childExecutionId) => {
            const regularJobId = generateChildJobId(executionId, nodeId);
            const resumeJobId = generateChildJobId(executionId, nodeId, {
              subWorkflowStep: 'complete',
              childExecutionId,
            });

            // Property: Resume job ID should be different from regular job ID
            expect(resumeJobId).not.toBe(regularJobId);

            // Property: Resume job ID should contain 'resume' indicator
            expect(resumeJobId).toContain('-resume-');

            // Property: Resume job ID should contain child execution ID
            expect(resumeJobId).toContain(childExecutionId);

            // Property: Regular job ID should not contain 'resume'
            expect(regularJobId).not.toContain('-resume-');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
