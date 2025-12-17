
import { Redis } from 'ioredis';
import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../engine/registry';
import { InMemoryExecutionStore } from '../db/inmemory-store';
import { logger } from '../utils/logger';
import { config } from '../config';
import fs from 'fs/promises';
import path from 'path';

// Helper to generate large string
const generateLargeString = (sizeInBytes: number) => {
    return 'x'.repeat(sizeInBytes);
};

// Mock Node Executor that just passes input to output
class PassThroughExecutor {
    async execute(context: any) {
        logger.info({ nodeId: context.nodeId }, 'PassThroughExecutor executing');
        return {
            success: true,
            data: context.inputData // Echo input
        };
    }
}

async function main() {
    logger.info('🚀 Starting Large Payload Verification...');

    // 1. Setup
    const redis = new Redis(config.redis.url, {
        maxRetriesPerRequest: null
    });
    const registry = new NodeRegistry();
    registry.register('passthrough', new PassThroughExecutor());

    // Note: Use a mock store that doesn't actually persist to DB for this test,
    // but the engine will still use PayloadManager for the initial flow.
    // Ideally we'd use DrizzleStore but setting up DB is complex for a script.
    // However, InMemoryStore doesn't implement everything.
    // Wait, WorkflowEngine uses stateStore. But PayloadManager is independent of store.

    // Actually, we must use a store that works. InMemory is fine for basic execution logic.
    const store = new InMemoryExecutionStore();

    const engine = new WorkflowEngine(registry, store, redis);
    engine.startWorkers();

    // Clear previous storage
    try {
        await fs.rm(config.blobStorage.localPath, { recursive: true, force: true });
        await fs.mkdir(config.blobStorage.localPath, { recursive: true }); // Recreate it!
        logger.info('Checking storage clean');
    } catch { }

    try {
        // 2. Define Workflow
        const workflow = {
            id: 'large-payload-workflow',
            name: 'Large Payload Test',
            nodes: [
                {
                    id: 'node1',
                    type: 'passthrough',
                    config: {},
                    inputs: [],
                    outputs: []
                }
            ],
            entryNodeId: 'node1'
        };

        await engine.registerWorkflow(workflow);

        // 3. Create Large Payload (> 50KB)
        const largePayload = {
            message: 'Hello Big World',
            hugeData: generateLargeString(60 * 1024) // 60KB
        };

        logger.info({ payloadSize: JSON.stringify(largePayload).length }, 'Generated large payload');

        // 4. Execute
        const executionId = await engine.enqueueWorkflow(workflow.id, largePayload);
        logger.info({ executionId }, 'Workflow enqueued');

        // 5. Wait for completion
        logger.info('Waiting for execution...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 6. Verify Result
        const execution = await store.getExecution(executionId);
        logger.info({ status: execution?.status }, 'Execution status');

        if (execution?.status === 'completed') {
            const nodeResult = execution.nodeResults['node1'];
            if (nodeResult?.success) {
                // Verify data integrity
                const resultData = nodeResult.data;
                // Note: The result.data stored in InMemoryStore might still be the blob ref if the store doesn't auto-deserialize,
                // OR if node-processor serialized it before storing.
                // NodeProcessor serializes output before updateNodeResult.
                // So resultData should be a BlobReference if it's large.

                logger.info({ resultDataKeys: Object.keys(resultData || {}) }, 'Result Data Keys');

                if (resultData?.__type === 'blob_ref') {
                    logger.info('✅ Result is a Blob Reference as expected!');

                    // Manually check if file exists
                    const files = await fs.readdir(config.blobStorage.localPath);
                    logger.info({ files }, 'Blob storage files');

                    if (files.length > 0) {
                        logger.info('✅ Blob file exists on disk');
                    } else {
                        logger.error('❌ Blob file NOT found on disk');
                    }
                } else {
                    // It might be that the output wasn't large enough?
                    // Or logic didn't work.
                    // Oh, PassThrough just returns input. Input IS large.
                    logger.warn('⚠️ Result is NOT a Blob Reference. Check threshold?');
                }

            } else {
                logger.error('❌ Node execution failed');
            }
        } else {
            logger.error('❌ Workflow did not complete');
        }

    } catch (error) {
        logger.error({ error }, 'Verification failed');
    } finally {
        await engine.close();
        await redis.quit();
        // await store.close(); // InMemory doesn't have close
    }
}

main();
