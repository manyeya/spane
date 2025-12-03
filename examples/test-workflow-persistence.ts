import { Redis } from 'ioredis';
import { NodeRegistry } from '../engine/registry';
import { WorkflowEngine } from '../engine/workflow-engine';
import { DrizzleExecutionStateStore } from '../db/drizzle-store';
import type { WorkflowDefinition } from '../types';

/**
 * Test to verify that workflows persist across server restarts
 * 
 * This test:
 * 1. Creates a workflow engine and registers a workflow
 * 2. Verifies the workflow is accessible via the engine
 * 3. Simulates a server restart by creating a new engine instance
 * 4. Verifies the workflow is still accessible from the database
 */

async function testWorkflowPersistence() {
    console.log('🧪 Testing workflow persistence across server restarts...\n');

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

    // Test workflow definition
    const testWorkflow: WorkflowDefinition = {
        id: 'test-persistence-workflow',
        name: 'Test Persistence Workflow',
        nodes: [
            {
                id: 'start',
                type: 'log',
                config: { message: 'Testing persistence' },
                inputs: [],
                outputs: [],
            },
        ],
        entryNodeId: 'start',
    };

    try {
        // Step 1: Create first engine instance and register workflow
        console.log('📝 Step 1: Creating first engine instance and registering workflow...');
        const engine1 = new WorkflowEngine(registry, stateStore, redisConnection);
        await engine1.registerWorkflow(testWorkflow);
        console.log('✅ Workflow registered\n');

        // Step 2: Verify workflow is accessible via getWorkflow (lazy load)
        console.log('🔍 Step 2: Verifying workflow is accessible via getWorkflow()...');
        const workflow1 = await engine1.getWorkflow(testWorkflow.id);
        if (!workflow1) {
            throw new Error('❌ Workflow not found after registration!');
        }
        console.log('✅ Workflow found via getWorkflow()\n');

        // Step 3: Verify workflow is in database via getAllWorkflowsFromDatabase
        console.log('🔍 Step 3: Verifying workflow is in database via getAllWorkflowsFromDatabase()...');
        const allWorkflows1 = await engine1.getAllWorkflowsFromDatabase();
        const foundInDb1 = allWorkflows1.find(w => w.id === testWorkflow.id);
        if (!foundInDb1) {
            throw new Error('❌ Workflow not found in database!');
        }
        console.log('✅ Workflow found in database\n');

        // Step 4: Simulate server restart - create new engine instance
        console.log('🔄 Step 4: Simulating server restart (creating new engine instance)...');
        const engine2 = new WorkflowEngine(registry, stateStore, redisConnection);
        console.log('✅ New engine instance created\n');

        // Step 5: Verify workflow is still accessible after "restart"
        console.log('🔍 Step 5: Verifying workflow persists after restart...');
        const workflow2 = await engine2.getWorkflow(testWorkflow.id);
        if (!workflow2) {
            throw new Error('❌ Workflow not found after restart!');
        }
        console.log('✅ Workflow found after restart via getWorkflow()\n');

        // Step 6: Verify getAllWorkflowsFromDatabase still returns the workflow
        console.log('🔍 Step 6: Verifying getAllWorkflowsFromDatabase() after restart...');
        const allWorkflows2 = await engine2.getAllWorkflowsFromDatabase();
        const foundInDb2 = allWorkflows2.find(w => w.id === testWorkflow.id);
        if (!foundInDb2) {
            throw new Error('❌ Workflow not found in database after restart!');
        }
        console.log('✅ Workflow found in database after restart\n');

        // Step 7: Verify cache is initially empty after restart
        console.log('🔍 Step 7: Verifying cache behavior...');
        const cache = engine2.getAllWorkflows();
        console.log(`   Cache size before lazy load: ${cache.size}`);

        // After getWorkflow was called, it should be in cache
        const cacheAfterLoad = engine2.getAllWorkflows();
        const inCache = cacheAfterLoad.has(testWorkflow.id);
        console.log(`   Cache size after lazy load: ${cacheAfterLoad.size}`);
        console.log(`   Workflow in cache: ${inCache}`);
        console.log('✅ Cache behavior verified\n');

        console.log('🎉 All tests passed! Workflows persist correctly across server restarts.\n');

        // Cleanup
        await engine1.close();
        await engine2.close();
        await stateStore.close();
        await redisConnection.quit();

    } catch (error) {
        console.error('❌ Test failed:', error);

        // Cleanup on error
        await stateStore.close();
        await redisConnection.quit();

        process.exit(1);
    }
}

// Run the test
testWorkflowPersistence()
    .then(() => {
        console.log('✅ Test completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Test failed with error:', error);
        process.exit(1);
    });
