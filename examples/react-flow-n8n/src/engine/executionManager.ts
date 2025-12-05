import type { WorkflowDefinition } from './workflowConverter';

export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error' | 'paused' | 'cancelled';

export interface ExecutionResult {
    executionId: string;
    status: ExecutionStatus;
    nodeStatuses: Record<string, ExecutionStatus>;
    results?: Record<string, any>;
    nodeResults?: Record<string, any>;
    error?: string;
}

// Event types from the backend event-types.ts
export interface NodeProgressEvent {
    type: 'node:progress';
    timestamp: number;
    executionId: string;
    nodeId: string;
    workflowId: string;
    status: 'running' | 'completed' | 'failed' | 'skipped';
    data?: any;
    error?: string;
    progress?: number;
}

export interface WorkflowStatusEvent {
    type: 'workflow:status';
    timestamp: number;
    executionId: string;
    workflowId: string;
    status: 'started' | 'completed' | 'failed' | 'paused' | 'cancelled';
    error?: string;
}

export interface ExecutionStateEvent {
    type: 'execution:state';
    timestamp: number;
    executionId: string;
    workflowId: string;
    status: string;
    nodeResults: Record<string, any>;
    startedAt: string;
    completedAt?: string;
}

export interface ErrorEvent {
    type: 'error';
    message: string;
    code?: string;
}

export type WorkflowEvent = NodeProgressEvent | WorkflowStatusEvent | ExecutionStateEvent | ErrorEvent;

class ExecutionManager {
    private apiBaseUrl: string;
    private eventSources: Map<string, EventSource> = new Map();

    // Use relative URL to leverage Vite's proxy configuration
    constructor(apiBaseUrl: string = '/api') {
        this.apiBaseUrl = apiBaseUrl;
    }

    async executeWorkflow(workflow: WorkflowDefinition): Promise<ExecutionResult> {
        try {
            console.log(`🔗 Calling API: ${this.apiBaseUrl}/workflows/execute`);
            console.log('📋 Workflow data:', JSON.stringify(workflow, null, 2));

            const startTime = Date.now();
            const response = await fetch(`${this.apiBaseUrl}/workflows/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(workflow)
            });

            console.log(`🕒 API call took ${Date.now() - startTime}ms`);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                console.error(`❌ HTTP error! status: ${response.status}, response: ${errorText}`);
                throw new Error(`HTTP error! status: ${response.status}, response: ${errorText}`);
            }

            const result = await response.json() as ExecutionResult;
            console.log('✅ API response:', result);
            return result;
        } catch (error) {
            console.error('❌ Failed to execute workflow:', error);
            if (error instanceof Error) {
                throw new Error(`Workflow execution failed: ${error.message}`);
            } else {
                throw new Error(`Workflow execution failed: ${String(error)}`);
            }
        }
    }

    async getExecutionStatus(executionId: string): Promise<ExecutionResult> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/workflows/executions/${executionId}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json() as ExecutionResult;
            return result;
        } catch (error) {
            console.error('Failed to get execution status:', error);
            throw error;
        }
    }

    async pollExecutionStatus(
        executionId: string,
        onUpdate: (result: ExecutionResult) => void,
        intervalMs: number = 1000,
        maxAttempts: number = 30
    ): Promise<void> {
        let attempts = 0;
        const poll = async () => {
            try {
                attempts++;
                const result = await this.getExecutionStatus(executionId);
                onUpdate(result);

                if (result.status === 'running' && attempts < maxAttempts) {
                    setTimeout(poll, intervalMs);
                } else if (result.status === 'running' && attempts >= maxAttempts) {
                    console.warn(`🕒 Polling timeout reached after ${maxAttempts} attempts for execution ${executionId}`);
                    onUpdate({
                        executionId,
                        status: 'error',
                        nodeStatuses: {},
                        error: 'Polling timeout - workflow may be stuck'
                    });
                }
            } catch (error) {
                console.error('Polling error:', error);
                onUpdate({
                    executionId,
                    status: 'error',
                    nodeStatuses: {},
                    error: `Polling failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                });
            }
        };

        await poll();
    }

    /**
     * Subscribe to real-time execution events via SSE
     * This is the preferred method over polling for real-time updates
     */
    subscribeToExecution(
        executionId: string,
        callbacks: {
            onNodeProgress?: (event: NodeProgressEvent) => void;
            onWorkflowStatus?: (event: WorkflowStatusEvent) => void;
            onInitialState?: (event: ExecutionStateEvent) => void;
            onError?: (event: ErrorEvent) => void;
            onUpdate?: (result: ExecutionResult) => void;
        }
    ): () => void {
        // Close any existing subscription for this execution
        this.unsubscribeFromExecution(executionId);

        // Build the SSE URL - use the backend port directly for SSE
        // Vite proxy doesn't handle SSE well, so we connect directly
        const sseUrl = `http://localhost:3001/api/executions/${executionId}/stream`;
        console.log(`📡 Connecting to SSE stream: ${sseUrl}`);

        const eventSource = new EventSource(sseUrl);
        this.eventSources.set(executionId, eventSource);

        // Track current state for building ExecutionResult
        let currentNodeStatuses: Record<string, ExecutionStatus> = {};
        let currentNodeResults: Record<string, any> = {};
        let currentStatus: ExecutionStatus = 'running';

        eventSource.onmessage = (event) => {
            try {
                const data: WorkflowEvent = JSON.parse(event.data);
                console.log('📨 SSE event received:', data);

                switch (data.type) {
                    case 'execution:state': {
                        // Initial state event
                        const stateEvent = data as ExecutionStateEvent;
                        currentStatus = this.mapWorkflowStatus(stateEvent.status);
                        currentNodeResults = stateEvent.nodeResults || {};
                        
                        // Build node statuses from node results
                        for (const [nodeId, result] of Object.entries(currentNodeResults)) {
                            currentNodeStatuses[nodeId] = this.mapNodeResultToStatus(result);
                        }

                        callbacks.onInitialState?.(stateEvent);
                        callbacks.onUpdate?.({
                            executionId,
                            status: currentStatus,
                            nodeStatuses: { ...currentNodeStatuses },
                            nodeResults: { ...currentNodeResults },
                        });
                        break;
                    }

                    case 'node:progress': {
                        const nodeEvent = data as NodeProgressEvent;
                        currentNodeStatuses[nodeEvent.nodeId] = this.mapNodeStatus(nodeEvent.status);
                        
                        if (nodeEvent.data !== undefined) {
                            currentNodeResults[nodeEvent.nodeId] = {
                                success: nodeEvent.status === 'completed',
                                data: nodeEvent.data,
                                error: nodeEvent.error,
                            };
                        } else if (nodeEvent.error) {
                            currentNodeResults[nodeEvent.nodeId] = {
                                success: false,
                                error: nodeEvent.error,
                            };
                        } else if (nodeEvent.status === 'skipped') {
                            currentNodeResults[nodeEvent.nodeId] = {
                                skipped: true,
                            };
                        }

                        callbacks.onNodeProgress?.(nodeEvent);
                        callbacks.onUpdate?.({
                            executionId,
                            status: currentStatus,
                            nodeStatuses: { ...currentNodeStatuses },
                            nodeResults: { ...currentNodeResults },
                        });
                        break;
                    }

                    case 'workflow:status': {
                        const workflowEvent = data as WorkflowStatusEvent;
                        currentStatus = this.mapWorkflowStatus(workflowEvent.status);

                        callbacks.onWorkflowStatus?.(workflowEvent);
                        callbacks.onUpdate?.({
                            executionId,
                            status: currentStatus,
                            nodeStatuses: { ...currentNodeStatuses },
                            nodeResults: { ...currentNodeResults },
                            error: workflowEvent.error,
                        });

                        // Close connection when workflow completes
                        if (['completed', 'failed', 'cancelled'].includes(workflowEvent.status)) {
                            console.log(`📡 Workflow ${workflowEvent.status}, closing SSE connection`);
                            this.unsubscribeFromExecution(executionId);
                        }
                        break;
                    }

                    case 'error': {
                        const errorEvent = data as ErrorEvent;
                        callbacks.onError?.(errorEvent);
                        callbacks.onUpdate?.({
                            executionId,
                            status: 'error',
                            nodeStatuses: { ...currentNodeStatuses },
                            nodeResults: { ...currentNodeResults },
                            error: errorEvent.message,
                        });
                        this.unsubscribeFromExecution(executionId);
                        break;
                    }
                }
            } catch (error) {
                console.error('Error parsing SSE event:', error);
            }
        };

        eventSource.onerror = (error) => {
            console.error('📡 SSE connection error:', error);
            callbacks.onError?.({
                type: 'error',
                message: 'SSE connection error',
                code: 'CONNECTION_ERROR',
            });
            // Don't auto-close on error - EventSource will try to reconnect
        };

        // Return unsubscribe function
        return () => this.unsubscribeFromExecution(executionId);
    }

    /**
     * Unsubscribe from execution events
     */
    unsubscribeFromExecution(executionId: string): void {
        const eventSource = this.eventSources.get(executionId);
        if (eventSource) {
            console.log(`📡 Closing SSE connection for execution ${executionId}`);
            eventSource.close();
            this.eventSources.delete(executionId);
        }
    }

    /**
     * Unsubscribe from all execution events
     */
    unsubscribeAll(): void {
        for (const [executionId] of this.eventSources) {
            this.unsubscribeFromExecution(executionId);
        }
    }

    /**
     * Map node event status to ExecutionStatus
     */
    private mapNodeStatus(status: 'running' | 'completed' | 'failed' | 'skipped'): ExecutionStatus {
        switch (status) {
            case 'running': return 'running';
            case 'completed': return 'success';
            case 'failed': return 'error';
            case 'skipped': return 'idle'; // Use idle for skipped nodes
            default: return 'idle';
        }
    }

    /**
     * Map workflow event status to ExecutionStatus
     */
    private mapWorkflowStatus(status: string): ExecutionStatus {
        switch (status) {
            case 'started':
            case 'running': return 'running';
            case 'completed': return 'success';
            case 'failed': return 'error';
            case 'paused': return 'paused';
            case 'cancelled': return 'cancelled';
            default: return 'running';
        }
    }

    /**
     * Map node result to ExecutionStatus
     */
    private mapNodeResultToStatus(result: any): ExecutionStatus {
        if (result.skipped) return 'idle';
        if (result.success === true) return 'success';
        if (result.success === false) return 'error';
        return 'idle';
    }
}

export default ExecutionManager;
