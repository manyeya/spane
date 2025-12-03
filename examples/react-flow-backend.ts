import { Elysia } from 'elysia';
import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../db/inmemory-store';
import IORedis from 'ioredis';
import type { WorkflowDefinition, NodeDefinition, ExecutionContext, ExecutionResult, WorkflowTrigger } from '../types';
import { DrizzleExecutionStateStore } from '../db/drizzle-store';

// Initialize Redis connection
console.log('🔌 Connecting to Redis...');
const redis = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null
});

redis.on('connect', () => {
    console.log('✅ Redis connected successfully');
});

redis.on('error', (error) => {
    console.error('❌ Redis connection error:', error);
});

// Initialize node registry
console.log('📋 Initializing node registry...');
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

registry.register('manual', {
    async execute(context: ExecutionContext): Promise<ExecutionResult> {
        console.log('Manual trigger executing');
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

// Initialize state store (using Drizzle with PostgreSQL)
const stateStore = new DrizzleExecutionStateStore(
    process.env.DATABASE_URL || 'postgresql://manyeya@localhost:5432/spane',
    redis
);

// Initialize the workflow engine with all required dependencies
console.log('🚀 Initializing workflow engine...');
const engine = new WorkflowEngine(
    registry,
    stateStore,
    redis
);
console.log('✅ Workflow engine initialized');

// Start the workers
console.log('👷 Starting workers...');
engine.startWorkers(5);
console.log('👷 Workers started');

// Poll execution state from the engine store
async function updateExecutionFromStore(executionId: string) {
    try {
        const state = await stateStore.getExecution(executionId);
        if (state) {
            const nodeStatuses: Record<string, string> = {};
            const nodeResults: Record<string, any> = {};

            for (const [nodeId, result] of Object.entries(state.nodeResults || {})) {
                nodeStatuses[nodeId] = result.skipped ? 'skipped' : result.success ? 'success' : 'error';
                nodeResults[nodeId] = result;
            }

            return {
                executionId: state.executionId,
                workflowId: state.workflowId,
                status: state.status === 'completed' ? 'success' :
                    state.status === 'failed' ? 'error' : state.status,
                nodeStatuses,
                nodeResults,
                startedAt: state.startedAt,
                completedAt: state.completedAt,
            };
        }
        return null;
    } catch (error) {
        console.error('Error updating execution from store:', error);
        return null;
    }
}

function convertToSpaneWorkflow(reactFlowWorkflow: any): WorkflowDefinition {
    console.log('🔄 Converting React Flow workflow to Spane format:', JSON.stringify(reactFlowWorkflow, null, 2));

    const { nodes: reactFlowNodes, edges } = reactFlowWorkflow;

    // Debug: Check if we have nodes
    if (!reactFlowNodes || reactFlowNodes.length === 0) {
        console.error('❌ No nodes found in workflow');
        throw new Error('Workflow must contain at least one node');
    }

    const spaneNodes: NodeDefinition[] = reactFlowNodes.map((node: any) => {
        // Determine inputs and outputs from edges
        const inputs = edges.filter((e: any) => e.target === node.id).map((e: any) => e.source);
        const outputs = edges.filter((e: any) => e.source === node.id).map((e: any) => e.target);

        const nodeConfig = node.config || node.data?.config || {};
        console.log(`📝 Converting node ${node.id} (${node.name || node.data?.label}):`, {
            type: node.data?.type || node.type,
            config: nodeConfig
        });

        return {
            id: node.id,
            type: node.data?.type || node.type,
            config: nodeConfig,
            inputs,
            outputs,
        };
    });

    // Find the trigger node to determine entry point
    const triggerNode = spaneNodes.find(n => n.type === 'trigger');
    const entryNodeId = triggerNode?.id || spaneNodes[0]?.id || '';

    if (!entryNodeId) {
        console.error('❌ No entry node found in workflow');
        throw new Error('Could not determine entry node for workflow');
    }

    console.log(`🎯 Entry node identified: ${entryNodeId}`);

    // Convert triggers from the React Flow format to Spane format
    const triggers: WorkflowTrigger[] = [];

    // Check both reactFlowWorkflow.trigger and also look for trigger nodes in the nodes array
    if (reactFlowWorkflow.trigger) {
        console.log('📋 Found trigger in workflow definition:', reactFlowWorkflow.trigger);
        if (reactFlowWorkflow.trigger.type === 'webhook') {
            triggers.push({
                type: 'webhook',
                config: {
                    path: reactFlowWorkflow.trigger.config.path || '/webhook',
                    method: reactFlowWorkflow.trigger.config.method || 'POST'
                }
            });
        } else if (reactFlowWorkflow.trigger.type === 'schedule') {
            triggers.push({
                type: 'schedule',
                config: {
                    cron: reactFlowWorkflow.trigger.config.cron || '0 * * * *',
                    timezone: reactFlowWorkflow.trigger.config.timezone
                }
            });
        }
    } else if (triggerNode) {
        // If no explicit trigger in workflow definition, but we found a trigger node
        console.log('📋 Using trigger node from nodes array:', triggerNode);
        // Create a generic trigger configuration
        triggers.push({
            type: 'webhook', // Default to webhook for trigger nodes
            config: {
                path: '/webhook',
                method: 'POST'
            }
        });
    }

    const workflow: WorkflowDefinition = {
        id: `workflow-${Date.now()}`,
        name: 'React Flow Workflow',
        nodes: spaneNodes,
        entryNodeId: entryNodeId,
        triggers: triggers.length > 0 ? triggers : undefined
    };

    console.log('✅ Workflow conversion complete:', JSON.stringify(workflow, null, 2));
    return workflow;
}

// Create Elysia server
const app = new Elysia()
    .onBeforeHandle(({ set }) => {
        // Enable CORS for all routes
        set.headers['Access-Control-Allow-Origin'] = '*';
        set.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        set.headers['Access-Control-Allow-Headers'] = 'Content-Type';
    })
    // Handle OPTIONS preflight requests - return empty response, headers set by onBeforeHandle
    .options('/api/workflows/execute', () => new Response(null, { status: 204 }))
    .options('/api/workflows/executions/:id', () => new Response(null, { status: 204 }))
    .options('/api/health', () => new Response(null, { status: 204 }))
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
        console.log(`🔍 Polling status for execution ${params.id}`);
        const execution = await updateExecutionFromStore(params.id);

        if (!execution) {
            return {
                executionId: params.id,
                status: 'error',
                error: 'Execution not found',
                nodeStatuses: {},
                nodeResults: {}
            };
        }

        return execution;
    })

    // ============================================================================
    // DURABILITY & RELIABILITY ENDPOINTS
    // ============================================================================

    // List all workflows
    .get('/api/workflows', async () => {
        try {
            const workflows = engine.getAllWorkflows();
            return {
                success: true,
                workflows: Array.from(workflows.values()),
                count: workflows.size
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Get workflow version history
    .get('/api/workflows/:workflowId/versions', async ({ params }: { params: { workflowId: string } }) => {
        try {
            if ('getWorkflowVersions' in stateStore) {
                const versions = await (stateStore as any).getWorkflowVersions(params.workflowId);
                return {
                    success: true,
                    versions
                };
            }
            return {
                success: false,
                error: 'Workflow versioning not supported'
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // System health (new HealthMonitor)
    .get('/api/system/health', async () => {
        try {
            if ('healthMonitor' in engine && (engine as any).healthMonitor) {
                const healthMonitor = (engine as any).healthMonitor;
                const health = healthMonitor.getLastHealthStatus();
                if (health) {
                    return {
                        success: true,
                        ...health
                    };
                }
            }
            return {
                success: true,
                overall: 'healthy',
                timestamp: new Date()
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Set execution timeout
    .post('/api/executions/:executionId/timeout', async ({ params, body }: { params: { executionId: string }, body: any }) => {
        try {
            const { timeoutMs } = body;
            if (!timeoutMs || timeoutMs <= 0) {
                return {
                    success: false,
                    error: 'timeoutMs must be a positive number'
                };
            }

            if ('timeoutMonitor' in engine && (engine as any).timeoutMonitor) {
                const timeoutMonitor = (engine as any).timeoutMonitor;
                await timeoutMonitor.setExecutionTimeout(params.executionId, timeoutMs);
                return {
                    success: true,
                    message: `Timeout set for execution ${params.executionId}`,
                    timeoutAt: new Date(Date.now() + timeoutMs)
                };
            }

            return {
                success: false,
                error: 'Timeout monitoring not available'
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Get DLQ items
    .get('/api/dlq', async ({ query }: { query: any }) => {
        try {
            const start = parseInt(query.start || '0');
            const end = parseInt(query.end || '10');
            const items = await engine.getDLQItems(start, end);
            return {
                success: true,
                items,
                count: items.length
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Retry DLQ item
    .post('/api/dlq/:dlqJobId/retry', async ({ params }: { params: { dlqJobId: string } }) => {
        try {
            const success = await engine.retryDLQItem(params.dlqJobId);
            if (!success) {
                return {
                    success: false,
                    error: 'DLQ item not found'
                };
            }
            return {
                success: true,
                message: 'DLQ item retried'
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Pause workflow execution
    .post('/api/executions/:executionId/pause', async ({ params }: { params: { executionId: string } }) => {
        try {
            await engine.pauseWorkflow(params.executionId);
            return {
                success: true,
                message: 'Workflow paused'
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Resume workflow execution
    .post('/api/executions/:executionId/resume', async ({ params }: { params: { executionId: string } }) => {
        try {
            await engine.resumeWorkflow(params.executionId);
            return {
                success: true,
                message: 'Workflow resumed'
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Cancel workflow execution
    .post('/api/executions/:executionId/cancel', async ({ params }: { params: { executionId: string } }) => {
        try {
            await engine.cancelWorkflow(params.executionId);
            return {
                success: true,
                message: 'Workflow cancelled'
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    .listen(3001, ({ hostname, port }) => {
        console.log(`🚀 React Flow n8n Backend running at http://${hostname}:${port}`);
        console.log(`📊 API endpoints:`);
        console.log(`   - POST /api/workflows/execute`);
        console.log(`   - GET  /api/workflows/executions/:id`);
        console.log(`   - GET  /api/health`);
        console.log(`   - GET  /api/workflows - List all workflows`);
        console.log(`   - GET  /api/workflows/:id/versions - Version history`);
        console.log(`   - GET  /api/system/health - System health status`);
        console.log(`   - POST /api/executions/:id/timeout - Set timeout`);
        console.log(`   - GET  /api/dlq - List DLQ items`);
        console.log(`   - POST /api/dlq/:id/retry - Retry DLQ item`);
        console.log(`   - POST /api/executions/:id/pause - Pause execution`);
        console.log(`   - POST /api/executions/:id/resume - Resume execution`);
        console.log(`   - POST /api/executions/:id/cancel - Cancel execution`);
    });
