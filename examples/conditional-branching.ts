
import {
    WorkflowEngine,
    NodeRegistry,
    InMemoryExecutionStore,
    type WorkflowDefinition,
    type ExecutionContext
} from '../src';
import { Redis } from 'ioredis';

/**
 * Conditional Branching Example
 * 
 * Demonstrates:
 * 1. Using `nextNodes` to dynamically choose execution paths
 * 2. Skipping nodes that are not selected (and their descendants)
 * 3. Implementing "Switch" or "If/Else" logic
 */

async function runConditionalExample() {
    console.log("🚀 Starting Conditional Branching Example");

    const redis = new Redis({ maxRetriesPerRequest: null });
    const store = new InMemoryExecutionStore();
    const registry = new NodeRegistry();

    // --- 1. Register 'Check-Amount' Node (The "Switch") ---
    registry.register('check-amount', {
        execute: async (context: ExecutionContext) => {
            const amount = context.inputData.amount;
            console.log(`   [Switch] Checking amount: $${amount}`);

            if (amount >= 1000) {
                console.log("   -> High value! Routing to Manager Approval.");
                return {
                    success: true,
                    data: { amount },
                    // 🌟 KEY FEATURE: Explicitly select which children to run
                    nextNodes: ['manager-approval']
                };
            } else {
                console.log("   -> Low value. Routing to Auto Approve.");
                return {
                    success: true,
                    data: { amount },
                    // 🌟 KEY FEATURE: Explicitly select which children to run
                    nextNodes: ['auto-approve']
                };
            }
        }
    });

    // --- 2. Register Branch Handlers ---
    registry.register('manager-approval', {
        execute: async (context) => {
            console.log("   [Node] 🕵️‍♂️ Manager manually approving transaction...");
            await new Promise(r => setTimeout(r, 200));
            return { success: true, data: { approved: true, by: 'Manager' } };
        }
    });

    registry.register('auto-approve', {
        execute: async (context) => {
            console.log("   [Node] 🤖 System auto-approving transaction...");
            return { success: true, data: { approved: true, by: 'System' } };
        }
    });

    // --- 3. Register Final Node ---
    registry.register('finalize-transaction', {
        execute: async (context) => {
            // This node runs regardless of which path was taken
            // because it's a child of BOTH.
            // CAUTION: In this engine, a merge node waits for ALL parents.
            // If a parent is "Skipped", the merge node still runs (dependencies resolved).

            const results = context.previousResults;
            const approver = results['manager-approval']?.data?.by || results['auto-approve']?.data?.by;

            console.log(`   [Node] 💰 Finalizing transaction. Approved by: ${approver}`);
            return { success: true, data: { status: 'Finalized' } };
        }
    });

    const engine = new WorkflowEngine(registry, store, redis);
    engine.startWorkers();

    try {
        const workflowId = 'expense-approval-flow';
        const workflow: WorkflowDefinition = {
            id: workflowId,
            name: 'Expense Approval',
            nodes: [
                {
                    id: 'start',
                    type: 'check-amount',
                    config: {},
                    inputs: [],
                    outputs: ['manager-approval', 'auto-approve']
                },
                {
                    id: 'manager-approval',
                    type: 'manager-approval',
                    config: {},
                    inputs: ['start'],
                    outputs: ['finalize']
                },
                {
                    id: 'auto-approve',
                    type: 'auto-approve',
                    config: {},
                    inputs: ['start'],
                    outputs: ['finalize']
                },
                {
                    id: 'finalize',
                    type: 'finalize-transaction',
                    config: {},
                    inputs: ['manager-approval', 'auto-approve'],
                    outputs: []
                }
            ],
            entryNodeId: 'start'
        };

        await engine.registerWorkflow(workflow);
        console.log(`✅ Workflow '${workflowId}' registered`);

        // --- Run Case 1: Low Amount (Auto Approve) ---
        console.log("\n▶️ Case 1: Triggering with $500 (Low Amount)");
        const exec1 = await engine.enqueueWorkflow(workflowId, { amount: 500 });
        await waitForCompletion(store, exec1);

        // --- Run Case 2: High Amount (Manager Approval) ---
        console.log("\n▶️ Case 2: Triggering with $5000 (High Amount)");
        const exec2 = await engine.enqueueWorkflow(workflowId, { amount: 5000 });
        await waitForCompletion(store, exec2);

    } catch (e) {
        console.error(e);
    } finally {
        await engine.close();
        redis.disconnect();
    }
}

async function waitForCompletion(store: InMemoryExecutionStore, executionId: string) {
    while (true) {
        const exec = await store.getExecution(executionId);
        if (exec?.status === 'completed') {
            const results = await store.getNodeResults(executionId, ['finalize']);
            console.log(`   ✅ Completed. Final Status: ${results['finalize']?.data?.status}`);
            break;
        } else if (exec?.status === 'failed') {
            console.error("   ❌ Failed");
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }
}

if (require.main === module) {
    runConditionalExample().catch(console.error);
}
