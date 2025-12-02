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
        console.log(`✅ Workflow ${context.workflowId} started at ${new Date().toISOString()}`);
        console.log(`   Input data:`, JSON.stringify(context.inputData));
        return { success: true, data: { executed: true, timestamp: Date.now() } };
    }
});

// 3. Define Workflows

// Workflow A: Webhook Trigger
const webhookWorkflow: WorkflowDefinition = {
    id: 'webhook-test',
    name: 'Webhook Triggered Workflow',
    entryNodeId: 'start',
    triggers: [
        {
            type: 'webhook',
            config: {
                path: 'test-webhook',
                method: 'POST',
            },
        },
    ],
    nodes: [
        { id: 'start', type: 'start', config: {}, inputs: [], outputs: [] },
    ],
};

// Workflow B: Schedule Trigger (every 2 seconds)
const scheduleWorkflow: WorkflowDefinition = {
    id: 'schedule-test',
    name: 'Schedule Triggered Workflow',
    entryNodeId: 'start',
    triggers: [
        {
            type: 'schedule',
            config: {
                cron: '*/2 * * * * *', // Every 2 seconds
            },
        },
    ],
    nodes: [
        { id: 'start', type: 'start', config: {}, inputs: [], outputs: [] },
    ],
};

// 4. Run Test
async function run() {
    console.log('--- Starting Webhook/Trigger Tests ---\n');

    engine.startWorkers(5);

    // Register workflows
    await engine.registerWorkflow(webhookWorkflow);
    await engine.registerWorkflow(scheduleWorkflow);

    console.log('✅ Workflows registered\n');

    // --- Test 1: Webhook Trigger ---
    console.log('--- Test 1: Webhook Trigger ---');
    const webhookData = { user: 'john@example.com', action: 'signup' };
    const executionIds = await engine.triggerWebhook('test-webhook', 'POST', webhookData);

    if (executionIds.length === 1) {
        console.log(`✅ Webhook triggered successfully. Execution ID: ${executionIds[0]}`);

        // Wait for execution to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        const execution = await store.getExecution(executionIds[0] ?? "");
        if (execution?.status === 'completed') {
            console.log('✅ Webhook workflow completed successfully\n');
        } else {
            console.error(`❌ Webhook workflow failed: ${execution?.status}\n`);
        }
    } else {
        console.error(`❌ Webhook trigger failed. Expected 1 execution, got ${executionIds.length}\n`);
    }

    // --- Test 2: Schedule Trigger ---
    console.log('--- Test 2: Schedule Trigger ---');
    console.log('Waiting 5 seconds for cron jobs to execute (should run 2-3 times)...');

    // Count executions over 5 seconds
    const startTime = Date.now();
    let scheduleExecutions = 0;

    const checkInterval = setInterval(async () => {
        const allExecutions = await store.getExecution('exec_' + Date.now()); // Dummy call to access store
        // In a real scenario, we'd track executions better. For now, we'll just observe console output.
        scheduleExecutions++;
    }, 500);

    await new Promise(resolve => setTimeout(resolve, 5500));
    clearInterval(checkInterval);

    console.log('\n✅ Schedule test completed (check console for execution logs)');
    console.log('   Note: You should see multiple "schedule-test" executions above.');

    // Cleanup
    console.log('\n🛑 Shutting down...');
    await engine.close();
    process.exit(0);
}

run();
