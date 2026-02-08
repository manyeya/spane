import { describe, test, expect } from "bun:test";
import { InMemoryExecutionStore } from "./inmemory-store";

describe("InMemoryExecutionStore workflow methods", () => {
  describe("getWorkflow", () => {
    test("returns null instead of throwing", async () => {
      const store = new InMemoryExecutionStore({ enableCleanup: false });

      const result = await store.getWorkflow("non-existent-workflow");

      expect(result).toBeNull();
    });

    test("returns null for any workflow ID", async () => {
      const store = new InMemoryExecutionStore({ enableCleanup: false });

      const result1 = await store.getWorkflow("workflow-1");
      const result2 = await store.getWorkflow("workflow-2", 1);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe("saveWorkflow", () => {
    test("returns 0 without throwing", async () => {
      const store = new InMemoryExecutionStore({ enableCleanup: false });
      const workflow = { id: "test-workflow", nodes: [] };

      const result = await store.saveWorkflow(workflow);

      expect(result).toBe(0);
    });

    test("returns 0 regardless of workflow content", async () => {
      const store = new InMemoryExecutionStore({ enableCleanup: false });

      const result1 = await store.saveWorkflow({ id: "w1" });
      const result2 = await store.saveWorkflow({ id: "w2", nodes: [{ id: "n1" }] }, "notes");
      const result3 = await store.saveWorkflow(null);

      expect(result1).toBe(0);
      expect(result2).toBe(0);
      expect(result3).toBe(0);
    });
  });
});
