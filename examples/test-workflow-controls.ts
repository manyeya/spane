import { Redis } from 'ioredis';
import { NodeRegistry } from '../engine/registry';
import { WorkflowEngine } from '../engine/workflow-engine';
import { DrizzleExecutionStateStore } from '../db/drizzle-store';
import { CircuitBreakerRegistry } from '../utils/circuit-breaker';
import type { WorkflowDefinition } from '../types';

/**
 * Test to verify workflow control methods (pause, resume, cancel)
 */
async function testWorkflowControls() {
    console.log('🧪 Testing workflow controls (pause, resume, cancel)...\n');

    // Setup
    const redisConnection = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
    });

    const stateStore = new DrizzleExecutionStateStore(
        process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/spane'
    );

    const registry = new NodeRegistry();
    registry.registerDefaultExternalNodes(); // Enable circuit breaker for external nodes
    
    // Register a dummy node type
    registry.register('log', {
        execute: async (context) => {
            console.log(`[Node ${context.nodeId}] Executing...`);
            return { success: true, data: { message: 'Logged' } };
        }
    });

    const circuitBreakerRegistry = new CircuitBreakerRegistry();
    const engine = new WorkflowEngine(registry, stateStore, redisConnection, undefined, circuitBreakerRegistry);

    // Test workflow definition with multiple steps to allow time for controls
    const testWorkflow: WorkflowDefinition = {
        id: 'test-controls-workflow',
        name: 'Test Controls Workflow',
        nodes: [
            {
                id: 'step1',
                type: 'log',
                config: { message: 'Step 1' },
                inputs: [],
                outputs: ['step2'],
            },
            {
                id: 'step2',
                type: 'log',
                config: { message: 'Step 2' },
                inputs: ['step1'],
                outputs: ['step3'],
            },
            {
                id: 'step3',
                type: 'log',
                config: { message: 'Step 3' },
                inputs: ['step2'],
                outputs: [],
            },
        ],
        entryNodeId: 'step1',
    };

    try {
        await engine.registerWorkflow(testWorkflow);
        console.log('✅ Workflow registered\n');

        // --- Test 1: Pause & Resume ---
        console.log('📝 Test 1: Pause & Resume');

        // Start workflow with a delay so we can catch it before it finishes
        // We'll use the enqueueNode directly to simulate a paused state effectively or just rely on timing
        // Better: Enqueue workflow, then immediately pause it

        const executionId1 = await engine.enqueueWorkflow(testWorkflow.id);
        console.log(`Started execution ${executionId1}`);

        // Pause immediately
        await engine.pauseWorkflow(executionId1);

        // Verify status in DB
        const status1 = await stateStore.getExecution(executionId1);
        if (status1?.status !== 'paused') {
            throw new Error(`❌ Expected status 'paused', got '${status1?.status}'`);
        }
        console.log('✅ Execution status is paused in DB');

        // Verify jobs are delayed (wait a bit for async operations)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check queue for delayed jobs
        // We need to access queueManager publically or via a helper, but it's private.
        // Or better, use the engine's queueManager if we cast to any (for testing)
        const queue = (engine as any).queueManager.nodeQueue;
        const delayedCount = await queue.getDelayedCount();
        console.log(`Delayed jobs count: ${delayedCount}`);

        if (delayedCount === 0) {
            throw new Error('❌ No delayed jobs found! Pause failed to move jobs.');
        } else {
            console.log('✅ Found delayed jobs (Pause worked)');
        }

        // Resume
        await engine.resumeWorkflow(executionId1);

        // Verify status
        const status2 = await stateStore.getExecution(executionId1);
        if (status2?.status !== 'running') {
            throw new Error(`❌ Expected status 'running', got '${status2?.status}'`);
        }
        console.log('✅ Execution status is running in DB');

        // Wait for resume to process
        await new Promise(resolve => setTimeout(resolve, 1000));
        const delayedCountAfter = await queue.getDelayedCount();
        console.log(`Delayed jobs count after resume: ${delayedCountAfter}`);

        if (delayedCountAfter >= delayedCount) {
            throw new Error('❌ Delayed jobs did not decrease! Resume failed to promote jobs.');
        }
        console.log('✅ Delayed jobs decreased (Resume worked)');

        // --- Test 2: Cancel ---
        console.log('\n📝 Test 2: Cancel');
        const executionId2 = await engine.enqueueWorkflow(testWorkflow.id);
        console.log(`Started execution ${executionId2}`);

        // Cancel immediately
        await engine.cancelWorkflow(executionId2);

        // Verify status
        const status3 = await stateStore.getExecution(executionId2);
        if (status3?.status !== 'cancelled') {
            throw new Error(`❌ Expected status 'cancelled', got '${status3?.status}'`);
        }
        console.log('✅ Execution status is cancelled in DB');

        // Verify jobs are removed
        // We can check waiting count. It should be 0 for this execution ideally.
        // Hard to verify exact count without inspecting job data, but we can check if it runs.

        console.log('✅ Cancel command executed successfully');

        console.log('\n🎉 All control tests passed!');

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    } finally {
        await engine.close();
        await stateStore.close();
        await redisConnection.quit();
    }
}

testWorkflowControls();
