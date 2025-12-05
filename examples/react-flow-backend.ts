import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { WorkflowEngine } from '../engine/workflow-engine';
import { NodeRegistry } from '../engine/registry';
import type { WorkflowEvent, ErrorEvent } from '../engine/event-types';
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

// Start the workers (this also starts the EventStreamManager)
console.log('👷 Starting workers...');
engine.startWorkers(5);
console.log('👷 Workers started');

// Get the EventStreamManager from the engine for SSE endpoints
const eventStreamManager = engine.getEventStream();
console.log('📡 Event stream manager ready (via WorkflowEngine)');

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

// Create Elysia server with CORS enabled
const app = new Elysia()
    .use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: false
    }))
    .onError(({ code, error, set }) => {
        // Ensure CORS headers are set even on errors
        set.headers['Access-Control-Allow-Origin'] = '*';
        set.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        set.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
        
        console.error(`Error ${code}:`, error);
        return {
            success: false,
            error: error || 'An error occurred',
            code
        };
    })
    .get('/api/health', () => ({ status: 'ok' }))
    
    // Queue statistics endpoint (for monitoring dashboard)
    .get('/api/stats', async () => {
        try {
            const stats = await engine.getQueueStats();
            return {
                success: true,
                ...stats
            };
        } catch (error) {
            return {
                success: true,
                waiting: 0,
                active: 0,
                completed: 0,
                failed: 0,
                delayed: 0,
                paused: 0
            };
        }
    })

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

    // List all workflows with pagination
    .get('/api/workflows', async ({ query }: { query: any }) => {
        try {
            const limit = Math.min(parseInt(query.limit || '100'), 500); // Cap at 500
            const offset = parseInt(query.offset || '0');
            const activeOnly = query.activeOnly !== 'false';

            const workflows = await engine.getAllWorkflowsFromDatabase(activeOnly, limit, offset);
            
            // Get total count for pagination
            let total = workflows.length;
            if ('getWorkflowCount' in stateStore) {
                total = await (stateStore as any).getWorkflowCount(activeOnly);
            }

            return {
                success: true,
                workflows,
                count: workflows.length,
                total,
                limit,
                offset,
                hasMore: offset + workflows.length < total
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Get single workflow by ID (with optional version)
    .get('/api/workflows/:workflowId', async ({ params, query }: { params: { workflowId: string }, query: any }) => {
        try {
            const version = query.version ? parseInt(query.version) : undefined;
            const workflow = await engine.getWorkflowFromDatabase(params.workflowId, version);
            
            if (!workflow) {
                return {
                    success: false,
                    error: `Workflow ${params.workflowId} not found`
                };
            }

            // Check if workflow has reactFlowData (stored when saving from UI)
            const hasReactFlowData = (workflow as any).reactFlowData?.nodes?.length > 0;
            
            // Return workflow with React Flow data if available
            return {
                success: true,
                workflow: {
                    id: workflow.id,
                    name: workflow.name,
                    entryNodeId: workflow.entryNodeId,
                    triggers: workflow.triggers,
                    // Include reactFlowData so frontend can properly extract it
                    reactFlowData: hasReactFlowData ? (workflow as any).reactFlowData : undefined,
                    // Also include nodes/edges directly for backwards compatibility
                    nodes: hasReactFlowData 
                        ? (workflow as any).reactFlowData.nodes 
                        : workflow.nodes.map((n: any) => ({
                            id: n.id,
                            type: n.type,
                            position: n.position || { x: 0, y: 0 },
                            data: { label: n.id, type: n.type, config: n.config || {} }
                        })),
                    edges: hasReactFlowData 
                        ? (workflow as any).reactFlowData.edges 
                        : [],
                }
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

    // ============================================================================
    // WORKFLOW CRUD ENDPOINTS (Task 14)
    // ============================================================================

    // Create new workflow
    .post('/api/workflows', async ({ body }: { body: any }) => {
        try {
            const { name, nodes, edges, triggers, entryNodeId } = body;
            
            if (!name || typeof name !== 'string' || name.trim() === '') {
                return {
                    success: false,
                    error: 'Workflow name is required and cannot be empty'
                };
            }

            // Generate workflow ID
            const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Convert React Flow format to Spane workflow
            const spaneWorkflow = convertToSpaneWorkflow({
                nodes: nodes || [],
                edges: edges || [],
                trigger: triggers?.[0]
            });
            
            // Override with provided values
            spaneWorkflow.id = workflowId;
            spaneWorkflow.name = name.trim();
            if (entryNodeId) {
                spaneWorkflow.entryNodeId = entryNodeId;
            }
            if (triggers) {
                spaneWorkflow.triggers = triggers;
            }

            // Store React Flow data alongside Spane workflow for UI reconstruction
            const workflowWithReactFlowData = {
                ...spaneWorkflow,
                reactFlowData: {
                    nodes: nodes || [],
                    edges: edges || []
                }
            };

            // Register workflow with engine (saves to database)
            await engine.registerWorkflow(workflowWithReactFlowData);

            return {
                success: true,
                workflowId,
                message: `Workflow '${name}' created successfully`
            };
        } catch (error) {
            console.error('Failed to create workflow:', error);
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Update existing workflow (Task 14.1)
    .put('/api/workflows/:workflowId', async ({ params, body }: { params: { workflowId: string }, body: any }) => {
        try {
            const { name, nodes, edges, triggers, entryNodeId, changeNotes } = body;
            
            // Check if workflow exists
            const existingWorkflow = await engine.getWorkflow(params.workflowId);
            if (!existingWorkflow) {
                return {
                    success: false,
                    error: `Workflow ${params.workflowId} not found`
                };
            }

            // Convert React Flow format to Spane workflow
            const spaneWorkflow = convertToSpaneWorkflow({
                nodes: nodes || [],
                edges: edges || [],
                trigger: triggers?.[0]
            });
            
            // Preserve workflow ID and update other fields
            spaneWorkflow.id = params.workflowId;
            spaneWorkflow.name = name?.trim() || existingWorkflow.name;
            if (entryNodeId) {
                spaneWorkflow.entryNodeId = entryNodeId;
            }
            if (triggers) {
                spaneWorkflow.triggers = triggers;
            }

            // Store React Flow data alongside Spane workflow for UI reconstruction
            const workflowWithReactFlowData = {
                ...spaneWorkflow,
                reactFlowData: {
                    nodes: nodes || [],
                    edges: edges || []
                }
            };

            // Register workflow with engine (creates new version)
            await engine.registerWorkflow(workflowWithReactFlowData, changeNotes);

            return {
                success: true,
                workflowId: params.workflowId,
                message: `Workflow '${spaneWorkflow.name}' updated successfully`
            };
        } catch (error) {
            console.error('Failed to update workflow:', error);
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Delete (deactivate) workflow (Task 14.2)
    .delete('/api/workflows/:workflowId', async ({ params }: { params: { workflowId: string } }) => {
        try {
            // Check if workflow exists
            const existingWorkflow = await engine.getWorkflow(params.workflowId);
            if (!existingWorkflow) {
                return {
                    success: false,
                    error: `Workflow ${params.workflowId} not found`
                };
            }

            // Deactivate workflow (soft delete)
            await stateStore.deactivateWorkflow(params.workflowId);

            return {
                success: true,
                message: `Workflow ${params.workflowId} deleted successfully`
            };
        } catch (error) {
            console.error('Failed to delete workflow:', error);
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // List all executions with optional workflow filter and pagination (Task 14.3)
    .get('/api/executions', async ({ query }: { query: any }) => {
        try {
            const workflowId = query.workflowId || undefined;
            const limit = Math.min(parseInt(query.limit || '100'), 500); // Cap at 500
            const offset = parseInt(query.offset || '0');

            const executions = await stateStore.listExecutions(workflowId, limit, offset);
            
            // Get total count for pagination
            let total = executions.length;
            if ('getExecutionCount' in stateStore) {
                total = await (stateStore as any).getExecutionCount(workflowId);
            }

            return {
                success: true,
                executions,
                count: executions.length,
                total,
                limit,
                offset,
                hasMore: offset + executions.length < total
            };
        } catch (error) {
            console.error('Failed to list executions:', error);
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // Replay execution (Task 14.4)
    .post('/api/executions/:executionId/replay', async ({ params }: { params: { executionId: string } }) => {
        try {
            const newExecutionId = await engine.replayWorkflow(params.executionId);
            
            return {
                success: true,
                executionId: newExecutionId,
                originalExecutionId: params.executionId,
                message: 'Execution replay started'
            };
        } catch (error) {
            console.error('Failed to replay execution:', error);
            return {
                success: false,
                error: (error as Error).message
            };
        }
    })

    // ============================================================================
    // SSE (SERVER-SENT EVENTS) ENDPOINTS
    // ============================================================================

    // SSE endpoint for streaming events for a specific execution
    // GET /api/executions/:executionId/stream
    .get('/api/executions/:executionId/stream', async ({ params, set }: { params: { executionId: string }, set: any }) => {
        const { executionId } = params;

        // Set SSE headers
        set.headers['Content-Type'] = 'text/event-stream';
        set.headers['Cache-Control'] = 'no-cache';
        set.headers['Connection'] = 'keep-alive';
        set.headers['X-Accel-Buffering'] = 'no'; // Disable nginx buffering

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                // Helper to send SSE event
                const sendEvent = (event: WorkflowEvent | ErrorEvent) => {
                    const data = `data: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                };

                try {
                    // Send initial state event on connect (Requirement 6.1, 6.2)
                    const initialState = await eventStreamManager.getExecutionState(executionId);

                    if (!initialState) {
                        // Execution not found - send error event and close (Requirement 6.3)
                        const errorEvent: ErrorEvent = {
                            type: 'error',
                            message: `Execution ${executionId} not found`,
                            code: 'EXECUTION_NOT_FOUND',
                        };
                        sendEvent(errorEvent);
                        controller.close();
                        return;
                    }

                    // Send initial state as first event
                    sendEvent(initialState);

                    // Subscribe to filtered events for this executionId (Requirement 2.1)
                    const subscription = eventStreamManager.subscribe(executionId);

                    // Stream events
                    for await (const event of subscription) {
                        sendEvent(event);
                    }
                } catch (error: any) {
                    // Handle errors during streaming
                    const errorEvent: ErrorEvent = {
                        type: 'error',
                        message: error.message || 'Stream error',
                        code: 'STREAM_ERROR',
                    };
                    sendEvent(errorEvent);
                    controller.close();
                }
            },

            cancel() {
                // Client disconnected - cleanup handled by subscription iterator's return()
                console.log(`[SSE] Client disconnected from execution ${executionId}`);
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        });
    })

    // SSE endpoint for streaming all events (no filter)
    // GET /api/executions/stream
    .get('/api/executions/stream', async ({ set }: { set: any }) => {
        // Set SSE headers
        set.headers['Content-Type'] = 'text/event-stream';
        set.headers['Cache-Control'] = 'no-cache';
        set.headers['Connection'] = 'keep-alive';
        set.headers['X-Accel-Buffering'] = 'no';

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                // Helper to send SSE event
                const sendEvent = (event: WorkflowEvent | ErrorEvent) => {
                    const data = `data: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                };

                try {
                    // Subscribe to all events (no filter) (Requirement 2.2)
                    const subscription = eventStreamManager.subscribe();

                    // Stream events
                    for await (const event of subscription) {
                        sendEvent(event);
                    }
                } catch (error: any) {
                    const errorEvent: ErrorEvent = {
                        type: 'error',
                        message: error.message || 'Stream error',
                        code: 'STREAM_ERROR',
                    };
                    sendEvent(errorEvent);
                    controller.close();
                }
            },

            cancel() {
                console.log('[SSE] Client disconnected from all-events stream');
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        });
    })

    .listen(3001, ({ hostname, port }) => {
        console.log(`🚀 React Flow n8n Backend running at http://${hostname}:${port}`);
        console.log(`📊 API endpoints:`);
        console.log(`   - POST /api/workflows/execute`);
        console.log(`   - GET  /api/workflows/executions/:id`);
        console.log(`   - GET  /api/health`);
        console.log(`   - GET  /api/workflows - List all workflows`);
        console.log(`   - POST /api/workflows - Create new workflow`);
        console.log(`   - PUT  /api/workflows/:id - Update workflow`);
        console.log(`   - DELETE /api/workflows/:id - Delete workflow`);
        console.log(`   - GET  /api/workflows/:id/versions - Version history`);
        console.log(`   - GET  /api/executions - List all executions`);
        console.log(`   - POST /api/executions/:id/replay - Replay execution`);
        console.log(`   - GET  /api/system/health - System health status`);
        console.log(`   - POST /api/executions/:id/timeout - Set timeout`);
        console.log(`   - GET  /api/dlq - List DLQ items`);
        console.log(`   - POST /api/dlq/:id/retry - Retry DLQ item`);
        console.log(`   - POST /api/executions/:id/pause - Pause execution`);
        console.log(`   - POST /api/executions/:id/resume - Resume execution`);
        console.log(`   - POST /api/executions/:id/cancel - Cancel execution`);
        console.log(`   - GET  /api/executions/:id/stream - SSE stream for execution`);
        console.log(`   - GET  /api/executions/stream - SSE stream for all events`);
    });
