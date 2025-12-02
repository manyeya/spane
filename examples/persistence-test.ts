import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../registry';
import { DrizzleExecutionStateStore } from '../drizzle-store';
import type { WorkflowDefinition } from '../types';
import { Redis } from 'ioredis';

// Setup with Postgres persistence
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/spane_test';
const redis = new Redis({
    maxRetriesPerRequest: null
});
const registry = new NodeRegistry();
const store = new DrizzleExecutionStateStore(DATABASE_URL);
const engine = new WorkflowEngine(registry, store, redis);

console.log(`📦 Using Postgres persistence: ${DATABASE_URL}`);

// Register a simple node type
registry.register('test-node', {
    execute: async (context) => {
        console.log(`[Node ${context.nodeId}] Executing with input:`, context.inputData);
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
        return {
            success: true,
            data: {
                nodeId: context.nodeId,
                timestamp: Date.now(),
                message: `Processed by ${context.nodeId}`
            }
        };
    }
});

// Define a simple workflow
const workflow: WorkflowDefinition = {
    id: 'persistence-test',
    name: 'Persistence Test Workflow',
    entryNodeId: 'node1',
    nodes: [
        {
            id: 'node1',
            type: 'test-node',
            config: {},
            inputs: [],
            outputs: ['node2']
        },
        {
            id: 'node2',
            type: 'test-node',
            config: {},
            inputs: ['node1'],
            outputs: ['node3']
        },
        {
            id: 'node3',
            type: 'test-node',
            config: {},
            inputs: ['node2'],
            outputs: []
        }
    ]
};

async function runTest() {
    console.log('\n--- Starting Persistence Test ---\n');

    // 1. Register Workflow
    await engine.registerWorkflow(workflow);
    engine.startWorkers();

    // 2. Run Workflow
    const initialData = { userId: 123, action: 'test-persistence' };
    const executionId = await engine.enqueueWorkflow(workflow.id, initialData);
    console.log(`✅ Workflow enqueued: ${executionId}`);

    // Wait for execution to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Verify Execution State Persisted
    console.log('\n--- Verifying Persistence ---\n');
    const execution = await store.getExecution(executionId);

    if (!execution) {
        console.error('❌ Execution not found in database!');
        process.exit(1);
    }

    console.log(`✅ Execution found: ${execution.executionId}`);
    console.log(`   Status: ${execution.status}`);
    console.log(`   Workflow ID: ${execution.workflowId}`);
    console.log(`   Started At: ${execution.startedAt}`);
    console.log(`   Completed At: ${execution.completedAt}`);
    console.log(`   Node Results: ${Object.keys(execution.nodeResults).length}`);

    // 4. Verify Initial Data Persisted
    if (JSON.stringify(execution.initialData) === JSON.stringify(initialData)) {
        console.log('✅ Initial data persisted correctly');
    } else {
        console.error('❌ Initial data mismatch:', execution.initialData);
    }

    // 5. Verify Node Results
    const expectedNodes = ['node1', 'node2', 'node3'];
    const persistedNodes = Object.keys(execution.nodeResults);

    if (expectedNodes.every(node => persistedNodes.includes(node))) {
        console.log('✅ All node results persisted');
    } else {
        console.error('❌ Missing node results:', {
            expected: expectedNodes,
            persisted: persistedNodes
        });
    }

    // 6. Verify Logs Persisted
    const logs = await store.getLogs(executionId);
    console.log(`\n--- Execution Logs (${logs.length}) ---`);
    if (logs.length > 0) {
        console.log('✅ Logs persisted to database');
        logs.slice(0, 5).forEach(log => {
            console.log(`   [${log.level.toUpperCase()}] ${log.message}`);
        });
        if (logs.length > 5) {
            console.log(`   ... and ${logs.length - 5} more`);
        }
    } else {
        console.error('❌ No logs found in database');
    }

    // 7. Verify Trace Persisted
    const trace = await store.getTrace(executionId);
    console.log(`\n--- Execution Trace ---`);
    if (trace && trace.spans.length > 0) {
        console.log('✅ Trace persisted to database');
        console.log(`   Trace ID: ${trace.executionId}`);
        console.log(`   Spans: ${trace.spans.length}`);
        trace.spans.forEach(span => {
            const duration = span.endTime ? span.endTime - span.startTime : 'N/A';
            console.log(`     - ${span.name} (${span.status}) [${duration}ms]`);
        });
    } else {
        console.error('❌ No trace found in database');
    }

    // 8. Simulate "Restart" - Create New Store Instance
    console.log('\n--- Simulating Restart (New Store Instance) ---\n');
    const newStore = new DrizzleExecutionStateStore(DATABASE_URL);

    const recoveredExecution = await newStore.getExecution(executionId);
    if (recoveredExecution) {
        console.log('✅ Execution recovered after "restart"');
        console.log(`   Status: ${recoveredExecution.status}`);
        console.log(`   Node Results: ${Object.keys(recoveredExecution.nodeResults).length}`);
    } else {
        console.error('❌ Failed to recover execution after restart');
    }

    console.log('\n--- Persistence Test Complete ---\n');
    console.log('🎉 All persistence features verified!');

    await redis.quit();
    process.exit(0);
}

runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
