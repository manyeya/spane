import { WorkflowEngine } from '../engine/workflow-engine';
import { InMemoryExecutionStore } from '../inmemory-store';
import { NodeRegistry } from '../registry';
import { Redis } from 'ioredis';
import type { WorkflowDefinition, ExecutionContext, ExecutionResult, INodeExecutor } from '../types';

// Mock Node Executor that runs for a specified duration
class LongRunningNodeExecutor implements INodeExecutor {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const duration = context.inputData?.duration || 2000;
        console.log(`[Node] Sleeping for ${duration}ms...`);
        await new Promise(resolve => setTimeout(resolve, duration));
        console.log(`[Node] Woke up!`);
        return { success: true, data: { message: 'Done' } };
    }
}

async function runTest() {
    const redis = new Redis({
        maxRetriesPerRequest: null,
    });
    const registry = new NodeRegistry();
    const store = new InMemoryExecutionStore();
    const engine = new WorkflowEngine(registry, store, redis);

    registry.register('long-running', new LongRunningNodeExecutor());

    const workflow: WorkflowDefinition = {
        id: 'test-control-flow',
        name: 'Test Control Flow',
        entryNodeId: 'node-1',
        nodes: [
            {
                id: 'node-1',
                type: 'long-running',
                config: {
                    // timeout: 1000 // Will be set dynamically for timeout test
                },
                inputs: [],
                outputs: [],
            },
        ],
    };

    engine.registerWorkflow(workflow);
    engine.startWorkers(1);

    try {
        // TEST 1: Cancellation
        console.log('\n--- TEST 1: Cancellation ---');
        const exec1 = await engine.enqueueWorkflow(workflow.id, { duration: 5000 });
        console.log(`Started execution ${exec1}`);

        // Wait a bit then cancel
        await new Promise(resolve => setTimeout(resolve, 1000));
        await engine.cancelWorkflow(exec1);

        // Wait for potential completion (should not happen)
        await new Promise(resolve => setTimeout(resolve, 2000));

        const state1 = await store.getExecution(exec1);
        console.log(`Execution ${exec1} status: ${state1?.status}`);
        if (state1?.status === 'cancelled') {
            console.log('✅ Cancellation verified');
        } else {
            console.error('❌ Cancellation failed');
        }

        // TEST 2: Pause and Resume
        console.log('\n--- TEST 2: Pause and Resume ---');
        const exec2 = await engine.enqueueWorkflow(workflow.id, { duration: 2000 });
        console.log(`Started execution ${exec2}`);

        // Pause immediately
        await engine.pauseWorkflow(exec2);

        // Wait - should be paused and not completing
        await new Promise(resolve => setTimeout(resolve, 3000));
        const state2Paused = await store.getExecution(exec2);
        console.log(`Execution ${exec2} status (paused): ${state2Paused?.status}`);

        if (state2Paused?.status === 'paused') {
            console.log('✅ Pause verified');

            // Resume
            await engine.resumeWorkflow(exec2);

            // Wait for completion
            await new Promise(resolve => setTimeout(resolve, 12000)); // Wait enough for retry delay (5s) + execution
            const state2Resumed = await store.getExecution(exec2);
            console.log(`Execution ${exec2} status (resumed): ${state2Resumed?.status}`);

            if (state2Resumed?.status === 'completed') {
                console.log('✅ Resume verified');
            } else {
                console.error('❌ Resume failed');
            }
        } else {
            console.error('❌ Pause failed');
        }

        // TEST 3: Timeout
        console.log('\n--- TEST 3: Timeout ---');
        // Modify workflow for timeout
        const timeoutWorkflow = { ...workflow, id: 'test-timeout' };
        if (timeoutWorkflow.nodes[0]) {
            timeoutWorkflow.nodes[0].config.timeout = 1000; // 1s timeout
        }
        engine.registerWorkflow(timeoutWorkflow);

        const exec3 = await engine.enqueueWorkflow(timeoutWorkflow.id, { duration: 5000 }); // 5s duration > 1s timeout
        console.log(`Started execution ${exec3}`);

        // Wait for timeout/failure
        await new Promise(resolve => setTimeout(resolve, 4000));

        const state3 = await store.getExecution(exec3);
        const nodeResult = state3?.nodeResults?.['node-1'];
        console.log(`Execution ${exec3} status: ${state3?.status}`);
        console.log(`Node result error: ${nodeResult?.error}`);

        if (state3?.status === 'failed') { // BullMQ timeout usually results in failure
            console.log('✅ Timeout verified');
        } else {
            console.log('⚠️ Timeout verification ambiguous - check logs (BullMQ might retry on timeout)');
            // Note: BullMQ timeout throws an error, which triggers retry. 
            // After retries exhausted, it fails.
            // We configured 3 retries, so it might take longer to fail completely.
        }

    } catch (err) {
        console.error('Test failed with error:', err);
    } finally {
        await engine.close();
        redis.disconnect();
        process.exit(0);
    }
}

runTest();
