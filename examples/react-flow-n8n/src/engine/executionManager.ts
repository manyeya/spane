import { WorkflowDefinition } from './workflowConverter';

export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error';

export interface ExecutionResult {
    executionId: string;
    status: ExecutionStatus;
    nodeStatuses: Record<string, ExecutionStatus>;
    results?: Record<string, any>;
    nodeResults?: Record<string, any>;
    error?: string;
}

class ExecutionManager {
    private apiBaseUrl: string;

    constructor(apiBaseUrl: string = '/api') {
        this.apiBaseUrl = apiBaseUrl;
    }

    async executeWorkflow(workflow: WorkflowDefinition): Promise<ExecutionResult> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/workflows/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(workflow)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Failed to execute workflow:', error);
            throw error;
        }
    }

    async getExecutionStatus(executionId: string): Promise<ExecutionResult> {
        try {
            const response = await fetch(`${this.apiBaseUrl}/workflows/executions/${executionId}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Failed to get execution status:', error);
            throw error;
        }
    }

    async pollExecutionStatus(
        executionId: string,
        onUpdate: (result: ExecutionResult) => void,
        intervalMs: number = 1000
    ): Promise<void> {
        const poll = async () => {
            try {
                const result = await this.getExecutionStatus(executionId);
                onUpdate(result);

                if (result.status === 'running') {
                    setTimeout(poll, intervalMs);
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        };

        await poll();
    }
}

export default ExecutionManager;
