import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import { Redis } from 'ioredis';
import type { ExecutionContext, ExecutionResult } from '../types';

/**
 * Priority Test
 * 
 * This example demonstrates job prioritization by enqueuing 5 workflows
 * with different priorities and verifying they execute in priority order.
 * 
 * Higher priority values (e.g., 10) execute before lower priority values (e.g., 1).
 */

// Simple delay node that logs execution order
class DelayNode {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const delay = context.nodeId === 'delay' ? 100 : 0;
        await new Promise(resolve => setTimeout(resolve, delay));

        const timestamp = new Date().toISOString();
        console.log(`⏱️  [${timestamp}] Workflow ${context.workflowId} executed (Priority: ${context.inputData?.priority || 'N/A'})`);

        return {
            success: true,
            data: {
                executedAt: timestamp,
                priority: context.inputData?.priority
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
    registry.register('delay', new DelayNode());

    const stateStore = new InMemoryExecutionStore();
    const engine = new WorkflowEngine(registry, stateStore, redis);

    // Register a simple workflow
    await engine.registerWorkflow({
        id: 'priority-test',
        name: 'Priority Test Workflow',
        nodes: [
            {
                id: 'delay',
                type: 'delay',
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        entryNodeId: 'delay'
    });

    engine.startWorkers(1); // Single worker to see priority order clearly

    console.log('🚀 Starting priority test...\n');
    console.log('Enqueueing 5 workflows with different priorities (10, 8, 5, 3, 1)');
    console.log('Expected execution order: Priority 10 → 8 → 5 → 3 → 1\n');

    // Enqueue workflows with different priorities
    // Note: We add a small delay between enqueues to ensure they're all queued before execution starts
    const priorities = [
        { priority: 1, label: 'Low' },
        { priority: 3, label: 'Below Average' },
        { priority: 5, label: 'Normal' },
        { priority: 8, label: 'High' },
        { priority: 10, label: 'Critical' }
    ];

    for (const { priority, label } of priorities) {
        await engine.enqueueWorkflow(
            'priority-test',
            { priority, label },
            undefined,
            0,
            undefined,
            { priority }
        );
        console.log(`📋 Enqueued workflow with priority ${priority} (${label})`);
    }

    console.log('\n⏳ Waiting for workflows to execute...\n');

    // Wait for all workflows to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n✅ Priority test complete!');
    console.log('Review the execution order above to verify priority works correctly.');

    await engine.close();
    await redis.quit();
}

main().catch(console.error);
