import { WorkflowEngine } from '../workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import { Redis } from 'ioredis';
import type { ExecutionContext, ExecutionResult } from '../types';

/**
 * Deduplication Test
 * 
 * This example demonstrates job deduplication by attempting to enqueue
 * the same workflow multiple times with the same jobId.
 * Only one execution should occur.
 */

class CounterNode {
    private static executionCount = 0;

    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        CounterNode.executionCount++;
        const count = CounterNode.executionCount;

        console.log(`🔢 Execution #${count} - Job ID: ${context.inputData?.jobId}`);

        return {
            success: true,
            data: {
                executionNumber: count,
                jobId: context.inputData?.jobId
            }
        };
    }

    static reset() {
        CounterNode.executionCount = 0;
    }
}

async function main() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    registry.register('counter', new CounterNode());

    const stateStore = new InMemoryExecutionStore();
    const engine = new WorkflowEngine(registry, stateStore, redis);

    // Register workflow
    await engine.registerWorkflow({
        id: 'dedup-test',
        name: 'Deduplication Test Workflow',
        nodes: [
            {
                id: 'counter',
                type: 'counter',
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        entryNodeId: 'counter'
    });

    engine.startWorkers(5);

    console.log('🚀 Starting deduplication test...\n');

    const jobId = 'unique-job-123';

    // Attempt to enqueue the same job 5 times with the same jobId
    console.log(`📋 Attempting to enqueue workflow 5 times with jobId: "${jobId}"`);
    console.log('Expected: Only 1 execution should occur (deduplication)\n');

    for (let i = 1; i <= 5; i++) {
        try {
            await engine.enqueueWorkflow(
                'dedup-test',
                { jobId, attemptNumber: i },
                undefined,
                0,
                undefined,
                { jobId: `${jobId}-node` } // Use consistent jobId for deduplication
            );
            console.log(`   Attempt ${i}: Enqueued`);
        } catch (error) {
            console.log(`   Attempt ${i}: Failed - ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    console.log('\n⏳ Waiting for execution...\n');

    // Wait for execution
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check job status
    console.log('\n📊 Checking job status...');
    const status = await engine.getJobStatus(`${jobId}-node`);
    console.log(`   Job exists: ${status.exists}`);
    console.log(`   Job status: ${status.status || 'N/A'}`);

    console.log('\n✅ Deduplication test complete!');
    console.log('If deduplication works correctly, you should see only 1 execution above.');

    await engine.close();
    await redis.quit();
}

main().catch(console.error);
