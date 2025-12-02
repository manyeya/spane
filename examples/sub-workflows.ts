import { WorkflowEngine } from '../workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import { Redis } from 'ioredis';
import type { WorkflowDefinition, ExecutionContext, ExecutionResult } from '../types';

// 1. Setup
const redis = new Redis({ maxRetriesPerRequest: null });
const registry = new NodeRegistry();
const store = new InMemoryExecutionStore();
const engine = new WorkflowEngine(registry, store, redis);

// 2. Register Node Types
registry.register('start', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`[Depth ${context.depth}] Start node executed`);
        return {
            success: true,
            data: {
                userId: 'user-123',
                action: 'signup',
                timestamp: Date.now()
            }
        };
    }
});

registry.register('process-data', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`[Depth ${context.depth}] Processing data:`, context.inputData);
        return {
            success: true,
            data: {
                ...context.inputData,
                processed: true,
                processorId: context.nodeId
            }
        };
    }
});

registry.register('send-email', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        const { recipient, subject } = context.inputData || {};
        console.log(`[Depth ${context.depth}] 📧 Sending email to:`, recipient, '| Subject:', subject);

        // Simulate email sending
        await new Promise(resolve => setTimeout(resolve, 100));

        return {
            success: true,
            data: {
                emailSent: true,
                recipient,
                subject,
                sentAt: Date.now()
            }
        };
    }
});

registry.register('log-event', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`[Depth ${context.depth}] 📝 Logging event:`, context.inputData);
        return {
            success: true,
            data: {
                logged: true,
                logId: `log-${Date.now()}`,
                event: context.inputData
            }
        };
    }
});

registry.register('aggregate', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`[Depth ${context.depth}] 📊 Aggregating results:`, context.inputData);
        return {
            success: true,
            data: {
                aggregated: true,
                results: context.inputData
            }
        };
    }
});

// 3. Define Reusable Workflow Templates

// Template 1: Email notification workflow (reusable)
const emailNotificationWorkflow: WorkflowDefinition = {
    id: 'email-template',
    name: 'Email Notification Template',
    entryNodeId: 'email-start',
    nodes: [
        {
            id: 'email-start',
            type: 'process-data',
            config: {},
            inputs: [],
            outputs: ['email-send']
        },
        {
            id: 'email-send',
            type: 'send-email',
            config: {},
            inputs: ['email-start'],
            outputs: ['email-log']
        },
        {
            id: 'email-log',
            type: 'log-event',
            config: {},
            inputs: ['email-send'],
            outputs: []
        }
    ]
};

// Template 2: Logging workflow (reusable)
const loggingWorkflow: WorkflowDefinition = {
    id: 'logging-template',
    name: 'Logging Template',
    entryNodeId: 'log-start',
    nodes: [
        {
            id: 'log-start',
            type: 'log-event',
            config: {},
            inputs: [],
            outputs: []
        }
    ]
};

// 4. Define Main Workflows Using Sub-workflows

// Test 1: Basic sub-workflow call
const basicSubWorkflowTest: WorkflowDefinition = {
    id: 'basic-sub-workflow',
    name: 'Basic Sub-workflow Test',
    entryNodeId: 'basic-start',
    nodes: [
        {
            id: 'basic-start',
            type: 'start',
            config: {},
            inputs: [],
            outputs: ['call-email']
        },
        {
            id: 'call-email',
            type: 'sub-workflow',
            config: {
                workflowId: 'email-template',
                inputMapping: {
                    recipient: 'userId',
                    subject: 'action'
                },
                outputMapping: {
                    result: 'emailSent'
                }
            },
            inputs: ['basic-start'],
            outputs: ['final-log']
        },
        {
            id: 'final-log',
            type: 'log-event',
            config: {},
            inputs: ['call-email'],
            outputs: []
        }
    ]
};

// Test 2: Nested sub-workflows (3 levels deep)
const nestedSubWorkflowTest: WorkflowDefinition = {
    id: 'nested-sub-workflow',
    name: 'Nested Sub-workflow Test',
    entryNodeId: 'nested-start',
    nodes: [
        {
            id: 'nested-start',
            type: 'start',
            config: {},
            inputs: [],
            outputs: ['call-level-1']
        },
        {
            id: 'call-level-1',
            type: 'sub-workflow',
            config: {
                workflowId: 'level-1-workflow'
            },
            inputs: ['nested-start'],
            outputs: []
        }
    ]
};

const level1Workflow: WorkflowDefinition = {
    id: 'level-1-workflow',
    name: 'Level 1 Workflow',
    entryNodeId: 'l1-start',
    nodes: [
        {
            id: 'l1-start',
            type: 'process-data',
            config: {},
            inputs: [],
            outputs: ['call-level-2']
        },
        {
            id: 'call-level-2',
            type: 'sub-workflow',
            config: {
                workflowId: 'level-2-workflow'
            },
            inputs: ['l1-start'],
            outputs: []
        }
    ]
};

const level2Workflow: WorkflowDefinition = {
    id: 'level-2-workflow',
    name: 'Level 2 Workflow',
    entryNodeId: 'l2-start',
    nodes: [
        {
            id: 'l2-start',
            type: 'log-event',
            config: {},
            inputs: [],
            outputs: []
        }
    ]
};

// Test 3: Multiple sub-workflow calls (template reuse)
const multiSubWorkflowTest: WorkflowDefinition = {
    id: 'multi-sub-workflow',
    name: 'Multiple Sub-workflow Calls Test',
    entryNodeId: 'multi-start',
    nodes: [
        {
            id: 'multi-start',
            type: 'start',
            config: {},
            inputs: [],
            outputs: ['call-email-1', 'call-email-2', 'call-log-1']
        },
        {
            id: 'call-email-1',
            type: 'sub-workflow',
            config: {
                workflowId: 'email-template',
                inputMapping: { recipient: 'userId', subject: 'action' }
            },
            inputs: ['multi-start'],
            outputs: ['aggregate']
        },
        {
            id: 'call-email-2',
            type: 'sub-workflow',
            config: {
                workflowId: 'email-template',
                inputMapping: { recipient: 'userId', subject: 'action' }
            },
            inputs: ['multi-start'],
            outputs: ['aggregate']
        },
        {
            id: 'call-log-1',
            type: 'sub-workflow',
            config: {
                workflowId: 'logging-template'
            },
            inputs: ['multi-start'],
            outputs: ['aggregate']
        },
        {
            id: 'aggregate',
            type: 'aggregate',
            config: {},
            inputs: ['call-email-1', 'call-email-2', 'call-log-1'],
            outputs: []
        }
    ]
};

// Test 4: Error propagation test
const errorPropagationTest: WorkflowDefinition = {
    id: 'error-propagation-test',
    name: 'Error Propagation Test',
    entryNodeId: 'error-start',
    nodes: [
        {
            id: 'error-start',
            type: 'start',
            config: {},
            inputs: [],
            outputs: ['call-failing-workflow']
        },
        {
            id: 'call-failing-workflow',
            type: 'sub-workflow',
            config: {
                workflowId: 'failing-workflow'
            },
            inputs: ['error-start'],
            outputs: []
        }
    ]
};

const failingWorkflow: WorkflowDefinition = {
    id: 'failing-workflow',
    name: 'Failing Workflow',
    entryNodeId: 'fail-node',
    nodes: [
        {
            id: 'fail-node',
            type: 'intentional-fail',
            config: {},
            inputs: [],
            outputs: []
        }
    ]
};

registry.register('intentional-fail', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log(`[Depth ${context.depth}] ❌ Intentional failure`);
        return {
            success: false,
            error: 'Intentional failure for testing'
        };
    }
});

// 5. Run Tests
async function runTests() {
    console.log('\n=== SUB-WORKFLOWS & REUSABILITY TESTS ===\n');

    engine.startWorkers();

    // Register all workflows
    await engine.registerWorkflow(emailNotificationWorkflow);
    await engine.registerWorkflow(loggingWorkflow);
    await engine.registerWorkflow(basicSubWorkflowTest);
    await engine.registerWorkflow(nestedSubWorkflowTest);
    await engine.registerWorkflow(level1Workflow);
    await engine.registerWorkflow(level2Workflow);
    await engine.registerWorkflow(multiSubWorkflowTest);
    await engine.registerWorkflow(errorPropagationTest);
    await engine.registerWorkflow(failingWorkflow);

    console.log('✅ All workflows registered\n');

    // Test 1: Basic sub-workflow call
    console.log('--- Test 1: Basic Sub-workflow Call ---');
    const exec1 = await engine.enqueueWorkflow('basic-sub-workflow');
    await waitForCompletion(exec1, 'basic-sub-workflow');

    // Test 2: Nested sub-workflows
    console.log('\n--- Test 2: Nested Sub-workflows (3 levels) ---');
    const exec2 = await engine.enqueueWorkflow('nested-sub-workflow');
    await waitForCompletion(exec2, 'nested-sub-workflow');

    // Test 3: Template reuse
    console.log('\n--- Test 3: Template Reuse (Multiple Calls) ---');
    const exec3 = await engine.enqueueWorkflow('multi-sub-workflow');
    await waitForCompletion(exec3, 'multi-sub-workflow');

    // Test 4: Error propagation
    console.log('\n--- Test 4: Error Propagation ---');
    const exec4 = await engine.enqueueWorkflow('error-propagation-test');
    await waitForCompletion(exec4, 'error-propagation-test');

    console.log('\n=== ALL TESTS COMPLETED ===\n');
    await engine.close();
    process.exit(0);
}

async function waitForCompletion(executionId: string, workflowName: string) {
    const maxWait = 15000; // 15 seconds
    const pollInterval = 300;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
        const state = await store.getExecution(executionId);

        if (state?.status === 'completed') {
            console.log(`✅ ${workflowName} completed successfully`);
            console.log(`   Execution ID: ${executionId}`);
            console.log(`   Depth: ${state.depth}`);

            // Show child executions if any
            if (store.getChildExecutions) {
                const children = await store.getChildExecutions(executionId);
                if (children.length > 0) {
                    console.log(`   Child executions: ${children.length}`);
                    children.forEach(child => {
                        console.log(`     - ${child.executionId} (depth: ${child.depth}, status: ${child.status})`);
                    });
                }
            }
            return;
        }

        if (state?.status === 'failed') {
            console.error(`❌ ${workflowName} failed`);
            console.error(`   Execution ID: ${executionId}`);
            console.error(`   Node results:`, JSON.stringify(state.nodeResults, null, 2));
            return;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.error(`⏱️  ${workflowName} timed out`);
}

runTests();
