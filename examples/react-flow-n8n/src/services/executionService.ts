/**
 * ExecutionService - Manages execution operations and polling
 * 
 * Requirements: 4.1, 5.1, 5.2, 5.3, 9.1
 * 
 * Aligned with react-flow-backend.ts API endpoints
 */

// Use relative URL to leverage Vite's proxy configuration
// This avoids CORS issues in development
const API_BASE_URL = '';

export interface ExecutionSummary {
    executionId: string;
    workflowId: string;
    workflowName: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
    startedAt: Date;
    completedAt?: Date;
    nodeCount: number;
    completedNodes: number;
}

export interface ExecutionDetail extends ExecutionSummary {
    nodeResults: Record<string, NodeResult>;
    nodeStatuses: Record<string, string>;
    initialData?: unknown;
    metadata?: Record<string, unknown>;
}

export interface NodeResult {
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    success?: boolean;
    output?: unknown;
    data?: unknown;
    error?: string;
    startedAt?: Date;
    completedAt?: Date;
}

interface ExecutionAPIResponse {
    executionId: string;
    workflowId?: string;
    status: string;
    nodeStatuses: Record<string, string>;
    nodeResults: Record<string, unknown>;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    initialData?: unknown;
    metadata?: Record<string, unknown>;
}

type StatusCallback = (status: ExecutionDetail) => void;


/**
 * ExecutionService class for managing workflow executions
 * Uses the react-flow-backend.ts API endpoints
 */
export class ExecutionService {
    private baseUrl: string;
    private pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

    constructor(baseUrl: string = API_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Lists all executions, optionally filtered by workflow
     * Note: Backend may need to implement this endpoint
     * Requirements: 4.1
     */
    async listExecutions(workflowId?: string): Promise<ExecutionSummary[]> {
        // The backend doesn't have a list executions endpoint yet
        // This would need to be added to react-flow-backend.ts
        const url = workflowId 
            ? `${this.baseUrl}/api/executions?workflowId=${workflowId}`
            : `${this.baseUrl}/api/executions`;

        try {
            const response = await fetch(url);
            
            if (response.status === 404) {
                // Endpoint not implemented yet
                console.warn('List executions endpoint not implemented');
                return [];
            }

            const data = await response.json();
            
            if (!data.success && data.error) {
                throw new Error(data.error);
            }

            const executions = data.executions || [];
            return executions.map((e: Record<string, unknown>) => this.toExecutionSummary(e));
        } catch (error) {
            console.warn('Failed to list executions:', error);
            return [];
        }
    }

    /**
     * Gets detailed execution information
     * Endpoint: GET /api/workflows/executions/:id
     * Requirements: 4.2
     */
    async getExecution(executionId: string): Promise<ExecutionDetail> {
        const response = await fetch(`${this.baseUrl}/api/workflows/executions/${executionId}`);
        const data: ExecutionAPIResponse = await response.json();

        if (data.status === 'error' && data.error) {
            throw new Error(data.error);
        }

        return this.toExecutionDetail(data);
    }

    /**
     * Executes a workflow with optional initial data
     * Endpoint: POST /api/workflows/execute
     * Requirements: 4.1
     */
    async executeWorkflow(
        workflowId: string, 
        nodes: Array<{ id: string; type?: string; position: { x: number; y: number }; data?: Record<string, unknown> }>,
        edges: Array<{ id: string; source: string; target: string }>,
        initialData?: unknown
    ): Promise<string> {
        const workflowData = {
            id: workflowId,
            name: 'Executed Workflow',
            nodes: nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: node.data,
                config: node.data?.config,
            })),
            edges,
            initialData,
        };

        const response = await fetch(`${this.baseUrl}/api/workflows/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(workflowData),
        });

        const data = await response.json();

        if (data.status === 'error') {
            throw new Error(data.error || 'Failed to execute workflow');
        }

        return data.executionId;
    }

    /**
     * Pauses a running execution
     * Endpoint: POST /api/executions/:executionId/pause
     * Requirements: 5.1
     */
    async pauseExecution(executionId: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/executions/${executionId}/pause`, {
            method: 'POST',
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to pause execution');
        }
    }

    /**
     * Resumes a paused execution
     * Endpoint: POST /api/executions/:executionId/resume
     * Requirements: 5.2
     */
    async resumeExecution(executionId: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/executions/${executionId}/resume`, {
            method: 'POST',
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to resume execution');
        }
    }

    /**
     * Cancels a running or paused execution
     * Endpoint: POST /api/executions/:executionId/cancel
     * Requirements: 5.3
     */
    async cancelExecution(executionId: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/executions/${executionId}/cancel`, {
            method: 'POST',
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to cancel execution');
        }
    }


    /**
     * Replays a completed execution with the same initial data
     * Requirements: 9.1
     */
    async replayExecution(executionId: string): Promise<string> {
        // First get the original execution to retrieve its data
        const originalExecution = await this.getExecution(executionId);

        // Try the replay endpoint first
        try {
            const response = await fetch(`${this.baseUrl}/api/executions/${executionId}/replay`, {
                method: 'POST',
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.executionId) {
                    return data.executionId;
                }
            }
        } catch {
            // Replay endpoint may not exist, fall through to manual replay
        }

        // Manual replay: re-execute with the same initial data
        // Note: This requires knowing the workflow structure
        // For now, we'll throw an error indicating replay needs backend support
        throw new Error(
            `Replay requires backend support. Original execution: ${originalExecution.executionId}`
        );
    }

    /**
     * Polls execution status at regular intervals
     * Calls the callback with updated status
     */
    pollExecutionStatus(executionId: string, callback: StatusCallback, intervalMs: number = 1000): void {
        // Clear any existing polling for this execution
        this.stopPolling(executionId);

        const poll = async () => {
            try {
                const status = await this.getExecution(executionId);
                callback(status);

                // Stop polling if execution is complete
                if (['completed', 'failed', 'cancelled'].includes(status.status)) {
                    this.stopPolling(executionId);
                }
            } catch (error) {
                console.error(`Error polling execution ${executionId}:`, error);
            }
        };

        // Initial poll
        poll();

        // Set up interval
        const interval = setInterval(poll, intervalMs);
        this.pollingIntervals.set(executionId, interval);
    }

    /**
     * Stops polling for a specific execution
     */
    stopPolling(executionId: string): void {
        const interval = this.pollingIntervals.get(executionId);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(executionId);
        }
    }

    /**
     * Stops all active polling
     */
    stopAllPolling(): void {
        for (const [executionId] of this.pollingIntervals) {
            this.stopPolling(executionId);
        }
    }

    /**
     * Converts API response to ExecutionSummary
     */
    private toExecutionSummary(data: Record<string, unknown>): ExecutionSummary {
        const nodeResults = (data.nodeResults as Record<string, unknown>) || {};
        const nodeCount = Object.keys(nodeResults).length;
        const completedNodes = Object.values(nodeResults).filter(
            (r: unknown) => {
                const result = r as Record<string, unknown>;
                return result.success === true || result.status === 'completed';
            }
        ).length;

        return {
            executionId: data.executionId as string,
            workflowId: data.workflowId as string || '',
            workflowName: (data.workflowName as string) || 'Unknown Workflow',
            status: this.normalizeStatus(data.status as string),
            startedAt: data.startedAt ? new Date(data.startedAt as string) : new Date(),
            completedAt: data.completedAt ? new Date(data.completedAt as string) : undefined,
            nodeCount,
            completedNodes,
        };
    }

    /**
     * Converts API response to ExecutionDetail
     */
    private toExecutionDetail(data: ExecutionAPIResponse): ExecutionDetail {
        const nodeResults: Record<string, NodeResult> = {};
        
        for (const [nodeId, result] of Object.entries(data.nodeResults || {})) {
            const r = result as Record<string, unknown>;
            nodeResults[nodeId] = {
                status: this.normalizeNodeStatus(r),
                success: r.success as boolean | undefined,
                output: r.data,
                data: r.data,
                error: r.error as string | undefined,
            };
        }

        const nodeCount = Object.keys(nodeResults).length;
        const completedNodes = Object.values(nodeResults).filter(
            r => r.status === 'completed' || r.success === true
        ).length;

        return {
            executionId: data.executionId,
            workflowId: data.workflowId || '',
            workflowName: 'Workflow',
            status: this.normalizeStatus(data.status),
            startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
            completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
            nodeCount,
            completedNodes,
            nodeResults,
            nodeStatuses: data.nodeStatuses || {},
            initialData: data.initialData,
            metadata: data.metadata,
        };
    }

    /**
     * Normalizes status string to ExecutionSummary status type
     */
    private normalizeStatus(status: string): ExecutionSummary['status'] {
        const statusMap: Record<string, ExecutionSummary['status']> = {
            'running': 'running',
            'success': 'completed',
            'completed': 'completed',
            'error': 'failed',
            'failed': 'failed',
            'cancelled': 'cancelled',
            'paused': 'paused',
        };
        return statusMap[status] || 'running';
    }

    /**
     * Normalizes node result to NodeResult status
     */
    private normalizeNodeStatus(result: Record<string, unknown>): NodeResult['status'] {
        if (result.skipped) return 'skipped';
        if (result.success === true) return 'completed';
        if (result.success === false) return 'failed';
        if (result.status) {
            const status = result.status as string;
            if (['pending', 'running', 'completed', 'failed', 'skipped'].includes(status)) {
                return status as NodeResult['status'];
            }
        }
        return 'pending';
    }

    /**
     * Subscribe to real-time execution events via SSE
     * Returns an unsubscribe function
     */
    subscribeToExecution(
        executionId: string,
        callbacks: {
            onNodeProgress?: (event: NodeProgressEvent) => void;
            onWorkflowStatus?: (event: WorkflowStatusEvent) => void;
            onInitialState?: (event: ExecutionStateEvent) => void;
            onError?: (event: SSEErrorEvent) => void;
            onUpdate?: (detail: ExecutionDetail) => void;
        }
    ): () => void {
        // Use direct backend URL for SSE (Vite proxy doesn't handle SSE well)
        const sseUrl = `http://localhost:3001/api/executions/${executionId}/stream`;
        console.log(`📡 Connecting to SSE stream: ${sseUrl}`);

        const eventSource = new EventSource(sseUrl);

        // Track current state
        let currentDetail: ExecutionDetail = {
            executionId,
            workflowId: '',
            workflowName: 'Workflow',
            status: 'running',
            startedAt: new Date(),
            nodeCount: 0,
            completedNodes: 0,
            nodeResults: {},
            nodeStatuses: {},
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('📨 SSE event received:', data);

                switch (data.type) {
                    case 'execution:state': {
                        currentDetail = {
                            ...currentDetail,
                            workflowId: data.workflowId,
                            status: this.normalizeStatus(data.status),
                            startedAt: new Date(data.startedAt),
                            completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
                            nodeResults: this.convertNodeResults(data.nodeResults || {}),
                            nodeStatuses: this.buildNodeStatuses(data.nodeResults || {}),
                            nodeCount: Object.keys(data.nodeResults || {}).length,
                            completedNodes: this.countCompletedNodes(data.nodeResults || {}),
                        };
                        callbacks.onInitialState?.(data);
                        callbacks.onUpdate?.(currentDetail);
                        break;
                    }

                    case 'node:progress': {
                        const nodeStatus = this.mapNodeEventStatus(data.status);
                        currentDetail.nodeStatuses[data.nodeId] = nodeStatus;
                        
                        if (data.data !== undefined || data.error) {
                            currentDetail.nodeResults[data.nodeId] = {
                                status: nodeStatus,
                                success: data.status === 'completed',
                                data: data.data,
                                error: data.error,
                            };
                        }
                        
                        currentDetail.completedNodes = this.countCompletedNodes(
                            Object.fromEntries(
                                Object.entries(currentDetail.nodeResults).map(([k, v]) => [k, { success: v.success }])
                            )
                        );

                        callbacks.onNodeProgress?.(data);
                        callbacks.onUpdate?.(currentDetail);
                        break;
                    }

                    case 'workflow:status': {
                        currentDetail.status = this.normalizeStatus(data.status);
                        if (data.completedAt) {
                            currentDetail.completedAt = new Date(data.completedAt);
                        }

                        callbacks.onWorkflowStatus?.(data);
                        callbacks.onUpdate?.(currentDetail);

                        // Close connection when workflow completes
                        if (['completed', 'failed', 'cancelled'].includes(data.status)) {
                            console.log(`📡 Workflow ${data.status}, closing SSE connection`);
                            eventSource.close();
                        }
                        break;
                    }

                    case 'error': {
                        callbacks.onError?.(data);
                        eventSource.close();
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
        };

        // Return unsubscribe function
        return () => {
            console.log(`📡 Closing SSE connection for execution ${executionId}`);
            eventSource.close();
        };
    }

    /**
     * Map node event status to NodeResult status
     */
    private mapNodeEventStatus(status: string): NodeResult['status'] {
        switch (status) {
            case 'running': return 'running';
            case 'completed': return 'completed';
            case 'failed': return 'failed';
            case 'skipped': return 'skipped';
            default: return 'pending';
        }
    }

    /**
     * Convert raw node results to NodeResult format
     */
    private convertNodeResults(rawResults: Record<string, unknown>): Record<string, NodeResult> {
        const results: Record<string, NodeResult> = {};
        for (const [nodeId, result] of Object.entries(rawResults)) {
            const r = result as Record<string, unknown>;
            results[nodeId] = {
                status: this.normalizeNodeStatus(r),
                success: r.success as boolean | undefined,
                output: r.data,
                data: r.data,
                error: r.error as string | undefined,
            };
        }
        return results;
    }

    /**
     * Build node statuses from node results
     */
    private buildNodeStatuses(rawResults: Record<string, unknown>): Record<string, string> {
        const statuses: Record<string, string> = {};
        for (const [nodeId, result] of Object.entries(rawResults)) {
            const r = result as Record<string, unknown>;
            statuses[nodeId] = this.normalizeNodeStatus(r);
        }
        return statuses;
    }

    /**
     * Count completed nodes from results
     */
    private countCompletedNodes(rawResults: Record<string, unknown>): number {
        return Object.values(rawResults).filter(
            (r: unknown) => {
                const result = r as Record<string, unknown>;
                return result.success === true;
            }
        ).length;
    }
}

// SSE Event types
export interface NodeProgressEvent {
    type: 'node:progress';
    timestamp: number;
    executionId: string;
    nodeId: string;
    workflowId: string;
    status: 'running' | 'completed' | 'failed' | 'skipped';
    data?: unknown;
    error?: string;
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
    nodeResults: Record<string, unknown>;
    startedAt: string;
    completedAt?: string;
}

export interface SSEErrorEvent {
    type: 'error';
    message: string;
    code?: string;
}

// Export a default instance
export const executionService = new ExecutionService();
