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

    constructor(apiBaseUrl: string = 'http://localhost:3001/api') {
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

            const result = await response.json();
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
}

export default ExecutionManager;
