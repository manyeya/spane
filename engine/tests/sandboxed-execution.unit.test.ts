/**
 * Unit tests for sandboxed execution functionality
 * 
 * These tests verify the serialization utilities, sandboxed processor exports,
 * and worker manager configuration for BullMQ worker threads.
 * 
 * @see engine/processors/node-processor.sandbox.ts
 * @see engine/processors/serialization.ts
 * @see engine/worker-manager.ts
 */

import { describe, test, expect } from "bun:test";
import {
    serializeJobData,
    deserializeJobData,
    serializeExecutionResult,
    deserializeExecutionResult,
    validateSerializable,
    isSerializable,
    cloneJobData,
    sanitizeForSerialization,
} from "../processors/serialization";
import type { NodeJobData } from "../types";
import type { ExecutionResult } from "../../types";

describe("Serialization utilities for sandboxed execution", () => {
    describe("serializeJobData / deserializeJobData", () => {
        test("handles basic job data round-trip", () => {
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: { foo: "bar", count: 42 },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.executionId).toBe(jobData.executionId);
            expect(deserialized.workflowId).toBe(jobData.workflowId);
            expect(deserialized.nodeId).toBe(jobData.nodeId);
            expect(deserialized.inputData).toEqual(jobData.inputData);
        });

        test("handles Date objects in job data", () => {
            const now = new Date();
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: { timestamp: now },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.inputData.timestamp).toBeInstanceOf(Date);
            expect(deserialized.inputData.timestamp.getTime()).toBe(now.getTime());
        });

        test("handles nested objects in job data", () => {
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: {
                    user: {
                        name: "Test",
                        settings: {
                            theme: "dark",
                            notifications: true,
                        },
                    },
                },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.inputData.user.name).toBe("Test");
            expect(deserialized.inputData.user.settings.theme).toBe("dark");
            expect(deserialized.inputData.user.settings.notifications).toBe(true);
        });

        test("handles arrays in job data", () => {
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: {
                    items: [1, 2, 3],
                    tags: ["a", "b", "c"],
                },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.inputData.items).toEqual([1, 2, 3]);
            expect(deserialized.inputData.tags).toEqual(["a", "b", "c"]);
        });

        test("handles null and undefined values", () => {
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: {
                    nullValue: null,
                    undefinedValue: undefined,
                },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.inputData.nullValue).toBeNull();
            expect(deserialized.inputData.undefinedValue).toBeUndefined();
        });

        test("handles BigInt values", () => {
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: {
                    bigNumber: BigInt("9007199254740993"),
                },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.inputData.bigNumber).toBe(BigInt("9007199254740993"));
        });

        test("handles Buffer values", () => {
            const buffer = Buffer.from("hello world");
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: {
                    data: buffer,
                },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(Buffer.isBuffer(deserialized.inputData.data)).toBe(true);
            expect(deserialized.inputData.data.toString()).toBe("hello world");
        });
    });

    describe("serializeExecutionResult / deserializeExecutionResult", () => {
        test("handles successful result round-trip", () => {
            const result: ExecutionResult = {
                success: true,
                data: { output: "test result" },
            };

            const serialized = serializeExecutionResult(result);
            const deserialized = deserializeExecutionResult(serialized);

            expect(deserialized.success).toBe(true);
            expect(deserialized.data).toEqual({ output: "test result" });
        });

        test("handles failed result with error", () => {
            const result: ExecutionResult = {
                success: false,
                error: "Something went wrong",
            };

            const serialized = serializeExecutionResult(result);
            const deserialized = deserializeExecutionResult(serialized);

            expect(deserialized.success).toBe(false);
            expect(deserialized.error).toBe("Something went wrong");
        });

        test("handles result with Date in data", () => {
            const timestamp = new Date();
            const result: ExecutionResult = {
                success: true,
                data: { completedAt: timestamp },
            };

            const serialized = serializeExecutionResult(result);
            const deserialized = deserializeExecutionResult(serialized);

            expect(deserialized.data.completedAt).toBeInstanceOf(Date);
            expect(deserialized.data.completedAt.getTime()).toBe(timestamp.getTime());
        });

        test("handles skipped result", () => {
            const result: ExecutionResult = {
                success: false,
                skipped: true,
            };

            const serialized = serializeExecutionResult(result);
            const deserialized = deserializeExecutionResult(serialized);

            expect(deserialized.success).toBe(false);
            expect(deserialized.skipped).toBe(true);
        });
    });

    describe("Error serialization", () => {
        test("serializes and deserializes Error objects", () => {
            const error = new Error("Test error message");
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: { error },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.inputData.error).toBeInstanceOf(Error);
            expect(deserialized.inputData.error.message).toBe("Test error message");
        });

        test("preserves error name", () => {
            const error = new TypeError("Type mismatch");
            const jobData: NodeJobData = {
                executionId: "exec-123",
                workflowId: "workflow-1",
                nodeId: "node-1",
                inputData: { error },
            };

            const serialized = serializeJobData(jobData);
            const deserialized = deserializeJobData(serialized);

            expect(deserialized.inputData.error.name).toBe("TypeError");
            expect(deserialized.inputData.error.message).toBe("Type mismatch");
        });
    });

    describe("validateSerializable", () => {
        test("returns empty array for serializable data", () => {
            const data = {
                string: "test",
                number: 42,
                boolean: true,
                array: [1, 2, 3],
                nested: { foo: "bar" },
            };

            const issues = validateSerializable(data);
            expect(issues).toEqual([]);
        });

        test("detects functions", () => {
            const data = {
                callback: () => console.log("test"),
            };

            const issues = validateSerializable(data);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]).toContain("Functions cannot be serialized");
        });

        test("detects symbols", () => {
            const data = {
                sym: Symbol("test"),
            };

            const issues = validateSerializable(data);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]).toContain("Symbol");
        });

        test("detects circular references", () => {
            const data: any = { name: "test" };
            data.self = data;

            const issues = validateSerializable(data);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]).toContain("Circular");
        });

        test("detects WeakMap", () => {
            const data = {
                weakMap: new WeakMap(),
            };

            const issues = validateSerializable(data);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]).toContain("WeakMap");
        });

        test("detects WeakSet", () => {
            const data = {
                weakSet: new WeakSet(),
            };

            const issues = validateSerializable(data);
            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]).toContain("WeakSet");
        });
    });

    describe("isSerializable", () => {
        test("returns true for serializable data", () => {
            const data = { foo: "bar", count: 42 };
            expect(isSerializable(data)).toBe(true);
        });

        test("returns false for data with functions", () => {
            const data = { fn: () => {} };
            expect(isSerializable(data)).toBe(false);
        });

        test("returns false for data with circular references", () => {
            const data: any = {};
            data.self = data;
            expect(isSerializable(data)).toBe(false);
        });
    });

    describe("cloneJobData", () => {
        test("creates deep clone of job data", () => {
            const original = {
                executionId: "exec-123",
                nested: { value: 42 },
            };

            const cloned = cloneJobData(original);

            // Modify original
            original.nested.value = 100;

            // Clone should be unaffected
            expect(cloned.nested.value).toBe(42);
        });

        test("preserves Date objects in clone", () => {
            const now = new Date();
            const original = { timestamp: now };

            const cloned = cloneJobData(original);

            expect(cloned.timestamp).toBeInstanceOf(Date);
            expect(cloned.timestamp.getTime()).toBe(now.getTime());
        });
    });

    describe("sanitizeForSerialization", () => {
        test("removes functions from data", () => {
            const data = {
                name: "test",
                callback: () => console.log("test"),
            };

            const sanitized = sanitizeForSerialization(data);

            expect(sanitized.name).toBe("test");
            expect(sanitized.callback).toBeUndefined();
        });

        test("handles circular references gracefully", () => {
            const data: any = { name: "test" };
            data.self = data;

            const sanitized = sanitizeForSerialization(data);

            expect(sanitized.name).toBe("test");
            expect(sanitized.self).toBeNull(); // Circular ref replaced with null
        });

        test("preserves serializable data", () => {
            const data = {
                string: "test",
                number: 42,
                array: [1, 2, 3],
            };

            const sanitized = sanitizeForSerialization(data);

            expect(sanitized).toEqual(data);
        });
    });
});

describe("Map and Set serialization", () => {
    test("serializes and deserializes Map", () => {
        const map = new Map<string, number>();
        map.set("a", 1);
        map.set("b", 2);

        const jobData: NodeJobData = {
            executionId: "exec-123",
            workflowId: "workflow-1",
            nodeId: "node-1",
            inputData: { map },
        };

        const serialized = serializeJobData(jobData);
        const deserialized = deserializeJobData(serialized);

        expect(deserialized.inputData.map).toBeInstanceOf(Map);
        expect(deserialized.inputData.map.get("a")).toBe(1);
        expect(deserialized.inputData.map.get("b")).toBe(2);
    });

    test("serializes and deserializes Set", () => {
        const set = new Set([1, 2, 3]);

        const jobData: NodeJobData = {
            executionId: "exec-123",
            workflowId: "workflow-1",
            nodeId: "node-1",
            inputData: { set },
        };

        const serialized = serializeJobData(jobData);
        const deserialized = deserializeJobData(serialized);

        expect(deserialized.inputData.set).toBeInstanceOf(Set);
        expect(deserialized.inputData.set.has(1)).toBe(true);
        expect(deserialized.inputData.set.has(2)).toBe(true);
        expect(deserialized.inputData.set.has(3)).toBe(true);
    });
});

describe("Sandboxed processor module exports", () => {
    test("exports stateless utilities from processors index", async () => {
        // Import from the processors index which re-exports stateless utilities
        const processorsModule = await import("../processors/index");

        // Verify stateless utilities are exported
        expect(typeof processorsModule.resolveDuration).toBe("function");
        expect(typeof processorsModule.validateDuration).toBe("function");
        expect(typeof processorsModule.mergeParentInputs).toBe("function");
        expect(typeof processorsModule.applyInputMapping).toBe("function");
        expect(typeof processorsModule.applyOutputMapping).toBe("function");
        expect(typeof processorsModule.aggregateChildResults).toBe("function");
        expect(typeof processorsModule.createContinueOnFailResult).toBe("function");
        expect(typeof processorsModule.isNodeAlreadyProcessed).toBe("function");
        expect(typeof processorsModule.generateNodeJobId).toBe("function");
        expect(typeof processorsModule.extractRetryConfig).toBe("function");
        expect(typeof processorsModule.getCircuitBreakerOptions).toBe("function");
    });

    test("exports serialization utilities from processors index", async () => {
        const processorsModule = await import("../processors/index");

        // Verify serialization utilities are exported
        expect(typeof processorsModule.deserializeJobData).toBe("function");
        expect(typeof processorsModule.serializeExecutionResult).toBe("function");
        expect(typeof processorsModule.validateSerializable).toBe("function");
        expect(typeof processorsModule.isSerializable).toBe("function");
        expect(typeof processorsModule.sanitizeForSerialization).toBe("function");
    });

    test("exports default constants from processors index", async () => {
        const processorsModule = await import("../processors/index");

        expect(processorsModule.DEFAULT_CIRCUIT_BREAKER_OPTIONS).toBeDefined();
        expect(processorsModule.DEFAULT_RETRY_CONFIG).toBeDefined();
    });
});

describe("Worker manager sandboxed configuration", () => {
    test("isRateLimitError correctly identifies RateLimitError", async () => {
        const { isRateLimitError, RateLimitError } = await import("../worker-manager");

        // Create a mock RateLimitError
        const rateLimitErr = new Error("Rate limit exceeded");
        rateLimitErr.name = "RateLimitError";

        expect(isRateLimitError(rateLimitErr)).toBe(true);
    });

    test("isRateLimitError returns false for regular errors", async () => {
        const { isRateLimitError } = await import("../worker-manager");

        const regularErr = new Error("Regular error");
        expect(isRateLimitError(regularErr)).toBe(false);
    });
});
