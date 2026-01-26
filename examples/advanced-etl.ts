
import {
    WorkflowEngine,
    NodeRegistry,
    InMemoryExecutionStore,
    type WorkflowDefinition,
    type ExecutionContext
} from '../src';
import { Redis } from 'ioredis';

/**
 * Advanced ETL Example (Extract, Transform, Load)
 * 
 * Demonstrates:
 * 1. Data passing between nodes (Parent -> Child)
 * 2. Branching dependencies (One output -> Multiple downstream nodes)
 * 3. Simulating external API calls with rate limiting awareness
 * 4. Error handling and validation
 */

// --- node types ---

interface UserRaw {
    id: number;
    name: string;
    email: string;
    signup_date: string; // ISO string
}

interface UserEnriched extends UserRaw {
    days_active: number;
    segment: 'new' | 'veteran';
}

async function runAdvancedExample() {
    console.log("🚀 Starting Advanced ETL Example");

    const redis = new Redis({ maxRetriesPerRequest: null });
    const store = new InMemoryExecutionStore();
    const registry = new NodeRegistry();

    // --- 1. Register 'Extract' Node ---
    // Simulates fetching raw data from an external API
    registry.register('extract-users', {
        execute: async (context: ExecutionContext) => {
            console.log(`   [Node: ${context.nodeId}] 📥 Extracting users from 'External API'...`);

            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 500));

            const rawUsers: UserRaw[] = [
                { id: 1, name: "Alice", email: "alice@example.com", signup_date: "2023-01-15T10:00:00Z" },
                { id: 2, name: "Bob", email: "bob-no-at-symbol", signup_date: "2023-06-20T10:00:00Z" }, // Invalid email
                { id: 3, name: "Charlie", email: "charlie@example.com", signup_date: "2024-01-10T10:00:00Z" }
            ];

            return { success: true, data: { users: rawUsers } };
        }
    });

    // --- 2. Register 'Transform' Node ---
    // Cleans data and enriches it
    registry.register('transform-users', {
        execute: async (context: ExecutionContext) => {
            // Input comes from 'extract-users' node
            // When a node has 1 input, context.inputData is the data from that parent
            const rawUsers = context.inputData.users as UserRaw[];
            console.log(`   [Node: ${context.nodeId}] 🔄 Transforming ${rawUsers.length} records...`);

            const validUsers: UserEnriched[] = [];
            const errors: string[] = [];

            const now = new Date("2024-02-01T00:00:00Z").getTime();

            for (const user of rawUsers) {
                // Validation
                if (!user.email.includes('@')) {
                    errors.push(`Invalid email for user ${user.id}: ${user.email}`);
                    continue;
                }

                // Enrichment
                const signup = new Date(user.signup_date).getTime();
                const diffTime = Math.abs(now - signup);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                validUsers.push({
                    ...user,
                    days_active: diffDays,
                    segment: diffDays < 30 ? 'new' : 'veteran'
                });
            }

            console.log(`   [Node: ${context.nodeId}] ✅ Transformed. ${validUsers.length} valid, ${errors.length} rejected.`);

            return {
                success: true,
                data: {
                    validUsers,
                    rejectedCount: errors.length,
                    validationErrors: errors
                }
            };
        }
    });

    // --- 3. Register 'Load Database' Node ---
    registry.register('load-database', {
        execute: async (context: ExecutionContext) => {
            const { validUsers } = context.inputData; // From transform node
            console.log(`   [Node: ${context.nodeId}] 💾 Upserting ${validUsers.length} users to Database...`);

            // Simulate DB Write
            await new Promise(resolve => setTimeout(resolve, 300));

            return { success: true, data: { inserted: validUsers.length } };
        }
    });

    // --- 4. Register 'Load Analytics' Node ---
    // Demonstrates parallel execution - this runs same time as load-database
    registry.register('load-analytics', {
        execute: async (context: ExecutionContext) => {
            const { validUsers, rejectedCount } = context.inputData;
            console.log(`   [Node: ${context.nodeId}] 📊 Sending metrics to Analytics Service...`);

            // Calculate some stats
            const segments = validUsers.reduce((acc: any, u: UserEnriched) => {
                acc[u.segment] = (acc[u.segment] || 0) + 1;
                return acc;
            }, {});

            console.log(`   [Node: ${context.nodeId}] Stats:`, JSON.stringify(segments));

            return {
                success: true,
                data: {
                    eventsSent: validUsers.length,
                    dataQualityScore: (validUsers.length / (validUsers.length + rejectedCount)) * 100
                }
            };
        }
    });

    const engine = new WorkflowEngine(registry, store, redis);
    engine.startWorkers();

    try {
        const workflowId = 'etl-user-processing';
        const workflow: WorkflowDefinition = {
            id: workflowId,
            name: 'User Data ETL Pipeline',
            nodes: [
                {
                    id: 'extract',
                    type: 'extract-users',
                    config: {},
                    inputs: [],
                    outputs: ['transform']
                },
                {
                    id: 'transform',
                    type: 'transform-users',
                    config: {},
                    inputs: ['extract'], // Depends on extract
                    outputs: ['load-db', 'load-analytics']
                },
                {
                    id: 'load-db',
                    type: 'load-database',
                    config: {},
                    inputs: ['transform'], // Branch 1
                    outputs: []
                },
                {
                    id: 'load-analytics',
                    type: 'load-analytics',
                    config: {},
                    inputs: ['transform'], // Branch 2 (Parallel)
                    outputs: []
                }
            ],
            entryNodeId: 'extract'
        };

        await engine.registerWorkflow(workflow);
        console.log(`✅ Workflow '${workflowId}' registered`);

        console.log("▶️ Triggering ETL...");
        const executionId = await engine.enqueueWorkflow(workflowId, {});
        console.log(`   Execution ID: ${executionId}`);

        // Poll integration
        let complete = false;
        while (!complete) {
            const execution = await store.getExecution(executionId);
            const status = execution?.status;

            if (status === 'completed') {
                complete = true;
                console.log("\n🎉 ETL Pipeline Completed!");

                // Get all results
                const results = await store.getNodeResults(executionId, ['load-db', 'load-analytics']);
                console.log("   DB Results:", results['load-db'].data);
                console.log("   Analytics Results:", results['load-analytics'].data);
            } else if (status === 'failed') {
                complete = true;
                console.error("❌ ETL Pipeline Failed");
            }

            await new Promise(r => setTimeout(r, 500));
        }

    } catch (e) {
        console.error(e);
    } finally {
        await engine.close();
        redis.disconnect();
    }
}

if (require.main === module) {
    runAdvancedExample().catch(console.error);
}
