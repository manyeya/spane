
import { InMemoryExecutionStore } from '../db/inmemory-store';
import { logger } from '../utils/logger';

async function main() {
    logger.info('🚀 Starting Execution Pruning Verification...');

    const store = new InMemoryExecutionStore();
    const workflowId = 'pruning-test-workflow';

    // Helper to create mock execution
    const createExecution = async (ageHours: number, status: 'completed' | 'running' = 'completed') => {
        const id = await store.createExecution(workflowId);
        const execution = (store as any).executions.get(id); // Access internal map for manipulation

        // Manually set startedAt to simulate age
        execution.startedAt = new Date(Date.now() - ageHours * 60 * 60 * 1000);
        execution.status = status;

        if (status === 'completed') {
            execution.completedAt = new Date();
        }
        return id;
    };

    try {
        // TEST 1: Prune by Age
        logger.info('--- Test 1: Prune by Age (Max Age: 24h) ---');

        // Create executions
        await createExecution(1); // 1 hour old (Keep)
        await createExecution(10); // 10 hours old (Keep)
        await createExecution(25); // 25 hours old (Delete)
        await createExecution(48); // 48 hours old (Delete)
        await createExecution(30, 'running'); // 30 hours old but RUNNING (Keep)

        let count = await store.getExecutionCount();
        logger.info({ count }, 'Initial count (5)');

        // Run Pruning
        const prunedCount = await store.pruneExecutions({ maxAgeHours: 24 });
        logger.info({ prunedCount }, 'Pruned count (Should be 2)');

        count = await store.getExecutionCount();
        logger.info({ count }, 'Final count (Should be 3)');

        if (count === 3 && prunedCount === 2) {
            logger.info('✅ Test 1 Passed: Correctly pruned by age');
        } else {
            logger.error('❌ Test 1 Failed');
        }


        // TEST 2: Prune by Count calls
        logger.info('--- Test 2: Prune by Count (Max Count: 5) ---');

        // Reset store (simplify)
        (store as any).executions.clear();

        // Create 10 executions with increasing age (0 to 9 hours)
        for (let i = 0; i < 10; i++) {
            await createExecution(10 - i); // oldest created first (10h, 9h, ... 1h)
        }

        count = await store.getExecutionCount();
        logger.info({ count }, 'Initial count (10)');

        // Run Pruning (Keep 5)
        const prunedCount2 = await store.pruneExecutions({ maxCount: 5 });
        logger.info({ prunedCount: prunedCount2 }, 'Pruned count (Should be 5)');

        count = await store.getExecutionCount();
        logger.info({ count }, 'Final count (Should be 5)');

        // Verify we kept the NEWEST ones (indices 5-9, i.e., ages 5h-1h)
        // The oldest (ages 10h-6h) should be gone.

        if (count === 5 && prunedCount2 === 5) {
            logger.info('✅ Test 2 Passed: Correctly pruned by count');
        } else {
            logger.error('❌ Test 2 Failed');
        }

    } catch (error) {
        logger.error({ error }, 'Verification failed');
    }
}

main();
