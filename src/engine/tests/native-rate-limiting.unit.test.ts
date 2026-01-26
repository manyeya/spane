import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { NodeProcessor } from "../node-processor";
import { WorkerManager, isRateLimitError, RateLimitError } from "../worker-manager";
import type { EngineConfig } from "../config";

/**
 * Native Rate Limiting Tests
 * 
 * Tests for BullMQ native rate limiting behavior (FR-2: Native Rate Limiting)
 * - FR-2.1: Replace custom Redis INCR/EXPIRE rate limiting with BullMQ Worker limiter
 * - FR-2.2: Support per-node-type rate limits via worker configuration
 * - FR-2.3: Support manual rate limiting with worker.rateLimit() for external API responses
 * - FR-2.4: Maintain rate limit configuration in NodeRegistry
 */

// Mock dependencies
const createMockRegistry = (rateLimit: number | null = null) => ({
    get: () => ({ execute: async () => ({ success: true, data: {} }) }),
    getRateLimit: () => rateLimit,
    getCircuitBreakerKey: () => null,
    isExternalNode: () => false,
});

const createMockStateStore = () => ({
    getWorkflow: mock(() => null),
    getNodeResults: mock(() => ({})),
    getExecution: mock(() => ({ status: 'running' })),
    updateNodeResult: mock(() => Promise.resolve()),
    getPendingNodeCount: mock(() => 0),
    setExecutionStatus: mock(() => Promise.resolve()),
});

const createMockRedis = () => ({
    incr: mock(() => 1),
    expire: mock(() => 1),
    set: mock(() => "OK"),
    del: mock(() => 1),
    eval: mock(() => 1),
});

const createMockQueueManager = () => ({
    nodeQueue: { add: mock(() => Promise.resolve()) },
    rateLimit: mock(() => Promise.resolve()),
});

describe("Native Rate Limiting", () => {
    describe("isRateLimitError helper", () => {
        test("returns true for RateLimitError instance", () => {
            const error = new RateLimitError();
            expect(isRateLimitError(error)).toBe(true);
        });

        test("returns true for error with name 'RateLimitError'", () => {
            const error = new Error("Rate limited");
            error.name = "RateLimitError";
            expect(isRateLimitError(error)).toBe(true);
        });

        test("returns false for regular Error", () => {
            const error = new Error("Some other error");
            expect(isRateLimitError(error)).toBe(false);
        });

        test("returns false for DelayedError-like errors", () => {
            const error = new Error("Delayed");
            error.name = "DelayedError";
            expect(isRateLimitError(error)).toBe(false);
        });
    });

    describe("Custom rate limiting removed", () => {
        let processor: NodeProcessor;
        let mockRedis: ReturnType<typeof createMockRedis>;
        let mockStateStore: ReturnType<typeof createMockStateStore>;
        let mockQueueManager: ReturnType<typeof createMockQueueManager>;
        const mockWorkflows = new Map();
        const mockEnqueueWorkflow = mock(() => Promise.resolve("child-id"));

        beforeEach(() => {
            mockRedis = createMockRedis();
            mockStateStore = createMockStateStore();
            mockQueueManager = createMockQueueManager();
            mockWorkflows.clear();
        });

        afterEach(() => {
            mock.restore();
        });

        test("does not use custom Redis rate limiting (removed in cleanup)", async () => {
            const workflowId = "wf-native-rate";
            const nodeId = "node-rate";
            const executionId = "exec-rate";

            // Registry with rate limit configured
            const mockRegistry = createMockRegistry(10); // 10 per second

            // Engine config - native rate limiting is now the only option
            const engineConfig: EngineConfig = {
                useNativeRateLimiting: true,
                rateLimiter: { max: 10, duration: 1000 },
            };

            processor = new NodeProcessor(
                mockRegistry as any,
                mockStateStore as any,
                mockRedis as any,
                mockQueueManager as any,
                mockWorkflows,
                mockEnqueueWorkflow,
                engineConfig
            );

            const workflow = {
                id: workflowId,
                nodes: [{
                    id: nodeId,
                    type: "test-node",
                    config: {},
                    inputs: [],
                    outputs: []
                }],
                entryNodeId: nodeId
            };
            mockWorkflows.set(workflowId, workflow);

            const job = {
                id: "job-rate-1",
                data: {},
                attemptsMade: 1,
                opts: { attempts: 3 },
                token: "token",
                updateProgress: mock(() => Promise.resolve()),
                log: mock(() => Promise.resolve()),
                moveToDelayed: mock(() => Promise.resolve()),
            };

            const data = { executionId, workflowId, nodeId, inputData: {} };

            await processor.processNodeJob(data as any, job as any);

            // Redis INCR should NOT be called - custom rate limiting has been removed
            // Rate limiting is now handled at the Worker level via BullMQ's native limiter
            expect(mockRedis.incr).not.toHaveBeenCalled();
            expect(mockRedis.expire).not.toHaveBeenCalled();
        });

        test("does not use custom Redis rate limiting even without config flag", async () => {
            const workflowId = "wf-no-flag";
            const nodeId = "node-rate";
            const executionId = "exec-no-flag";

            // Registry with rate limit configured
            const mockRegistry = createMockRegistry(10); // 10 per second

            // Engine config without useNativeRateLimiting flag
            // Custom rate limiting code has been removed, so this should still not call Redis
            const engineConfig: EngineConfig = {};

            processor = new NodeProcessor(
                mockRegistry as any,
                mockStateStore as any,
                mockRedis as any,
                mockQueueManager as any,
                mockWorkflows,
                mockEnqueueWorkflow,
                engineConfig
            );

            const workflow = {
                id: workflowId,
                nodes: [{
                    id: nodeId,
                    type: "test-node",
                    config: {},
                    inputs: [],
                    outputs: []
                }],
                entryNodeId: nodeId
            };
            mockWorkflows.set(workflowId, workflow);

            const job = {
                id: "job-rate-2",
                data: {},
                attemptsMade: 1,
                opts: { attempts: 3 },
                token: "token",
                updateProgress: mock(() => Promise.resolve()),
                log: mock(() => Promise.resolve()),
                moveToDelayed: mock(() => Promise.resolve()),
            };

            const data = { executionId, workflowId, nodeId, inputData: {} };

            await processor.processNodeJob(data as any, job as any);

            // Redis INCR should NOT be called - custom rate limiting has been removed
            expect(mockRedis.incr).not.toHaveBeenCalled();
            expect(mockRedis.expire).not.toHaveBeenCalled();
        });
    });

    describe("Manual rate limiting for external nodes", () => {
        let processor: NodeProcessor;
        let mockRedis: ReturnType<typeof createMockRedis>;
        let mockStateStore: ReturnType<typeof createMockStateStore>;
        let mockQueueManager: ReturnType<typeof createMockQueueManager>;
        const mockWorkflows = new Map();
        const mockEnqueueWorkflow = mock(() => Promise.resolve("child-id"));

        beforeEach(() => {
            mockRedis = createMockRedis();
            mockStateStore = createMockStateStore();
            mockQueueManager = createMockQueueManager();
            mockWorkflows.clear();
        });

        afterEach(() => {
            mock.restore();
        });

        test("provides rateLimit function to external node executors", async () => {
            const workflowId = "wf-external";
            const nodeId = "node-http";
            const executionId = "exec-external";

            let capturedContext: any = null;

            // Registry that marks http as external node
            const mockRegistry = {
                get: () => ({
                    execute: async (ctx: any) => {
                        capturedContext = ctx;
                        return { success: true, data: {} };
                    }
                }),
                getRateLimit: () => null,
                getCircuitBreakerKey: () => null,
                isExternalNode: (type: string) => type === 'http',
            };

            const engineConfig: EngineConfig = {
                useNativeRateLimiting: true,
            };

            processor = new NodeProcessor(
                mockRegistry as any,
                mockStateStore as any,
                mockRedis as any,
                mockQueueManager as any,
                mockWorkflows,
                mockEnqueueWorkflow,
                engineConfig
            );

            const workflow = {
                id: workflowId,
                nodes: [{
                    id: nodeId,
                    type: "http",
                    config: { url: "https://api.example.com" },
                    inputs: [],
                    outputs: []
                }],
                entryNodeId: nodeId
            };
            mockWorkflows.set(workflowId, workflow);

            const job = {
                id: "job-external",
                data: {},
                attemptsMade: 1,
                opts: { attempts: 3 },
                token: "token",
                updateProgress: mock(() => Promise.resolve()),
                log: mock(() => Promise.resolve()),
            };

            const data = { executionId, workflowId, nodeId, inputData: {} };

            await processor.processNodeJob(data as any, job as any);

            // Verify rateLimit function was provided in context
            expect(capturedContext).not.toBeNull();
            expect(typeof capturedContext.rateLimit).toBe("function");
        });

        test("rateLimit function calls queueManager.rateLimit and returns RateLimitError", async () => {
            const workflowId = "wf-manual-rate";
            const nodeId = "node-http";
            const executionId = "exec-manual";

            let capturedRateLimitFn: any = null;

            const mockRegistry = {
                get: () => ({
                    execute: async (ctx: any) => {
                        capturedRateLimitFn = ctx.rateLimit;
                        return { success: true, data: {} };
                    }
                }),
                getRateLimit: () => null,
                getCircuitBreakerKey: () => null,
                isExternalNode: (type: string) => type === 'http',
            };

            const engineConfig: EngineConfig = {
                useNativeRateLimiting: true,
            };

            processor = new NodeProcessor(
                mockRegistry as any,
                mockStateStore as any,
                mockRedis as any,
                mockQueueManager as any,
                mockWorkflows,
                mockEnqueueWorkflow,
                engineConfig
            );

            const workflow = {
                id: workflowId,
                nodes: [{
                    id: nodeId,
                    type: "http",
                    config: {},
                    inputs: [],
                    outputs: []
                }],
                entryNodeId: nodeId
            };
            mockWorkflows.set(workflowId, workflow);

            const job = {
                id: "job-manual",
                data: {},
                attemptsMade: 1,
                opts: { attempts: 3 },
                token: "token",
                updateProgress: mock(() => Promise.resolve()),
                log: mock(() => Promise.resolve()),
            };

            const data = { executionId, workflowId, nodeId, inputData: {} };

            await processor.processNodeJob(data as any, job as any);

            // Call the captured rateLimit function
            expect(capturedRateLimitFn).not.toBeNull();
            const error = await capturedRateLimitFn(5000);

            // Verify queueManager.rateLimit was called with correct duration
            expect(mockQueueManager.rateLimit).toHaveBeenCalledWith(5000);

            // Verify it returns a RateLimitError
            expect(isRateLimitError(error)).toBe(true);
        });


    });

    describe("WorkerManager rate limit configuration", () => {
        test("WorkerManager.getRateLimitError returns RateLimitError", () => {
            const error = WorkerManager.getRateLimitError();
            expect(isRateLimitError(error)).toBe(true);
        });
    });
});
