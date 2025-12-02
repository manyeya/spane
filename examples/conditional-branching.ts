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
        console.log('Start node executed');
        return { success: true, data: { value: 10 } };
    }
});

registry.register('switch', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const input = context.inputData?.value || 0;
        console.log(`Switch node checking value: ${input}`);

        // Condition: if value > 5, go to 'branch-a', else 'branch-b'
        // Note: In a real app, output IDs would be dynamic or mapped. 
        // Here we assume the workflow definition connects to specific IDs.

        // Let's assume the node config or logic knows which output ID corresponds to which condition.
        // For this test, we'll look at the workflow definition to find the IDs.
        // But since execute doesn't have the full workflow def, we'll hardcode the logic 
        // based on the known structure of our test workflow.

        // In a real implementation, the "nextNodes" would be determined by looking up 
        // the connected nodes that match the condition.

        if (input > 5) {
            console.log('Condition met (value > 5) -> Branch A');
            return {
                success: true,
                data: { path: 'A' },
                nextNodes: ['node-branch-a']
            };
        } else {
            console.log('Condition met (value <= 5) -> Branch B');
            return {
                success: true,
                data: { path: 'B' },
                nextNodes: ['node-branch-b']
            };
        }
    }
});

registry.register('process', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`Process node ${context.nodeId} executed`);
        return { success: true, data: { processed: true } };
    }
});

registry.register('join', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Join node executed');
        console.log('Previous results:', JSON.stringify(context.previousResults, null, 2));
        return { success: true, data: { joined: true } };
    }
});

// 3. Define Workflow
const workflow: WorkflowDefinition = {
    id: 'conditional-flow',
    name: 'Conditional Branching Test',
    entryNodeId: 'node-start',
    nodes: [
        {
            id: 'node-start',
            type: 'start',
            config: {},
            inputs: [],
            outputs: ['node-switch']
        },
        {
            id: 'node-switch',
            type: 'switch',
            config: {},
            inputs: ['node-start'],
            outputs: ['node-branch-a', 'node-branch-b']
        },
        {
            id: 'node-branch-a',
            type: 'process',
            config: {},
            inputs: ['node-switch'],
            outputs: ['node-join']
        },
        {
            id: 'node-branch-b',
            type: 'process',
            config: {},
            inputs: ['node-switch'],
            outputs: ['node-join']
        },
        {
            id: 'node-join',
            type: 'join',
            config: {},
            inputs: ['node-branch-a', 'node-branch-b'],
            outputs: []
        }
    ]
};

// 4. Run Test
async function run() {
    console.log('--- Starting Conditional Branching Test ---');

    engine.startWorkers();
    engine.registerWorkflow(workflow);

    try {
        const executionId = await engine.enqueueWorkflow(workflow.id);

        // Poll for completion
        const checkInterval = setInterval(async () => {
            const state = await store.getExecution(executionId);
            if (state?.status === 'completed' || state?.status === 'failed') {
                clearInterval(checkInterval);
                console.log(`\nWorkflow finished with status: ${state.status}`);
                console.log('Node Results:', JSON.stringify(state.nodeResults, null, 2));

                // Verify Branch A ran and Branch B was skipped
                const branchA = state.nodeResults['node-branch-a'];
                const branchB = state.nodeResults['node-branch-b'];
                const join = state.nodeResults['node-join'];

                if (branchA?.success && !branchA.skipped && branchB?.skipped && join?.success) {
                    console.log('\n✅ TEST PASSED: Branch A executed, Branch B skipped, Join executed.');
                } else {
                    console.error('\n❌ TEST FAILED: Unexpected execution state.');
                }

                await engine.close();
                process.exit(0);
            }
        }, 500);

    } catch (error) {
        console.error('Test failed:', error);
        await engine.close();
        process.exit(1);
    }
}

run();
