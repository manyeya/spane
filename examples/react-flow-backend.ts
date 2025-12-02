import { Elysia } from 'elysia';
import { WorkflowEngine } from '../workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../inmemory-store';
import IORedis from 'ioredis';
import type { WorkflowDefinition, NodeDefinition, ExecutionContext, ExecutionResult } from '../types';

// Initialize Redis connection
const redis = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null
});

// Initialize node registry
const registry = new NodeRegistry();

// Register basic node handlers using the correct executor pattern
registry.register('trigger', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Trigger node executing');
        // Trigger nodes just pass through the initial data
        return { success: true, data: context.inputData };
    }
});

registry.register('schedule', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Schedule trigger executing');
        return { success: true, data: context.inputData };
    }
});

registry.register('webhook', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Webhook trigger executing');
        return { success: true, data: context.inputData };
    }
});

registry.register('http', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('HTTP node executing with nodeConfig:', context.nodeConfig);
        console.log('HTTP node inputData:', context.inputData);
        
        // Get HTTP configuration from node's own config (set in the UI)
        const config = context.nodeConfig || {};
        const {
            url,
            method = 'GET',
            headers = {},
            body,
            queryParams,
            timeout = 30000,
            responseType = 'json'
        } = config;

        if (!url) {
            return {
                success: false,
                error: 'URL is required for HTTP node',
                data: { executed: false }
            };
        }

        try {
            // Build URL with query parameters
            let requestUrl = url;
            if (queryParams && Object.keys(queryParams).length > 0) {
                const params = new URLSearchParams(queryParams);
                requestUrl = `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
            }

            // Prepare fetch options
            const fetchOptions: RequestInit = {
                method: method.toUpperCase(),
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                signal: AbortSignal.timeout(timeout)
            };

            // Add body for methods that support it
            if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
                fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
            }

            console.log(`HTTP ${method} request to: ${requestUrl}`);
            
            // Execute the HTTP request
            const response = await fetch(requestUrl, fetchOptions);

            // Parse response based on content type or specified responseType
            let responseData: any;
            const contentType = response.headers.get('content-type') || '';

            if (responseType === 'text' || contentType.includes('text/')) {
                responseData = await response.text();
            } else if (responseType === 'blob') {
                responseData = await response.blob();
            } else if (responseType === 'arrayBuffer') {
                responseData = await response.arrayBuffer();
            } else {
                // Default to JSON
                try {
                    responseData = await response.json();
                } catch {
                    responseData = await response.text();
                }
            }

            // Extract response headers
            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            const result = {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                data: responseData,
                ok: response.ok
            };

            console.log(`HTTP response status: ${response.status}`);

            // Determine success based on HTTP status
            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                    data: result
                };
            }

            return {
                success: true,
                data: result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('HTTP request failed:', errorMessage);
            
            return {
                success: false,
                error: `HTTP request failed: ${errorMessage}`,
                data: { executed: false }
            };
        }
    }
});

registry.register('transform', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Transform node executing');
        return { success: true, data: context.inputData };
    }
});

registry.register('email', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Email node executing');
        return { success: true, data: { sent: true } };
    }
});

registry.register('database', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Database node executing');
        return { success: true, data: { rows: [] } };
    }
});

registry.register('action', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Action node executing');
        return { success: true, data: context.inputData };
    }
});

registry.register('condition', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Condition node executing');
        // Condition nodes pass through data and determine which branch to take
        return { success: true, data: context.inputData };
    }
});

// Initialize state store (using in-memory for this example)
const stateStore = new InMemoryExecutionStore();

// Initialize the workflow engine with all required dependencies
const engine = new WorkflowEngine(
    registry,
    stateStore,
    redis
);

// Start the workers
engine.startWorkers(5);

// Store for execution tracking
const executions = new Map<string, any>();

// Poll execution state from the engine store
async function updateExecutionFromStore(executionId: string, execution: any) {
    try {
        const state = await stateStore.getExecution(executionId);
        if (state) {
            // Map node results to statuses
            const nodeStatuses: Record<string, string> = {};
            const nodeResults: Record<string, any> = {};
            
            for (const [nodeId, result] of Object.entries(state.nodeResults || {})) {
                nodeStatuses[nodeId] = result.success ? 'success' : 'error';
                nodeResults[nodeId] = result;
            }
            
            execution.nodeStatuses = nodeStatuses;
            execution.nodeResults = nodeResults;
            execution.status = state.status === 'completed' ? 'success' : 
                              state.status === 'failed' ? 'error' : state.status;
            
            if (state.completedAt) {
                execution.completedAt = state.completedAt;
            }
        }
    } catch (error) {
        console.error('Error updating execution from store:', error);
    }
}

// Convert React Flow workflow to spane workflow
function convertToSpaneWorkflow(reactFlowWorkflow: any): WorkflowDefinition {
    console.log('Converting workflow:', JSON.stringify(reactFlowWorkflow, null, 2));

    // Start with the actual nodes from the frontend
    const nodes: NodeDefinition[] = reactFlowWorkflow.nodes.map((node: any) => {
        // Use the specific node type (http, transform, etc.) if available, otherwise fall back to generic type
        const nodeType = node.config?.type || node.type || 'action';
        return {
            id: node.id,
            type: nodeType,
            config: node.config || {},
            inputs: node.dependencies || [],
            outputs: []
        };
    });

    // Add a virtual trigger node if there's a trigger
    if (reactFlowWorkflow.trigger) {
        const triggerNode: NodeDefinition = {
            id: 'node-0',
            type: 'trigger',
            config: reactFlowWorkflow.trigger.config || {},
            inputs: [],
            outputs: []
        };

        // Find nodes that have no dependencies (they should connect to trigger)
        for (const node of nodes) {
            if (node.inputs.length === 0) {
                node.inputs.push('node-0');
            }
        }

        nodes.unshift(triggerNode);
    }

    // Calculate outputs for each node based on other nodes' inputs
    for (const node of nodes) {
        for (const inputNodeId of node.inputs) {
            const inputNode = nodes.find(n => n.id === inputNodeId);
            if (inputNode && !inputNode.outputs.includes(node.id)) {
                inputNode.outputs.push(node.id);
            }
        }
    }

    const workflow: WorkflowDefinition = {
        id: `workflow-${Date.now()}`,
        name: 'React Flow Workflow',
        entryNodeId: 'node-0',
        nodes,
        triggers: reactFlowWorkflow.trigger ? [reactFlowWorkflow.trigger] : []
    };

    console.log('Converted workflow:', JSON.stringify(workflow, null, 2));

    return workflow;
}

// Create Elysia server
const app = new Elysia()
    .get('/api/health', () => ({ status: 'ok' }))

    .post('/api/workflows/execute', async ({ body }: { body: any }) => {
        try {
            console.log('Received workflow execution request:', JSON.stringify(body, null, 2));

            // Convert React Flow workflow to spane workflow
            const spaneWorkflow = convertToSpaneWorkflow(body);

            // Register workflow with engine
            await engine.registerWorkflow(spaneWorkflow);

            // Enqueue workflow for execution
            const executionId = await engine.enqueueWorkflow(spaneWorkflow.id, {
                source: 'manual',
                timestamp: Date.now()
            });

            // Store execution info
            executions.set(executionId, {
                executionId,
                workflowId: spaneWorkflow.id,
                status: 'running',
                nodeStatuses: {},
                startedAt: Date.now()
            });

            // Simulate execution progress (in real implementation, this would come from BullMQ events)
            setTimeout(async () => {
                const execution = executions.get(executionId);
                if (execution) {
                    // Update node statuses
                    for (const node of body.nodes) {
                        execution.nodeStatuses[node.id] = 'running';
                    }

                    // Simulate completion after some time
                    setTimeout(() => {
                        for (const node of body.nodes) {
                            execution.nodeStatuses[node.id] = 'success';
                        }
                        execution.status = 'success';
                        execution.completedAt = Date.now();
                    }, 3000);
                }
            }, 500);

            return {
                executionId,
                status: 'running',
                nodeStatuses: {}
            };
        } catch (error) {
            console.error('Workflow execution failed:', error);
            return {
                executionId: 'error',
                status: 'error',
                error: (error as Error).message,
                nodeStatuses: {}
            };
        }
    })

    .get('/api/workflows/executions/:id', async ({ params }: { params: { id: string } }) => {
        const execution = executions.get(params.id);

        if (!execution) {
            return {
                executionId: params.id,
                status: 'error',
                error: 'Execution not found',
                nodeStatuses: {},
                nodeResults: {}
            };
        }

        // Update from store to get real results
        await updateExecutionFromStore(params.id, execution);

        return {
            ...execution,
            nodeResults: execution.nodeResults || {}
        };
    })

    .listen(3001);

console.log(`🚀 React Flow n8n Backend running at http://localhost:3001`);
console.log(`📊 API endpoints:`);
console.log(`   - POST /api/workflows/execute`);
console.log(`   - GET  /api/workflows/executions/:id`);
console.log(`   - GET  /api/health`);
