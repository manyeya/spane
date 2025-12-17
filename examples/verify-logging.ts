import { Redis } from 'ioredis';
import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../engine/registry';
import { InMemoryExecutionStore } from '../db/inmemory-store';
import { logger } from '../utils/logger';
import type { WorkflowDefinition } from '../types';

// Setup Redis
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

// Setup Registry
const registry = new NodeRegistry();
registry.register('log', {
    execute: async (context) => {
        logger.info({ nodeId: context.nodeId, data: context.inputData }, 'Executing log node');
        return { success: true, data: { logged: true } };
    }
});

// Setup Store
const store = new InMemoryExecutionStore();

// Setup Engine
const engine = new WorkflowEngine(registry, store, redis);

// Define Workflow
const workflow: WorkflowDefinition = {
    id: 'test-logging-workflow',
    name: 'Test Logging Workflow',
    version: 1,
    nodes: [
        {
            id: 'node-1',
            type: 'log',
            name: 'Log Node 1',
            inputs: [], // Entry node
            outputs: ['node-2'],
            config: {}
        },
        {
            id: 'node-2',
            type: 'log',
            name: 'Log Node 2',
            inputs: ['node-1'],
            outputs: [],
            config: {}
        }
    ]
};

async function main() {
    try {
        logger.info('🚀 Starting verification script...');

        // Start workers
        engine.startWorkers(2);

        // Register workflow
        await engine.registerWorkflow(workflow);

        // Run workflow
        const executionId = await engine.enqueueWorkflow(workflow.id, { test: 'data' });
        logger.info({ executionId }, 'Workflow enqueued');

        // Poll for completion
        let attempts = 0;
        while (attempts < 10) {
            const execution = await store.getExecution(executionId);
            if (execution?.status === 'completed' || execution?.status === 'failed') {
                logger.info({ status: execution.status }, 'Workflow finished');
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        logger.info('✅ Verification complete. Check logs above for structured JSON output.');

    } catch (error) {
        logger.error({ error }, 'Verification failed');
    } finally {
        await engine.close();
        await redis.quit();
        process.exit(0);
    }
}

main();
