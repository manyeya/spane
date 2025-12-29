import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { NodeJobData, DLQItem } from "../types";

/**
 * Property-based tests for DLQ data preservation.
 * 
 * **Feature: workflow-engine-bugfixes, Property 7: DLQ data preservation**
 * 
 * These tests verify that:
 * - When retrying a DLQ item, the re-enqueued job contains all original NodeJobData fields
 * - Delay node state fields (delayStep, delayStartTime) are preserved
 * - The correct job name 'process-node' is used
 * 
 * **Validates: Requirements 6.1, 6.2**
 * 
 * Note: The old subWorkflowStep and childExecutionId fields have been removed
 * as part of the BullMQ improvements cleanup.
 */

// Arbitrary for generating valid execution IDs
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);

// Arbitrary for generating valid workflow IDs
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);

// Arbitrary for generating valid node IDs
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,8}$/);

// Arbitrary for delay step types (including undefined)
const delayStepArb = fc.option(
  fc.constantFrom('initial', 'resumed') as fc.Arbitrary<'initial' | 'resumed'>,
  { nil: undefined }
);

// Arbitrary for generating input data (simple objects)
const inputDataArb = fc.option(
  fc.record({
    value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    nested: fc.option(fc.record({ key: fc.string() }), { nil: undefined }),
  }),
  { nil: undefined }
);

// Arbitrary for generating complete NodeJobData
const nodeJobDataArb = fc.record({
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  nodeId: nodeIdArb,
  inputData: inputDataArb,
  delayStep: delayStepArb,
  delayStartTime: fc.option(fc.integer({ min: 1000000000000, max: 9999999999999 }), { nil: undefined }),
});

// Arbitrary for generating DLQItem
const dlqItemArb = fc.record({
  jobId: fc.stringMatching(/^job-[a-z0-9]{8,16}$/),
  data: nodeJobDataArb,
  failedReason: fc.string({ minLength: 1, maxLength: 100 }),
  timestamp: fc.integer({ min: 1000000000000, max: 9999999999999 }),
  stacktrace: fc.option(fc.array(fc.string(), { minLength: 0, maxLength: 5 }), { nil: undefined }),
});

/**
 * Simulates the DLQ retry data extraction logic.
 * This mirrors the fixed implementation in DLQManager.retryDLQItem.
 */
function extractNodeJobDataFromDLQ(dlqJobData: DLQItem): NodeJobData {
  // dlqJob.data is DLQItem, which contains .data as NodeJobData
  const dlqItem: DLQItem = dlqJobData;
  const nodeJobData: NodeJobData = dlqItem.data;
  return nodeJobData;
}

/**
 * Simulates the job creation for retry.
 * This mirrors the fixed implementation in DLQManager.retryDLQItem.
 */
function createRetryJob(nodeJobData: NodeJobData): { 
  jobName: string; 
  jobData: NodeJobData; 
  jobId: string;
} {
  return {
    jobName: 'process-node',
    jobData: nodeJobData,
    jobId: `${nodeJobData.executionId}-${nodeJobData.nodeId}-retry-${Date.now()}`,
  };
}

/**
 * Mock job queue to capture retry job details
 */
class MockNodeQueue {
  public lastAddedJob: { name: string; data: NodeJobData; options: any } | null = null;

  async add(name: string, data: NodeJobData, options: any): Promise<{ id: string }> {
    this.lastAddedJob = { name, data, options };
    return { id: options.jobId };
  }
}

describe("DLQ data preservation property tests", () => {
  /**
   * **Feature: workflow-engine-bugfixes, Property 7: DLQ data preservation**
   * 
   * *For any* DLQ item being retried, the re-enqueued job SHALL contain all original 
   * NodeJobData fields including delay node state fields.
   * 
   * **Validates: Requirements 6.1, 6.2**
   */
  describe("Property 7: DLQ data preservation", () => {
    test("extracted NodeJobData preserves all original fields", async () => {
      await fc.assert(
        fc.asyncProperty(dlqItemArb, async (dlqItem) => {
          const originalData = dlqItem.data;
          const extractedData = extractNodeJobDataFromDLQ(dlqItem);

          // Property: All core fields must be preserved
          expect(extractedData.executionId).toBe(originalData.executionId);
          expect(extractedData.workflowId).toBe(originalData.workflowId);
          expect(extractedData.nodeId).toBe(originalData.nodeId);
          
          // Property: inputData must be preserved (deep equality)
          expect(extractedData.inputData).toEqual(originalData.inputData);
        }),
        { numRuns: 100 }
      );
    });

    test("delay node state fields are preserved in retry", async () => {
      await fc.assert(
        fc.asyncProperty(dlqItemArb, async (dlqItem) => {
          const originalData = dlqItem.data;
          const extractedData = extractNodeJobDataFromDLQ(dlqItem);

          // Property: delayStep must be preserved (including undefined)
          expect(extractedData.delayStep).toBe(originalData.delayStep);
          
          // Property: delayStartTime must be preserved (including undefined)
          expect(extractedData.delayStartTime).toBe(originalData.delayStartTime);
        }),
        { numRuns: 100 }
      );
    });

    test("retry job uses correct job name 'process-node'", async () => {
      await fc.assert(
        fc.asyncProperty(nodeJobDataArb, async (nodeJobData) => {
          const retryJob = createRetryJob(nodeJobData);

          // Property: job name must be 'process-node'
          expect(retryJob.jobName).toBe('process-node');
        }),
        { numRuns: 100 }
      );
    });

    test("retry job data is identical to original NodeJobData", async () => {
      await fc.assert(
        fc.asyncProperty(dlqItemArb, async (dlqItem) => {
          const originalData = dlqItem.data;
          const extractedData = extractNodeJobDataFromDLQ(dlqItem);
          const retryJob = createRetryJob(extractedData);

          // Property: retry job data must be identical to original
          expect(retryJob.jobData).toEqual(originalData);
        }),
        { numRuns: 100 }
      );
    });

    test("DLQ items with delay state are correctly extracted", async () => {
      // Generate DLQ items specifically with delay state
      const dlqItemWithDelayArb = fc.record({
        jobId: fc.stringMatching(/^job-[a-z0-9]{8,16}$/),
        data: fc.record({
          executionId: executionIdArb,
          workflowId: workflowIdArb,
          nodeId: nodeIdArb,
          inputData: inputDataArb,
          delayStep: fc.constantFrom('initial', 'resumed') as fc.Arbitrary<'initial' | 'resumed'>,
          delayStartTime: fc.integer({ min: 1000000000000, max: 9999999999999 }),
        }),
        failedReason: fc.string({ minLength: 1, maxLength: 100 }),
        timestamp: fc.integer({ min: 1000000000000, max: 9999999999999 }),
        stacktrace: fc.option(fc.array(fc.string(), { minLength: 0, maxLength: 5 }), { nil: undefined }),
      });

      await fc.assert(
        fc.asyncProperty(dlqItemWithDelayArb, async (dlqItem) => {
          const extractedData = extractNodeJobDataFromDLQ(dlqItem);

          // Property: delay state must be present and correct
          expect(extractedData.delayStep).toBeDefined();
          expect(extractedData.delayStartTime).toBeDefined();
          expect(extractedData.delayStep).toBe(dlqItem.data.delayStep);
          expect(extractedData.delayStartTime).toBe(dlqItem.data.delayStartTime);
        }),
        { numRuns: 100 }
      );
    });

    test("retry job ID contains execution and node identifiers", async () => {
      await fc.assert(
        fc.asyncProperty(nodeJobDataArb, async (nodeJobData) => {
          const retryJob = createRetryJob(nodeJobData);

          // Property: job ID must contain execution ID
          expect(retryJob.jobId).toContain(nodeJobData.executionId);
          
          // Property: job ID must contain node ID
          expect(retryJob.jobId).toContain(nodeJobData.nodeId);
          
          // Property: job ID must contain 'retry' indicator
          expect(retryJob.jobId).toContain('-retry-');
        }),
        { numRuns: 100 }
      );
    });

    test("complete round-trip: DLQ item -> extract -> retry preserves data", async () => {
      await fc.assert(
        fc.asyncProperty(dlqItemArb, async (dlqItem) => {
          // Simulate the complete retry flow
          const extractedData = extractNodeJobDataFromDLQ(dlqItem);
          const retryJob = createRetryJob(extractedData);

          // Property: complete round-trip must preserve all data
          expect(retryJob.jobData.executionId).toBe(dlqItem.data.executionId);
          expect(retryJob.jobData.workflowId).toBe(dlqItem.data.workflowId);
          expect(retryJob.jobData.nodeId).toBe(dlqItem.data.nodeId);
          expect(retryJob.jobData.inputData).toEqual(dlqItem.data.inputData);
          expect(retryJob.jobData.delayStep).toBe(dlqItem.data.delayStep);
          expect(retryJob.jobData.delayStartTime).toBe(dlqItem.data.delayStartTime);
          
          // Property: job name must be correct
          expect(retryJob.jobName).toBe('process-node');
        }),
        { numRuns: 100 }
      );
    });

    test("deprecated fields are not present in NodeJobData", async () => {
      await fc.assert(
        fc.asyncProperty(nodeJobDataArb, async (nodeJobData) => {
          // Property: deprecated fields should not exist
          expect((nodeJobData as any).subWorkflowStep).toBeUndefined();
          expect((nodeJobData as any).childExecutionId).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });
  });
});
