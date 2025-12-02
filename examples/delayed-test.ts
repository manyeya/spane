import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import { Redis } from 'ioredis';
import type { ExecutionContext, ExecutionResult } from '../types';

/**
 * Delayed Jobs Test
 * 
 * This example demonstrates delayed and scheduled job execution:
 * 1. Workflow with 5-second delay (relative time)
 * 2. Workflow scheduled at absolute time (10 seconds from now)
 */

class TimestampNode {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const now = new Date();
        const scheduledFor = context.inputData?.scheduledFor;

        console.log(`⏰ Workflow executed at: ${now.toISOString()}`);
        if (scheduledFor) {
            console.log(`   Scheduled for: ${scheduledFor}`);
            const delay = now.getTime() - new Date(scheduledFor).getTime();
            console.log(`   Actual delay: ${delay}ms`);
        }

        return {
            success: true,
            data: {
                executedAt: now.toISOString(),
                scheduledFor
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
    registry.register('timestamp', new TimestampNode());

    const stateStore = new InMemoryExecutionStore();
    const engine = new WorkflowEngine(registry, stateStore, redis);

    // Register workflow
    await engine.registerWorkflow({
        id: 'delayed-test',
        name: 'Delayed Test Workflow',
        nodes: [
            {
                id: 'timestamp',
                type: 'timestamp',
                config: {},
                inputs: [],
                outputs: []
            }
        ],
        entryNodeId: 'timestamp'
    });

    engine.startWorkers(5);

    console.log('🚀 Starting delayed jobs test...\n');

    // Test 1: Relative delay (5 seconds)
    const delay5s = 5000;
    const scheduledTime5s = new Date(Date.now() + delay5s);
    console.log(`📋 Test 1: Enqueuing workflow with ${delay5s}ms delay`);
    console.log(`   Current time: ${new Date().toISOString()}`);
    console.log(`   Expected execution: ${scheduledTime5s.toISOString()}\n`);

    await engine.enqueueWorkflow(
        'delayed-test',
        { scheduledFor: scheduledTime5s.toISOString() },
        undefined,
        0,
        undefined,
        { delay: delay5s }
    );

    // Test 2: Absolute time scheduling (10 seconds from now)
    const executeAt = new Date(Date.now() + 10000);
    console.log(`📋 Test 2: Scheduling workflow for absolute time`);
    console.log(`   Current time: ${new Date().toISOString()}`);
    console.log(`   Scheduled for: ${executeAt.toISOString()}\n`);

    await engine.scheduleWorkflow(
        'delayed-test',
        { scheduledFor: executeAt.toISOString() },
        executeAt
    );

    console.log('⏳ Waiting for delayed workflows to execute...\n');

    // Wait for all workflows to complete
    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log('\n✅ Delayed jobs test complete!');

    await engine.close();
    await redis.quit();
}

main().catch(console.error);
