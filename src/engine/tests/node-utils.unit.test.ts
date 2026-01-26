/**
 * Unit tests for node execution utilities
 * 
 * These tests verify the pure functions in node-utils.ts.
 * 
 * @see engine/node-utils.ts
 */

import { describe, test, expect } from "bun:test";
import {
    resolveDuration,
    validateDuration,
    mergeParentInputs,
    applyInputMapping,
    applyOutputMapping,
    aggregateChildResults,
    createContinueOnFailResult,
    isNodeAlreadyProcessed,
    generateNodeJobId,
    extractRetryConfig,
    DEFAULT_RETRY_CONFIG,
} from "../node-utils";

describe("Stateless utilities", () => {
    describe("resolveDuration", () => {
        test("returns null for undefined config", () => {
            expect(resolveDuration(undefined)).toBeNull();
        });

        test("returns duration in ms when provided", () => {
            expect(resolveDuration({ duration: 5000 })).toBe(5000);
        });

        test("converts durationSeconds to ms", () => {
            expect(resolveDuration({ durationSeconds: 5 })).toBe(5000);
        });

        test("converts durationMinutes to ms", () => {
            expect(resolveDuration({ durationMinutes: 2 })).toBe(120000);
        });

        test("duration takes precedence over durationSeconds", () => {
            expect(resolveDuration({ duration: 1000, durationSeconds: 5 })).toBe(1000);
        });
    });

    describe("validateDuration", () => {
        test("returns error for null duration", () => {
            const result = validateDuration(null);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        test("returns error for negative duration", () => {
            const result = validateDuration(-1000);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        test("returns valid for positive duration", () => {
            const result = validateDuration(5000);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        test("returns warning for duration over 24 hours", () => {
            const result = validateDuration(25 * 60 * 60 * 1000);
            expect(result.valid).toBe(true);
            expect(result.warning).toBeDefined();
        });
    });

    describe("mergeParentInputs", () => {
        test("returns original input when no parents", () => {
            const result = mergeParentInputs({ foo: "bar" }, [], {});
            expect(result).toEqual({ foo: "bar" });
        });

        test("returns single parent data directly", () => {
            const result = mergeParentInputs(
                { original: true },
                ["parent1"],
                { parent1: { success: true, data: { fromParent: true } } }
            );
            expect(result).toEqual({ fromParent: true });
        });

        test("merges multiple parent data by node ID", () => {
            const result = mergeParentInputs(
                {},
                ["parent1", "parent2"],
                {
                    parent1: { success: true, data: { a: 1 } },
                    parent2: { success: true, data: { b: 2 } }
                }
            );
            expect(result).toEqual({ parent1: { a: 1 }, parent2: { b: 2 } });
        });
    });

    describe("applyInputMapping", () => {
        test("returns original data when no mapping", () => {
            const result = applyInputMapping({ foo: "bar" }, undefined);
            expect(result).toEqual({ foo: "bar" });
        });

        test("applies mapping correctly", () => {
            const result = applyInputMapping(
                { sourceKey: "value" },
                { targetKey: "sourceKey" }
            );
            expect(result).toEqual({ targetKey: "value" });
        });

        test("ignores missing source keys", () => {
            const result = applyInputMapping(
                { existing: "value" },
                { target: "missing" }
            );
            expect(result).toEqual({});
        });
    });

    describe("applyOutputMapping", () => {
        test("returns original data when no mapping", () => {
            const result = applyOutputMapping({ foo: "bar" }, undefined);
            expect(result).toEqual({ foo: "bar" });
        });

        test("applies mapping correctly", () => {
            const result = applyOutputMapping(
                { sourceKey: "value" },
                { targetKey: "sourceKey" }
            );
            expect(result).toEqual({ targetKey: "value" });
        });
    });

    describe("aggregateChildResults", () => {
        test("returns empty object for no children", () => {
            const result = aggregateChildResults({}, "exec-123");
            expect(result).toEqual({});
        });

        test("returns single child data directly", () => {
            const result = aggregateChildResults(
                { "node-execution:exec-123-node1": { success: true, data: { result: 1 } } },
                "exec-123"
            );
            expect(result).toEqual({ result: 1 });
        });

        test("aggregates multiple children by node ID", () => {
            const result = aggregateChildResults(
                {
                    "node-execution:exec-123-node1": { success: true, data: { a: 1 } },
                    "node-execution:exec-123-node2": { success: true, data: { b: 2 } }
                },
                "exec-123"
            );
            expect(result).toEqual({ node1: { a: 1 }, node2: { b: 2 } });
        });
    });

    describe("createContinueOnFailResult", () => {
        test("creates success result with error metadata", () => {
            const result = createContinueOnFailResult("Test error");
            expect(result.success).toBe(true);
            expect(result.error).toBe("Test error");
            expect(result.data._metadata.continuedOnFail).toBe(true);
            expect(result.data._metadata.originalError).toBe("Test error");
        });
    });

    describe("isNodeAlreadyProcessed", () => {
        test("returns false for undefined result", () => {
            expect(isNodeAlreadyProcessed(undefined)).toBe(false);
        });

        test("returns true for successful result", () => {
            expect(isNodeAlreadyProcessed({ success: true })).toBe(true);
        });

        test("returns true for skipped result", () => {
            expect(isNodeAlreadyProcessed({ success: false, skipped: true })).toBe(true);
        });

        test("returns false for failed result", () => {
            expect(isNodeAlreadyProcessed({ success: false })).toBe(false);
        });
    });

    describe("generateNodeJobId", () => {
        test("generates standard job ID", () => {
            const result = generateNodeJobId("exec-123", "node-1");
            expect(result).toBe("exec-123-node-node-1");
        });

        test("generates delay resume job ID", () => {
            const result = generateNodeJobId("exec-123", "node-1", "resumed");
            expect(result).toBe("exec-123-node-node-1-delay-resumed");
        });

        test("generates standard job ID for initial delay step", () => {
            const result = generateNodeJobId("exec-123", "node-1", "initial");
            expect(result).toBe("exec-123-node-node-1");
        });
    });

    describe("extractRetryConfig", () => {
        test("returns defaults when no policy", () => {
            const result = extractRetryConfig(undefined);
            expect(result.attempts).toBe(DEFAULT_RETRY_CONFIG.attempts);
            expect(result.backoff.type).toBe(DEFAULT_RETRY_CONFIG.backoff.type);
            expect(result.backoff.delay).toBe(DEFAULT_RETRY_CONFIG.backoff.delay);
        });

        test("extracts maxAttempts from policy", () => {
            const result = extractRetryConfig({ maxAttempts: 5 });
            expect(result.attempts).toBe(5);
        });

        test("extracts backoff from policy", () => {
            const result = extractRetryConfig({
                backoff: { type: "fixed", delay: 2000 }
            });
            expect(result.backoff.type).toBe("fixed");
            expect(result.backoff.delay).toBe(2000);
        });
    });

});
