import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Tests for job name consistency across WorkflowEngine and NodeProcessor.
 * Requirements: 4.1, 4.2, 4.3
 * 
 * Both components must use 'process-node' as the job name when adding
 * jobs to the node queue to ensure consistent job processing.
 * 
 * These tests verify the source code directly to ensure the correct
 * job name is used, avoiding the complexity of mocking BullMQ internals.
 */

// Get the directory of this test file
const currentDir = dirname(fileURLToPath(import.meta.url));
const engineDir = join(currentDir, "..");

describe("Job name consistency", () => {
  describe("WorkflowEngine.enqueueNode", () => {
    test("uses 'process-node' as job name (Requirement 4.1)", () => {
      const workflowEngineSource = readFileSync(
        join(engineDir, "workflow-engine.ts"),
        "utf-8"
      );

      // Find the enqueueNode method and verify it uses 'process-node'
      // The pattern we're looking for is: nodeQueue.add('process-node', ...)
      const enqueueNodeMatch = workflowEngineSource.match(
        /async\s+enqueueNode\s*\([^)]*\)[^{]*\{[\s\S]*?nodeQueue\.add\s*\(\s*['"]([^'"]+)['"]/
      );

      expect(enqueueNodeMatch).not.toBeNull();
      expect(enqueueNodeMatch![1]).toBe("process-node");
    });

    test("does not use 'run-node' as job name", () => {
      const workflowEngineSource = readFileSync(
        join(engineDir, "workflow-engine.ts"),
        "utf-8"
      );

      // Verify 'run-node' is not used anywhere in nodeQueue.add calls
      const runNodeUsage = workflowEngineSource.match(
        /nodeQueue\.add\s*\(\s*['"]run-node['"]/
      );

      expect(runNodeUsage).toBeNull();
    });
  });

  describe("NodeProcessor.enqueueNode", () => {
    test("uses 'process-node' as job name (Requirement 4.2)", () => {
      const nodeProcessorSource = readFileSync(
        join(engineDir, "node-processor.ts"),
        "utf-8"
      );

      // Find the private enqueueNode method and verify it uses 'process-node'
      const enqueueNodeMatch = nodeProcessorSource.match(
        /private\s+async\s+enqueueNode\s*\([^)]*\)[^{]*\{[\s\S]*?nodeQueue\.add\s*\(\s*['"]([^'"]+)['"]/
      );

      expect(enqueueNodeMatch).not.toBeNull();
      expect(enqueueNodeMatch![1]).toBe("process-node");
    });

    test("does not use 'run-node' as job name", () => {
      const nodeProcessorSource = readFileSync(
        join(engineDir, "node-processor.ts"),
        "utf-8"
      );

      // Verify 'run-node' is not used anywhere in nodeQueue.add calls
      const runNodeUsage = nodeProcessorSource.match(
        /nodeQueue\.add\s*\(\s*['"]run-node['"]/
      );

      expect(runNodeUsage).toBeNull();
    });
  });

  describe("Job name consistency across components", () => {
    test("WorkflowEngine and NodeProcessor use the same job name (Requirements 4.1, 4.2, 4.3)", () => {
      const workflowEngineSource = readFileSync(
        join(engineDir, "workflow-engine.ts"),
        "utf-8"
      );
      const nodeProcessorSource = readFileSync(
        join(engineDir, "node-processor.ts"),
        "utf-8"
      );

      // Extract job names from both files
      const workflowEngineJobNames = [
        ...workflowEngineSource.matchAll(/nodeQueue\.add\s*\(\s*['"]([^'"]+)['"]/g)
      ].map(match => match[1]);

      const nodeProcessorJobNames = [
        ...nodeProcessorSource.matchAll(/nodeQueue\.add\s*\(\s*['"]([^'"]+)['"]/g)
      ].map(match => match[1]);

      // All job names should be 'process-node'
      expect(workflowEngineJobNames.length).toBeGreaterThan(0);
      expect(nodeProcessorJobNames.length).toBeGreaterThan(0);

      for (const jobName of workflowEngineJobNames) {
        expect(jobName).toBe("process-node");
      }

      for (const jobName of nodeProcessorJobNames) {
        expect(jobName).toBe("process-node");
      }

      // Verify consistency - all job names should be the same
      const allJobNames = [...workflowEngineJobNames, ...nodeProcessorJobNames];
      const uniqueJobNames = [...new Set(allJobNames)];
      
      expect(uniqueJobNames).toHaveLength(1);
      expect(uniqueJobNames[0]).toBe("process-node");
    });
  });
});
