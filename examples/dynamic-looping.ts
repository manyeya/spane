
import {
    WorkflowEngine,
    NodeRegistry,
    InMemoryExecutionStore,
    type WorkflowDefinition,
    type ExecutionContext
} from '../src';
import { Redis } from 'ioredis';

/**
 * Dynamic Looping / Fan-Out Example
 * 
 * "Looping" in a DAG (Directed Acyclic Graph) is typically implemented as:
 * 1. Batch Processing: A single node iterates internally over a list.
 * 2. Static Fan-Out: You hardcode N parallel nodes.
 * 3. Dynamic Fan-Out: You generate the workflow definition programmatically based on the input size.
 * 
 * This example demonstrates option #3 (Dynamic Fan-Out), which is the most robust
 * way to handle "For Each Item" logic where distinct retries/logging per item is needed.
 */

async function runDynamicLoopExample() {
    console.log("🚀 Starting Dynamic Looping (Fan-Out) Example");

    const redis = new Redis({ maxRetriesPerRequest: null });
    const store = new InMemoryExecutionStore();
    const registry = new NodeRegistry();

    // --- 0. Register Start Node ---
    registry.register('start-trigger', {
        execute: async () => ({ success: true, data: { started: true } })
    });

    // --- 1. Register Worker Node ---
    registry.register('process-item', {
        execute: async (context: ExecutionContext) => {
            const { itemId, value } = context.nodeConfig || {};
            console.log(`   [Worker ${context.nodeId}] 🏭 Processing item ${itemId}: ${value}`);

            // Simulate work
            await new Promise(r => setTimeout(r, Math.random() * 500));

            return { success: true, data: { processed: true, result: value * 2 } };
        }
    });

    // --- 2. Register Aggregator Node ---
    registry.register('aggregate-results', {
        execute: async (context: ExecutionContext) => {
            console.log(`   [Aggregator] 📦 Collecting results from ${Object.keys(context.inputData).length} workers...`);

            const results = Object.values(context.inputData).map((d: any) => d.result);
            const total = results.reduce((sum: number, val: number) => sum + val, 0);

            return { success: true, data: { total, count: results.length } };
        }
    });

    const engine = new WorkflowEngine(registry, store, redis);
    engine.startWorkers();

    try {
        // --- 3. Dynamic Workflow Generation ---
        const itemsToProcess = [10, 20, 30, 40, 50]; // Input list
        console.log(`\n📋 Input List: [${itemsToProcess.join(', ')}]`);

        const workflowId = `dynamic-loop-${Date.now()}`;
        const workflowName = 'Dynamic Fan-Out Workflow';

        // Helper to generate the definition
        const nodes: any[] = [];
        const workerIds: string[] = [];

        // A) Create a worker node for EACH item
        itemsToProcess.forEach((val, index) => {
            const nodeId = `worker-${index}`;
            workerIds.push(nodeId);

            nodes.push({
                id: nodeId,
                type: 'process-item',
                config: { itemId: index, value: val }, // Bake data into config
                inputs: ['start'], // Depend on start node
                outputs: ['aggregator']
            });
        });

        // B) Create one aggregator that waits for ALL workers
        nodes.push({
            id: 'aggregator',
            type: 'aggregate-results',
            config: {},
            inputs: workerIds, // Auto-dependency on all workers
            outputs: []
        });

        // C) Add explicit Start Node
        nodes.push({
            id: 'start',
            type: 'start-trigger',
            config: {},
            inputs: [],
            outputs: workerIds // Point to all workers
        });

        const workflow: WorkflowDefinition = {
            id: workflowId,
            name: workflowName,
            nodes: nodes,
            entryNodeId: 'start'
        };

        // --- 4. Execution ---
        await engine.registerWorkflow(workflow);
        console.log(`✅ Generated and registered workflow with ${nodes.length} nodes`);

        // Debug Verification
        const cached = await engine.getWorkflow(workflowId);
        console.log(`🔍 Cache Check: ${cached ? 'Found in cache' : 'NOT FOUND IN CACHE'}`);

        console.log("▶️ Triggering Dynamic Workflow...");
        const executionId = await engine.enqueueWorkflow(workflowId, {});

        // Wait for completion
        while (true) {
            const exec = await store.getExecution(executionId);
            if (exec?.status === 'completed') {
                const res = await store.getNodeResults(executionId, ['aggregator']);
                console.log(`\n🎉 Completed! Aggregated Result:`, res['aggregator'].data);
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }

    } catch (e) {
        console.error(e);
    } finally {
        await engine.close();
        redis.disconnect();
    }
}

if (require.main === module) {
    runDynamicLoopExample().catch(console.error);
}
