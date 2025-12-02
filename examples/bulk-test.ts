import { WorkflowEngine } from '../workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import { Redis } from 'ioredis';
import type { ExecutionContext, ExecutionResult } from '../types';

/**
 * Bulk Operations Test
 * 
 * This example demonstrates bulk operations:
 * 1. Bulk enqueue 10 workflows
 * 2. Bulk pause some workflows
 * 3. Bulk resume paused workflows
 * 4. Bulk cancel remaining workflows
 */

class BulkTestNode {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const workflowNum = context.inputData?.workflowNumber || 'unknown';
        console.log(`✅ Workflow #${workflowNum} executed`);

        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 2000));

        return {
            success: true,
            data: {
                workflowNumber: workflowNum,
                completedAt: new Date().toISOString()
            }
        };
    }
}

async function main() {
    const redis = new Redis({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: null,
    });

    const registry = new NodeRegistry();
    registry.register('bulk-test', new BulkTestNode());

    const stateStore = new InMemoryExecutionStore();
    const engine = new WorkflowEngine(registry, stateStore, redis);

    // Register workflow
    await engine.registerWorkflow({
        id: 'bulk-workflow',
        name: 'Bulk Test Workflow',
        nodes: [
            {
                id: 'bulk-node',
                type: 'bulk-test',
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        entryNodeId: 'bulk-node'
    });

    engine.startWorkers(3);

    console.log('🚀 Starting bulk operations test...\n');

    // Test 1: Bulk enqueue
    console.log('📦 Test 1: Bulk enqueuing 10 workflows...');
    const workflows = Array.from({ length: 10 }, (_, i) => ({
        workflowId: 'bulk-workflow',
        initialData: { workflowNumber: i + 1 },
        priority: i % 3 === 0 ? 8 : 5 // Every 3rd workflow has higher priority
    }));

    const executionIds = await engine.enqueueBulkWorkflows(workflows);
    console.log(`   ✓ Enqueued ${executionIds.length} workflows\n`);

    // Wait a bit for some to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 2: Bulk pause
    console.log('⏸️  Test 2: Bulk pausing workflows 5-7...');
    const toPause = executionIds.slice(4, 7);
    await engine.pauseBulkWorkflows(toPause);
    console.log(`   ✓ Paused ${toPause.length} workflows\n`);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: Bulk resume
    console.log('▶️  Test 3: Bulk resuming paused workflows...');
    await engine.resumeBulkWorkflows(toPause);
    console.log(`   ✓ Resumed ${toPause.length} workflows\n`);

    // Wait a bit more
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 4: Bulk cancel
    console.log('🚫 Test 4: Bulk canceling workflows 8-10...');
    const toCancel = executionIds.slice(7, 10);
    await engine.cancelBulkWorkflows(toCancel);
    console.log(`   ✓ Cancelled ${toCancel.length} workflows\n`);

    console.log('⏳ Waiting for remaining workflows to complete...\n');

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check final states
    console.log('📊 Final workflow states:');
    for (let i = 0; i < executionIds.length; i++) {
        const executionId = executionIds[i];
        if (!executionId) continue;
        const execution = await stateStore.getExecution(executionId);
        console.log(`   Workflow #${i + 1}: ${execution?.status || 'unknown'}`);
    }

    console.log('\n✅ Bulk operations test complete!');

    await engine.close();
    await redis.quit();
}

main().catch(console.error);
