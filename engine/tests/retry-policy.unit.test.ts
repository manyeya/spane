import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { NodeProcessor } from "../node-processor";
import { WorkflowEventEmitter } from "../event-emitter";

// Mock dependencies
const mockRegistry = { get: () => ({ execute: async () => { throw new Error("Mock failure"); } }), getRateLimit: () => null, getCircuitBreakerKey: () => null };
const mockStateStore = {
    getWorkflow: mock(() => null),
    getNodeResults: mock(() => ({})),
    getExecution: mock(() => ({ status: 'running' })),
    updateNodeResult: mock(() => Promise.resolve()),
    getPendingNodeCount: mock(() => 0),
    setExecutionStatus: mock(() => Promise.resolve()),
};
const mockRedis = {
    incr: mock(() => 1),
    expire: mock(() => 1),
    set: mock(() => "OK"),
    del: mock(() => 1),
    eval: mock(() => 1)
};
const mockQueueManager = { nodeQueue: { add: mock(() => Promise.resolve()) } };
const mockWorkflows = new Map();
const mockEnqueueWorkflow = mock(() => Promise.resolve("child-id"));

describe("Retry Policy Logic", () => {
    let processor: NodeProcessor;

    beforeEach(() => {
        processor = new NodeProcessor(
            mockRegistry as any,
            mockStateStore as any,
            mockRedis as any,
            mockQueueManager as any,
            mockWorkflows,
            mockEnqueueWorkflow
        );
        mockWorkflows.clear();
        mockQueueManager.nodeQueue.add.mockClear();
        // @ts-ignore
        mockStateStore.updateNodeResult.mockClear();
    });

    afterEach(() => {
        mock.restore();
    });

    test("enqueueNode respects retry policy from node config", async () => {
        const workflowId = "wf-retry";
        const nodeId = "node-retry";

        const workflow = {
            id: workflowId,
            nodes: [{
                id: nodeId,
                type: "test-node",
                config: {
                    retryPolicy: {
                        maxAttempts: 5,
                        backoff: { type: 'fixed', delay: 500 }
                    }
                },
                inputs: [],
                outputs: []
            }],
            entryNodeId: nodeId
        };

        // Cache the workflow so getWorkflowWithLazyLoad finds it
        mockWorkflows.set(workflowId, workflow);

        // @ts-ignore call private method via casting or just public usage if exposed? 
        // enqueueNode is private. We can test it by simulating where it is called? 
        // Or access via any.
        await (processor as any).enqueueNode("exec-1", workflowId, nodeId);

        expect(mockQueueManager.nodeQueue.add).toHaveBeenCalled();
        const callArgs = mockQueueManager.nodeQueue.add.mock.lastCall;
        const options = callArgs[2];

        expect(options.attempts).toBe(5);
        expect(options.backoff).toEqual({ type: 'fixed', delay: 500 });
    });

    test("enqueueNode falls back to defaults when no policy", async () => {
        const workflowId = "wf-default";
        const nodeId = "node-default";

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
        await (processor as any).enqueueNode("exec-1", workflowId, nodeId);

        const callArgs = mockQueueManager.nodeQueue.add.mock.lastCall;
        const options = callArgs[2];

        expect(options.attempts).toBe(3); // Default
        expect(options.backoff.delay).toBe(1000); // Default
    });

    test("processNodeJob respects continueOnFail on last attempt", async () => {
        const workflowId = "wf-continue";
        const nodeId = "node-continue";
        const executionId = "exec-continue";

        const workflow = {
            id: workflowId,
            nodes: [{
                id: nodeId,
                type: "test-node",
                config: {
                    retryPolicy: { maxAttempts: 3, continueOnFail: true }
                },
                inputs: [],
                outputs: []
            }],
            entryNodeId: nodeId
        };
        mockWorkflows.set(workflowId, workflow);

        // Mock event emitter
        spyOn(WorkflowEventEmitter, "emitNodeCompleted").mockReturnValue(Promise.resolve());
        spyOn(WorkflowEventEmitter, "emitNodeFailed").mockReturnValue(Promise.resolve());

        const job = {
            id: "job-1",
            data: {},
            attemptsMade: 3, // This is >= maxAttempts (3) if 1-based?? 
            // Wait, logic was: attemptMade + 1 >= maxAttempts if 0-based.
            // If logic assumes attemptMade is 1-based (from BullMQ docs?), then attemptsMade >= maxAttempts.
            // Let's set attemptsMade = 3. 3 >= 3 is true.
            opts: { attempts: 3 },
            token: "token",
            updateProgress: mock(() => Promise.resolve()),
            log: mock(() => Promise.resolve())
        };

        const data = { executionId, workflowId, nodeId, inputData: {} };

        // Mock state store to return execution
        mockStateStore.getExecution.mockResolvedValue({ status: 'running' });
        // Mock registry to return failing executor
        mockRegistry.get = () => ({ execute: async () => { throw new Error("Always Fail"); } });

        const result = await processor.processNodeJob(data as any, job as any);

        expect(result.success).toBe(true);
        expect(result.data.error).toBe("Always Fail");
        expect(result.data._metadata.continuedOnFail).toBe(true);

        expect(WorkflowEventEmitter.emitNodeCompleted).toHaveBeenCalled();
        expect(WorkflowEventEmitter.emitNodeFailed).not.toHaveBeenCalled();
    });

    test("processNodeJob fails normally if continueOnFail false", async () => {
        const workflowId = "wf-fail";
        const nodeId = "node-fail";

        const workflow = {
            id: workflowId,
            nodes: [{
                id: nodeId,
                type: "test-node",
                config: {
                    retryPolicy: { maxAttempts: 3, continueOnFail: false }
                },
                inputs: [],
                outputs: []
            }],
            entryNodeId: nodeId
        };
        mockWorkflows.set(workflowId, workflow);

        spyOn(WorkflowEventEmitter, "emitNodeCompleted").mockReturnValue(Promise.resolve());
        spyOn(WorkflowEventEmitter, "emitNodeFailed").mockReturnValue(Promise.resolve());

        const job = {
            id: "job-2",
            data: {},
            attemptsMade: 3,
            opts: { attempts: 3 },
            token: "token",
            updateProgress: mock(() => Promise.resolve()),
            log: mock(() => Promise.resolve())
        };

        const data = { executionId: "exec-fail", workflowId, nodeId, inputData: {} };

        mockStateStore.getExecution.mockResolvedValue({ status: 'running' });
        mockRegistry.get = () => ({ execute: async () => { throw new Error("Fatal Error"); } });

        // Should throw
        try {
            await processor.processNodeJob(data as any, job as any);
            expect(true).toBe(false); // Should not reach here
        } catch (e) {
            expect(e.message).toBe("Fatal Error");
        }

        expect(WorkflowEventEmitter.emitNodeFailed).toHaveBeenCalled();
    });
});
