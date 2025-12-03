import { describe, test, expect, spyOn } from "bun:test";
import { InMemoryExecutionStore } from "./inmemory-store";

describe("InMemoryExecutionStore workflow methods", () => {
  describe("getWorkflow", () => {
    test("returns null instead of throwing", async () => {
      const store = new InMemoryExecutionStore();
      
      const result = await store.getWorkflow("non-existent-workflow");
      
      expect(result).toBeNull();
    });

    test("returns null for any workflow ID", async () => {
      const store = new InMemoryExecutionStore();
      
      const result1 = await store.getWorkflow("workflow-1");
      const result2 = await store.getWorkflow("workflow-2", 1);
      
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe("saveWorkflow", () => {
    test("returns 0 without throwing", async () => {
      const store = new InMemoryExecutionStore();
      const workflow = { id: "test-workflow", nodes: [] };
      
      const result = await store.saveWorkflow(workflow);
      
      expect(result).toBe(0);
    });

    test("logs warning about no persistence", async () => {
      const store = new InMemoryExecutionStore();
      const workflow = { id: "test-workflow", nodes: [] };
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      
      await store.saveWorkflow(workflow, "test notes", "test-user");
      
      expect(warnSpy).toHaveBeenCalledWith(
        "InMemoryExecutionStore: Workflow not persisted (use DrizzleStore for persistence)"
      );
      
      warnSpy.mockRestore();
    });

    test("returns 0 regardless of workflow content", async () => {
      const store = new InMemoryExecutionStore();
      
      const result1 = await store.saveWorkflow({ id: "w1" });
      const result2 = await store.saveWorkflow({ id: "w2", nodes: [{ id: "n1" }] }, "notes");
      const result3 = await store.saveWorkflow(null);
      
      expect(result1).toBe(0);
      expect(result2).toBe(0);
      expect(result3).toBe(0);
    });
  });
});
