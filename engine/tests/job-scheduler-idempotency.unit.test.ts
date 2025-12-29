import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { WorkflowEngine } from "../workflow-engine";
import type { EngineConfig } from "../config";

/**
 * Job Scheduler Idempotency Tests
 * 
 * Tests for BullMQ upsertJobScheduler idempotency behavior (FR-3: Job Schedulers)
 * - FR-3.1: Replace manual repeatable job management with upsertJobScheduler()
 * - FR-3.2: Idempotent schedule registration (no manual find/remove)
 * - FR-3.3: Support cron patterns with timezone
 * - FR-3.4: Support schedule updates without manual cleanup
 */

// Mock dependencies
const createMockRegistry = () => ({
    get: () => ({ execute: async () => ({ success: true, data: {} }) }),
    getRateLimit: () => null,
    getCircuitBreakerKey: () => null,
    isExternalNode: () => false,
});

const createMockStateStore = () => ({
    getWorkflow: mock(() => null),
    saveWorkflow: mock(() => Promise.resolve("version-1")),
    listWorkflows: mock(() => Promise.resolve([])),
    getExecution: mock(() => ({ status: 'running' })),
    createExecution: mock(() => Promise.resolve("exec-1")),
    updateNodeResult: mock(() => Promise.resolve()),
    getPendingNodeCount: mock(() => 0),
    setExecutionStatus: mock(() => Promise.resolve()),
    addLog: mock(() => Promise.resolve()),
});

const createMockRedis = () => ({
    incr: mock(() => 1),
    expire: mock(() => 1),
    set: mock(() => "OK"),
    del: mock(() => 1),
    eval: mock(() => 1),
    duplicate: mock(() => createMockRedis()),
});

// Track upsertJobScheduler calls for verification
let upsertCalls: Array<{ schedulerId: string; pattern: string; tz?: string; data: any }> = [];
let removeSchedulerCalls: string[] = [];
let schedulers: Map<string, { id: string; pattern?: string; tz?: string; next?: number }> = new Map();

const createMockQueueManager = () => ({
    nodeQueue: { 
        add: mock(() => Promise.resolve({ id: "job-1" })),
        getJobs: mock(() => Promise.resolve([])),
    },
    workflowQueue: {
        add: mock(() => Promise.resolve({ id: "job-1" })),
        getRepeatableJobs: mock(() => Promise.resolve([])),
        removeRepeatableByKey: mock(() => Promise.resolve()),
        upsertJobScheduler: mock((schedulerId: string, opts: any, template: any) => {
            upsertCalls.push({ 
                schedulerId, 
                pattern: opts.pattern, 
                tz: opts.tz, 
                data: template.data 
            });
            schedulers.set(schedulerId, { 
                id: schedulerId, 
                pattern: opts.pattern, 
                tz: opts.tz,
                next: Date.now() + 60000 
            });
            return Promise.resolve();
        }),
        getJobSchedulers: mock((start?: number, end?: number, asc?: boolean) => {
            return Promise.resolve(Array.from(schedulers.values()));
        }),
        getJobScheduler: mock((schedulerId: string) => {
            return Promise.resolve(schedulers.get(schedulerId) || null);
        }),
        removeJobScheduler: mock((schedulerId: string) => {
            removeSchedulerCalls.push(schedulerId);
            schedulers.delete(schedulerId);
            return Promise.resolve();
        }),
    },
    dlqQueue: {},
    nodeQueueEvents: { on: mock(() => {}) },
    resultCacheEvents: { on: mock(() => {}) },
    flowProducer: { close: mock(() => Promise.resolve()) },
    close: mock(() => Promise.resolve()),
    rateLimit: mock(() => Promise.resolve()),
});

describe("Job Scheduler Idempotency", () => {
    let mockRegistry: ReturnType<typeof createMockRegistry>;
    let mockStateStore: ReturnType<typeof createMockStateStore>;
    let mockRedis: ReturnType<typeof createMockRedis>;
    let mockQueueManager: ReturnType<typeof createMockQueueManager>;

    beforeEach(() => {
        mockRegistry = createMockRegistry();
        mockStateStore = createMockStateStore();
        mockRedis = createMockRedis();
        mockQueueManager = createMockQueueManager();
        upsertCalls = [];
        removeSchedulerCalls = [];
        schedulers.clear();
    });

    afterEach(() => {
        mock.restore();
    });

    describe("registerScheduleWithUpsert", () => {
        test("creates scheduler with correct ID format", async () => {
            const engine = createEngineWithMocks();
            
            await engine.registerScheduleWithUpsert("my-workflow", "0 * * * *");
            
            expect(upsertCalls.length).toBe(1);
            expect(upsertCalls[0].schedulerId).toBe("schedule:my-workflow:0 * * * *");
            expect(upsertCalls[0].pattern).toBe("0 * * * *");
            expect(upsertCalls[0].data).toEqual({ workflowId: "my-workflow" });
        });

        test("includes timezone when provided", async () => {
            const engine = createEngineWithMocks();
            
            await engine.registerScheduleWithUpsert("my-workflow", "0 9 * * *", "America/New_York");
            
            expect(upsertCalls.length).toBe(1);
            expect(upsertCalls[0].tz).toBe("America/New_York");
        });

        test("omits timezone when not provided", async () => {
            const engine = createEngineWithMocks();
            
            await engine.registerScheduleWithUpsert("my-workflow", "0 * * * *");
            
            expect(upsertCalls.length).toBe(1);
            expect(upsertCalls[0].tz).toBeUndefined();
        });

        test("calling twice with same parameters is idempotent", async () => {
            const engine = createEngineWithMocks();
            
            // Call twice with identical parameters
            await engine.registerScheduleWithUpsert("my-workflow", "0 * * * *");
            await engine.registerScheduleWithUpsert("my-workflow", "0 * * * *");
            
            // upsertJobScheduler should be called twice (BullMQ handles idempotency)
            expect(upsertCalls.length).toBe(2);
            
            // But only one scheduler should exist (same ID)
            expect(schedulers.size).toBe(1);
            expect(schedulers.has("schedule:my-workflow:0 * * * *")).toBe(true);
        });

        test("updating cron pattern creates new scheduler with different ID", async () => {
            const engine = createEngineWithMocks();
            
            // Register with one cron pattern
            await engine.registerScheduleWithUpsert("my-workflow", "0 * * * *");
            
            // Update to different cron pattern
            await engine.registerScheduleWithUpsert("my-workflow", "*/30 * * * *");
            
            // Two different schedulers should exist (different cron = different ID)
            expect(schedulers.size).toBe(2);
            expect(schedulers.has("schedule:my-workflow:0 * * * *")).toBe(true);
            expect(schedulers.has("schedule:my-workflow:*/30 * * * *")).toBe(true);
        });

        test("updating timezone for same cron updates existing scheduler", async () => {
            const engine = createEngineWithMocks();
            
            // Register with one timezone
            await engine.registerScheduleWithUpsert("my-workflow", "0 9 * * *", "America/New_York");
            
            // Update timezone (same cron pattern)
            await engine.registerScheduleWithUpsert("my-workflow", "0 9 * * *", "Europe/London");
            
            // Same scheduler ID, but timezone should be updated
            expect(schedulers.size).toBe(1);
            const scheduler = schedulers.get("schedule:my-workflow:0 9 * * *");
            expect(scheduler?.tz).toBe("Europe/London");
        });
    });

    describe("removeWorkflowSchedulers", () => {
        test("removes all schedulers for a workflow", async () => {
            const engine = createEngineWithMocks();
            
            // Create multiple schedulers for the same workflow
            await engine.registerScheduleWithUpsert("my-workflow", "0 * * * *");
            await engine.registerScheduleWithUpsert("my-workflow", "0 9 * * *");
            await engine.registerScheduleWithUpsert("other-workflow", "0 12 * * *");
            
            expect(schedulers.size).toBe(3);
            
            // Remove schedulers for my-workflow
            const removedCount = await engine.removeWorkflowSchedulers("my-workflow");
            
            expect(removedCount).toBe(2);
            expect(schedulers.size).toBe(1);
            expect(schedulers.has("schedule:other-workflow:0 12 * * *")).toBe(true);
        });

        test("returns 0 when no schedulers exist for workflow", async () => {
            const engine = createEngineWithMocks();
            
            const removedCount = await engine.removeWorkflowSchedulers("non-existent");
            
            expect(removedCount).toBe(0);
        });
    });

    describe("getJobSchedulers", () => {
        test("returns all active schedulers", async () => {
            const engine = createEngineWithMocks();
            
            await engine.registerScheduleWithUpsert("wf-1", "0 * * * *");
            await engine.registerScheduleWithUpsert("wf-2", "0 9 * * *", "UTC");
            
            const result = await engine.getJobSchedulers();
            
            expect(result.length).toBe(2);
            expect(result.some(s => s.id === "schedule:wf-1:0 * * * *")).toBe(true);
            expect(result.some(s => s.id === "schedule:wf-2:0 9 * * *")).toBe(true);
        });
    });

    describe("getJobScheduler", () => {
        test("returns scheduler by ID", async () => {
            const engine = createEngineWithMocks();
            
            await engine.registerScheduleWithUpsert("my-workflow", "0 * * * *");
            
            const scheduler = await engine.getJobScheduler("schedule:my-workflow:0 * * * *");
            
            expect(scheduler).not.toBeNull();
            expect(scheduler?.id).toBe("schedule:my-workflow:0 * * * *");
            expect(scheduler?.pattern).toBe("0 * * * *");
        });

        test("returns null for non-existent scheduler", async () => {
            const engine = createEngineWithMocks();
            
            const scheduler = await engine.getJobScheduler("non-existent");
            
            expect(scheduler).toBeNull();
        });
    });

    describe("registerWorkflow schedule handling", () => {
        test("uses upsertJobScheduler for schedule triggers", async () => {
            const engine = createEngineWithMocks({ useJobSchedulers: true });
            
            const workflow = {
                id: "scheduled-workflow",
                nodes: [{ id: "node-1", type: "test", config: {}, inputs: [], outputs: [] }],
                triggers: [
                    { type: "schedule" as const, config: { cron: "0 * * * *" } }
                ]
            };
            
            await engine.registerWorkflow(workflow);
            
            expect(upsertCalls.length).toBe(1);
            expect(upsertCalls[0].schedulerId).toBe("schedule:scheduled-workflow:0 * * * *");
        });

        test("always uses upsertJobScheduler regardless of flag (legacy code removed)", async () => {
            // Even with flag disabled, upsertJobScheduler is used since legacy code was removed
            const engine = createEngineWithMocks({ useJobSchedulers: false });
            
            const workflow = {
                id: "scheduled-workflow",
                nodes: [{ id: "node-1", type: "test", config: {}, inputs: [], outputs: [] }],
                triggers: [
                    { type: "schedule" as const, config: { cron: "0 * * * *" } }
                ]
            };
            
            await engine.registerWorkflow(workflow);
            
            // upsertJobScheduler should be called (legacy code removed)
            expect(upsertCalls.length).toBe(1);
            expect(upsertCalls[0].schedulerId).toBe("schedule:scheduled-workflow:0 * * * *");
        });

        test("handles multiple schedule triggers", async () => {
            const engine = createEngineWithMocks({ useJobSchedulers: true });
            
            const workflow = {
                id: "multi-schedule",
                nodes: [{ id: "node-1", type: "test", config: {}, inputs: [], outputs: [] }],
                triggers: [
                    { type: "schedule" as const, config: { cron: "0 * * * *" } },
                    { type: "schedule" as const, config: { cron: "0 9 * * *", timezone: "UTC" } }
                ]
            };
            
            await engine.registerWorkflow(workflow);
            
            expect(upsertCalls.length).toBe(2);
            expect(schedulers.size).toBe(2);
        });
    });

    // Helper to create engine with mocked dependencies
    function createEngineWithMocks(config: Partial<EngineConfig> = {}) {
        // Create a minimal engine instance with mocked queue manager
        const engine = Object.create(WorkflowEngine.prototype);
        
        // Set up private properties
        engine.config = { useJobSchedulers: false, ...config };
        engine.stateStore = mockStateStore;
        engine.queueManager = mockQueueManager;
        engine.workflowCache = new Map();
        
        return engine;
    }
});
