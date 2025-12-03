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
}

// Export a default instance
export const executionService = new ExecutionService();
