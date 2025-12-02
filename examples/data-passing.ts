import { WorkflowEngine } from '../workflow-engine';
import { InMemoryExecutionStore } from '../inmemory-store';
import { NodeRegistry } from '../registry';
import { Redis } from 'ioredis';
import type { WorkflowDefinition, ExecutionContext, ExecutionResult, INodeExecutor } from '../types';

// Node that outputs a number
class NumberNodeExecutor implements INodeExecutor {
    constructor(private value: number) { }

    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`[NumberNode] Outputting value: ${this.value}`);
        return { success: true, data: { value: this.value } };
    }
}

// Node that doubles the input value
class DoubleNodeExecutor implements INodeExecutor {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const inputValue = context.inputData?.value || 0;
        const result = inputValue * 2;
        console.log(`[DoubleNode] Input: ${inputValue}, Output: ${result}`);
        return { success: true, data: { value: result } };
    }
}

// Node that adds 5 to the input value
class AddFiveNodeExecutor implements INodeExecutor {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const inputValue = context.inputData?.value || 0;
        const result = inputValue + 5;
        console.log(`[AddFiveNode] Input: ${inputValue}, Output: ${result}`);
        return { success: true, data: { value: result } };
    }
}

// Node that sums values from multiple parents
class SumNodeExecutor implements INodeExecutor {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`[SumNode] Received input:`, context.inputData);

        // Extract values from parent outputs
        const values = Object.values(context.inputData || {})
            .map((data: any) => data?.value || 0);

        const sum = values.reduce((acc, val) => acc + val, 0);
        console.log(`[SumNode] Summing values ${values.join(' + ')} = ${sum}`);

        return { success: true, data: { sum } };
    }
}

// Helper function to wait for workflow completion
async function waitForCompletion(store: InMemoryExecutionStore, executionId: string, maxWaitMs: number = 10000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        const state = await store.getExecution(executionId);
        if (state?.status === 'completed' || state?.status === 'failed' || state?.status === 'cancelled') {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
    }
    throw new Error(`Workflow ${executionId} did not complete within ${maxWaitMs}ms`);
}

async function runTest() {
    const redis = new Redis({
        maxRetriesPerRequest: null,
    });
    const registry = new NodeRegistry();
    const store = new InMemoryExecutionStore();
    const engine = new WorkflowEngine(registry, store, redis);

    // Register executors
    registry.register('number-10', new NumberNodeExecutor(10));
    registry.register('number-20', new NumberNodeExecutor(20));
    registry.register('double', new DoubleNodeExecutor());
    registry.register('add-five', new AddFiveNodeExecutor());
    registry.register('sum', new SumNodeExecutor());

    console.log('\n=== TEST 1: Simple Chain (A → B → C) ===\n');

    // Workflow: node-a (10) → node-b (double) → node-c (add 5)
    // Expected: 10 → 20 → 25
    const chainWorkflow: WorkflowDefinition = {
        id: 'test-chain',
        name: 'Test Chain Data Passing',
        entryNodeId: 'node-a',
        nodes: [
            {
                id: 'node-a',
                type: 'number-10',
                config: {},
                inputs: [],
                outputs: ['node-b'],
            },
            {
                id: 'node-b',
                type: 'double',
                config: {},
                inputs: ['node-a'],
                outputs: ['node-c'],
            },
            {
                id: 'node-c',
                type: 'add-five',
                config: {},
                inputs: ['node-b'],
                outputs: [],
            },
        ],
    };

    engine.registerWorkflow(chainWorkflow);
    engine.startWorkers(2);

    const exec1 = await engine.enqueueWorkflow(chainWorkflow.id);
    console.log(`Started chain workflow execution: ${exec1}`);

    // Wait for completion
    await waitForCompletion(store, exec1);

    const state1 = await store.getExecution(exec1);
    console.log('\n--- Chain Workflow Results ---');
    console.log(`Status: ${state1?.status}`);
    console.log(`Node A result:`, state1?.nodeResults['node-a']);
    console.log(`Node B result:`, state1?.nodeResults['node-b']);
    console.log(`Node C result:`, state1?.nodeResults['node-c']);

    if (state1?.nodeResults['node-c']?.data?.value === 25) {
        console.log('✅ Chain test PASSED: Final value is 25');
    } else {
        console.error('❌ Chain test FAILED: Expected 25, got', state1?.nodeResults['node-c']?.data?.value);
    }

    console.log('\n=== TEST 2: Multiple Parents (A → C, B → C) ===\n');

    // Add small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Workflow: node-a (10) → node-c (sum)
    //           node-b (20) → node-c (sum)
    // Expected: sum = 30
    const mergeWorkflow: WorkflowDefinition = {
        id: 'test-merge',
        name: 'Test Merge Data Passing',
        entryNodeId: 'node-a',
        nodes: [
            {
                id: 'node-a',
                type: 'number-10',
                config: {},
                inputs: [],
                outputs: ['node-c'],
            },
            {
                id: 'node-b',
                type: 'number-20',
                config: {},
                inputs: [],
                outputs: ['node-c'],
            },
            {
                id: 'node-c',
                type: 'sum',
                config: {},
                inputs: ['node-a', 'node-b'],
                outputs: [],
            },
        ],
    };

    engine.registerWorkflow(mergeWorkflow);

    const exec2 = await engine.enqueueWorkflow(mergeWorkflow.id);
    console.log(`Started merge workflow execution: ${exec2}`);

    // Wait for completion
    await waitForCompletion(store, exec2);

    const state2 = await store.getExecution(exec2);
    console.log('\n--- Merge Workflow Results ---');
    console.log(`Status: ${state2?.status}`);
    console.log(`Node A result:`, state2?.nodeResults['node-a']);
    console.log(`Node B result:`, state2?.nodeResults['node-b']);
    console.log(`Node C result:`, state2?.nodeResults['node-c']);

    if (state2?.nodeResults['node-c']?.data?.sum === 30) {
        console.log('✅ Merge test PASSED: Sum is 30');
    } else {
        console.error('❌ Merge test FAILED: Expected 30, got', state2?.nodeResults['node-c']?.data?.sum);
    }

    console.log('\n=== All Tests Complete ===\n');

    await engine.close();
    redis.disconnect();
    process.exit(0);
}

runTest().catch((error) => {
    console.error('Test failed with error:', error);
    process.exit(1);
});
