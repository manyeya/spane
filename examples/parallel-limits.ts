import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import { Redis } from 'ioredis';
import type { WorkflowDefinition, ExecutionContext, ExecutionResult } from '../types';

// 1. Setup
const redis = new Redis({ maxRetriesPerRequest: null });
const registry = new NodeRegistry();
const store = new InMemoryExecutionStore();
const engine = new WorkflowEngine(registry, store, redis);

// 2. Register Node Types
registry.register('start', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        return { success: true, data: { start: Date.now() } };
    }
});

registry.register('sleep', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const duration = context.inputData?.duration || 1000;
        console.log(`💤 Sleep node ${context.nodeId} starting (duration: ${duration}ms)...`);
        await new Promise(resolve => setTimeout(resolve, duration));
        console.log(`⏰ Sleep node ${context.nodeId} finished.`);
        return { success: true, data: { slept: true, finishedAt: Date.now() } };
    }
});

registry.register('rate-limited', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`⚡ Rate-limited node ${context.nodeId} executing...`);
        return { success: true, data: { executedAt: Date.now() } };
    }
});

registry.register('join', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        return { success: true, data: { joined: true } };
    }
});

// Register Rate Limit
// Limit 'rate-limited' nodes to 1 per second
registry.registerRateLimit('rate-limited', 1);

// 3. Define Workflows

// Workflow A: Concurrency Test
const concurrencyWorkflow: WorkflowDefinition = {
    id: 'concurrency-test',
    name: 'Concurrency Limit Test',
    entryNodeId: 'start',
    maxConcurrency: 2, // Limit to 2 parallel nodes
    nodes: [
        { id: 'start', type: 'start', config: {}, inputs: [], outputs: ['s1', 's2', 's3', 's4', 's5'] },
        { id: 's1', type: 'sleep', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 's2', type: 'sleep', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 's3', type: 'sleep', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 's4', type: 'sleep', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 's5', type: 'sleep', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 'join', type: 'join', config: {}, inputs: ['s1', 's2', 's3', 's4', 's5'], outputs: [] }
    ]
};

// Workflow B: Rate Limit Test
const rateLimitWorkflow: WorkflowDefinition = {
    id: 'rate-limit-test',
    name: 'Rate Limit Test',
    entryNodeId: 'start',
    nodes: [
        { id: 'start', type: 'start', config: {}, inputs: [], outputs: ['r1', 'r2', 'r3', 'r4', 'r5'] },
        { id: 'r1', type: 'rate-limited', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 'r2', type: 'rate-limited', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 'r3', type: 'rate-limited', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 'r4', type: 'rate-limited', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 'r5', type: 'rate-limited', config: {}, inputs: ['start'], outputs: ['join'] },
        { id: 'join', type: 'join', config: {}, inputs: ['r1', 'r2', 'r3', 'r4', 'r5'], outputs: [] }
    ]
};

// 4. Run Tests
async function run() {
    console.log('--- Starting Parallel Execution Limits Tests ---');
    engine.startWorkers(10); // Start with high global concurrency to prove our limits work
    engine.registerWorkflow(concurrencyWorkflow);
    engine.registerWorkflow(rateLimitWorkflow);

    // --- Test 1: Concurrency ---
    console.log('\n--- Test 1: Concurrency Limit (Max 2) ---');
    const startA = Date.now();
    const execIdA = await engine.enqueueWorkflow(concurrencyWorkflow.id);

    await waitForCompletion(execIdA);
    const durationA = Date.now() - startA;
    console.log(`Concurrency Test Duration: ${durationA}ms`);

    // 5 nodes * 1s each. With concurrency 2:
    // Batch 1: 2 nodes (1s)
    // Batch 2: 2 nodes (1s)
    // Batch 3: 1 node (1s)
    // Total ~3s.
    // If no limit (concurrency 10), it would be ~1s.
    if (durationA >= 2800 && durationA < 4500) {
        console.log('✅ Concurrency Test PASSED (Approx 3s)');
    } else {
        console.error(`❌ Concurrency Test FAILED (Expected ~3000ms, got ${durationA}ms)`);
    }

    // --- Test 2: Rate Limit ---
    console.log('\n--- Test 2: Rate Limit (1/s) ---');
    // Clear Redis rate limit keys to be safe (optional, but good practice)
    // await redis.keys('rate-limit:*').then(keys => keys.length && redis.del(keys));

    const startB = Date.now();
    const execIdB = await engine.enqueueWorkflow(rateLimitWorkflow.id);

    await waitForCompletion(execIdB);
    const durationB = Date.now() - startB;
    console.log(`Rate Limit Test Duration: ${durationB}ms`);

    // 5 nodes. Limit 1/s.
    // T=0: Node 1 runs.
    // T=1: Node 2 runs.
    // ...
    // T=4: Node 5 runs.
    // Total ~4-5s.
    // Without limit, it would be instant (<100ms).
    if (durationB >= 4000) {
        console.log('✅ Rate Limit Test PASSED (> 4s)');
    } else {
        console.error(`❌ Rate Limit Test FAILED (Expected > 4000ms, got ${durationB}ms)`);
    }

    await engine.close();
    process.exit(0);
}

async function waitForCompletion(executionId: string) {
    return new Promise<void>((resolve) => {
        const checkInterval = setInterval(async () => {
            const state = await store.getExecution(executionId);
            if (state?.status === 'completed' || state?.status === 'failed') {
                clearInterval(checkInterval);
                resolve();
            }
        }, 200);
    });
}

run();
