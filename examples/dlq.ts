import { WorkflowEngine } from '../engine/workflow-engine';
import { InMemoryExecutionStore } from '../inmemory-store';
import { NodeRegistry } from '../registry';
import { Redis } from 'ioredis';
import type { WorkflowDefinition, NodeDefinition, ExecutionContext, ExecutionResult, INodeExecutor } from '../types';

// Mock Node Executor that always fails
class FailingNodeExecutor implements INodeExecutor {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        throw new Error('Simulated Failure');
    }
}

// Mock Node Executor that succeeds
class SuccessNodeExecutor implements INodeExecutor {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        return { success: true, data: { message: 'Success' } };
    }
}

async function runTest() {
    const redis = new Redis({
        maxRetriesPerRequest: null,
    });
    const registry = new NodeRegistry();
    const store = new InMemoryExecutionStore();
    const engine = new WorkflowEngine(registry, store, redis);

    // Register executors
    registry.register('failing-node', new FailingNodeExecutor());
    registry.register('success-node', new SuccessNodeExecutor());

    // Define a workflow with a failing node
    const workflow: WorkflowDefinition = {
        id: 'test-dlq-workflow',
        name: 'Test DLQ Workflow',
        entryNodeId: 'node-1',
        nodes: [
            {
                id: 'node-1',
                type: 'failing-node',
                config: {},
                inputs: [],
                outputs: [],
            },
        ],
    };

    engine.registerWorkflow(workflow);
    engine.startWorkers(1);

    console.log('Starting workflow execution...');
    const executionId = await engine.enqueueWorkflow(workflow.id);

    // Wait for execution to complete (fail)
    // Since we have retries (3 attempts), it will take some time.
    console.log('Waiting for retries and failure...');

    const checkInterval = setInterval(async () => {
        const execution = await store.getExecution(executionId);
        if (execution?.status === 'failed') {
            clearInterval(checkInterval);
            console.log('Workflow failed as expected.');

            // Check DLQ
            const dlqItems = await engine.getDLQItems();
            console.log('DLQ Items:', dlqItems.length);

            if (dlqItems.length > 0) {
                console.log('✅ DLQ verification passed: Item found in DLQ.');
                console.log('Failed Reason:', dlqItems[0]?.failedReason);
            } else {
                console.error('❌ DLQ verification failed: No item found in DLQ.');
            }

            await engine.close();
            redis.disconnect();
            process.exit(0);
        }
    }, 1000);

    // Timeout
    setTimeout(async () => {
        console.error('Test timed out.');
        await engine.close();
        redis.disconnect();
        process.exit(1);
    }, 20000);
}

runTest().catch((error) => {
    console.error(error);
    process.exit(1);
});
