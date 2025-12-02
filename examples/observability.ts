
import { WorkflowEngine } from '../workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import type { WorkflowDefinition } from '../types';
import { Redis } from 'ioredis';

// Setup
const redis = new Redis({
    maxRetriesPerRequest: null
});
const registry = new NodeRegistry();
const store = new InMemoryExecutionStore();
const engine = new WorkflowEngine(registry, store, redis);

// Register a simple node type
registry.register('log-node', {
    execute: async (context) => {
        console.log(`[Node ${context.nodeId}] Executing...`);
        return { success: true, data: { message: 'Hello from log-node' } };
    }
});

// Define a workflow
const workflow: WorkflowDefinition = {
    id: 'obs-test-workflow',
    name: 'Observability Test Workflow',
    entryNodeId: 'node1',
    nodes: [
        {
            id: 'node1',
            type: 'log-node',
            config: {},
            inputs: [],
            outputs: ['node2']
        },
        {
            id: 'node2',
            type: 'log-node',
            config: {},
            inputs: ['node1'],
            outputs: []
        }
    ]
};

async function runTest() {
    console.log('--- Starting Observability Test ---');

    // 1. Register Workflow
    await engine.registerWorkflow(workflow);
    engine.startWorkers();

    // 2. Run Workflow
    const executionId = await engine.enqueueWorkflow(workflow.id, { initial: 'data' });
    console.log(`Workflow enqueued: ${executionId}`);

    // Wait for execution to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Verify Logs
    const logs = await store.getLogs(executionId);
    console.log(`\n--- Execution Logs (${logs.length}) ---`);
    logs.forEach(log => {
        console.log(`[${log.level.toUpperCase()}] ${log.message}`);
    });

    if (logs.length > 0) {
        console.log('✅ Logs generated successfully');
    } else {
        console.error('❌ No logs found');
    }

    // 4. Verify Trace
    const trace = await store.getTrace(executionId);
    console.log(`\n--- Execution Trace ---`);
    if (trace) {
        console.log(`Trace ID: ${trace.executionId}`);
        console.log(`Spans: ${trace.spans.length}`);
        trace.spans.forEach(span => {
            console.log(`  - Span: ${span.name} (${span.status}) [${span.endTime ? span.endTime - span.startTime : 'N/A'}ms]`);
        });
        console.log('✅ Trace generated successfully');
    } else {
        console.error('❌ No trace found');
    }

    // 5. Test Replay
    console.log(`\n--- Testing Replay ---`);
    const replayExecutionId = await engine.replayWorkflow(executionId);
    console.log(`Replay execution started: ${replayExecutionId}`);

    // Wait for replay to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    const replayLogs = await store.getLogs(replayExecutionId);
    if (replayLogs.length > 0) {
        console.log(`✅ Replay logs generated (${replayLogs.length})`);
    } else {
        console.error('❌ No replay logs found');
    }

    const replayExecution = await store.getExecution(replayExecutionId);
    if (replayExecution?.metadata?.replayedFrom === executionId) {
        console.log('✅ Replay metadata linked correctly');
    } else {
        console.error('❌ Replay metadata missing or incorrect');
    }

    if (replayExecution?.initialData?.initial === 'data') {
        console.log('✅ Replay preserved initialData');
    } else {
        console.error('❌ Replay lost initialData:', replayExecution?.initialData);
    }

    console.log('\n--- Test Complete ---');
    process.exit(0);
}

runTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
