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

  describe("ChildEnqueueHandler.enqueueNode", () => {
    test("uses 'process-node' as job name (Requirement 4.2)", () => {
      // Note: enqueueNode logic was moved from NodeProcessor to child-enqueue-handler.ts
      const childEnqueueHandlerSource = readFileSync(
        join(engineDir, "handlers", "child-enqueue-handler.ts"),
        "utf-8"
      );

      // Find the enqueueNode function and verify it uses 'process-node'
      const enqueueNodeMatch = childEnqueueHandlerSource.match(
        /export\s+async\s+function\s+enqueueNode\s*\([^)]*\)[^{]*\{[\s\S]*?nodeQueue\.add\s*\(\s*['"]([^'"]+)['"]/
      );

      expect(enqueueNodeMatch).not.toBeNull();
      expect(enqueueNodeMatch![1]).toBe("process-node");
    });

    test("does not use 'run-node' as job name", () => {
      const childEnqueueHandlerSource = readFileSync(
        join(engineDir, "handlers", "child-enqueue-handler.ts"),
        "utf-8"
      );

      // Verify 'run-node' is not used anywhere in nodeQueue.add calls
      const runNodeUsage = childEnqueueHandlerSource.match(
        /nodeQueue\.add\s*\(\s*['"]run-node['"]/
      );

      expect(runNodeUsage).toBeNull();
    });
  });

  describe("Job name consistency across components", () => {
    test("WorkflowEngine and ChildEnqueueHandler use the same job name for node processing (Requirements 4.1, 4.2, 4.3)", () => {
      const workflowEngineSource = readFileSync(
        join(engineDir, "workflow-engine.ts"),
        "utf-8"
      );
      const childEnqueueHandlerSource = readFileSync(
        join(engineDir, "handlers", "child-enqueue-handler.ts"),
        "utf-8"
      );

      // Extract job names from both files
      const workflowEngineJobNames = [
        ...workflowEngineSource.matchAll(/nodeQueue\.add\s*\(\s*['"]([^'"]+)['"]/g)
      ].map(match => match[1]).filter((name): name is string => name !== undefined);

      const handlerJobNames = [
        ...childEnqueueHandlerSource.matchAll(/nodeQueue\.add\s*\(\s*['"]([^'"]+)['"]/g)
      ].map(match => match[1]).filter((name): name is string => name !== undefined);

      // Valid job names: 'process-node' for node execution, 'emit-workflow-event' for event emission
      const validJobNames = ['process-node', 'emit-workflow-event'];

      expect(workflowEngineJobNames.length).toBeGreaterThan(0);
      expect(handlerJobNames.length).toBeGreaterThan(0);

      // All job names should be one of the valid types
      for (const jobName of workflowEngineJobNames) {
        expect(validJobNames).toContain(jobName);
      }

      for (const jobName of handlerJobNames) {
        expect(validJobNames).toContain(jobName);
      }

      // Verify 'process-node' is used for node processing in both components
      expect(workflowEngineJobNames).toContain("process-node");
      expect(handlerJobNames).toContain("process-node");
    });
  });
});

