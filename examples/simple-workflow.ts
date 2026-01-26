
import {
    WorkflowEngine,
    NodeRegistry,
    InMemoryExecutionStore,
    type WorkflowDefinition
} from '../src';
import { Redis } from 'ioredis';

/**
 * Basic Usage Example
 * 
 * Demonstrates:
 * 1. Setting up the NodeRegistry with custom nodes
 * 2. Initializing the WorkflowEngine with in-memory storage
 * 3. Registering and executing a simple workflow
 */

// --- Custom Store for Persistence in Example ---
// The default InMemoryExecutionStore does NOT persist workflows (it returns dummy success).
// For robust examples where cache might miss (e.g. race conditions), we implement a simple map.
class RobustInMemoryStore extends InMemoryExecutionStore {
    private savedWorkflows = new Map<string, WorkflowDefinition>();

    async saveWorkflow(workflow: WorkflowDefinition): Promise<number> {
        this.savedWorkflows.set(workflow.id, workflow);
        return 1;
    }

    async getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
        return this.savedWorkflows.get(workflowId) || null;
    }
}

async function runExample() {
    console.log("🚀 Starting SPANE Basic Example");

    // --- 1. Infrastructure Setup ---
    // BullMQ requires a Redis connection with maxRetriesPerRequest: null
    const redis = new Redis({ maxRetriesPerRequest: null });

    // Use robust store
    const store = new RobustInMemoryStore();

    // Registry holds the logic for your nodes
    const registry = new NodeRegistry();

    // --- 2. Register Custom Nodes ---
    // A simple node that explicitly takes a string input and uppercases it
    registry.register('uppercase', {
        execute: async (context) => {
            // Context contains inputData, config, and other execution metadata
            const input = context.inputData.text;
            console.log(`   [Node: ${context.nodeId}] Uppercasing: "${input}"`);

            if (typeof input !== 'string') {
                return { success: false, error: 'Input "text" must be a string' };
            }

            return {
                success: true,
                data: {
                    original: input,
                    uppercased: input.toUpperCase()
                }
            };
        }
    });

    console.log("✅ Registered 'uppercase' node type");

    // --- 3. Initialize Engine ---
    const engine = new WorkflowEngine(registry, store, redis);

    // Start the internal workers (BullMQ)
    engine.startWorkers();
    console.log("✅ Engine started");

    try {
        // --- 4. Define a Workflow ---
        const workflowId = 'simple-uppercase-flow';
        const workflow: WorkflowDefinition = {
            id: workflowId,
            name: 'Simple Uppercase Workflow',
            nodes: [
                {
                    id: 'step-1',
                    type: 'uppercase',
                    config: {}, // No specific config needed for this node
                    inputs: [], // Empty inputs means it's an entry node or receives workflow input
                    outputs: []
                }
            ],
            entryNodeId: 'step-1'
        };

        // --- 5. Register Workflow ---
        // This validates the graph and saves it to the store
        await engine.registerWorkflow(workflow);
        console.log(`✅ Workflow '${workflowId}' registered`);

        // --- 6. Execute Workflow ---
        const initialData = { text: 'hello spane world' };

        console.log("▶️ Triggering workflow...");
        const executionId = await engine.enqueueWorkflow(workflowId, initialData);
        console.log(`   Execution ID: ${executionId}`);

        // --- 7. Poll for completion ---
        console.log("⏳ Waiting for completion...");

        for (let i = 0; i < 20; i++) { // Max 10 seconds
            const execution = await store.getExecution(executionId);

            if (execution?.status === 'completed') {
                console.log("\n🎉 Workflow Completed Successfully!");

                // Fetch results
                const results = await store.getNodeResults(executionId, ['step-1']);
                console.log("   Output:", results['step-1'].data);
                break;
            }

            if (execution?.status === 'failed') {
                console.error("\n❌ Workflow Failed");
                // Debug failure
                const logs = await store.getLogs(executionId);
                const errorLog = logs.find(l => l.level === 'error');
                console.error("   Reason:", errorLog?.message);
                break;
            }

            await new Promise(r => setTimeout(r, 500));
        }

    } catch (error) {
        console.error("❌ Error running example:", error);
    } finally {
        // --- Cleanup ---
        console.log("\n🛑 Shutting down...");
        await engine.close();
        redis.disconnect();
    }
}

// Run the example
if (require.main === module) {
    runExample().catch(console.error);
}
