import type { IExecutionStateStore } from '../types';
import type { Redis } from 'ioredis';

/**
 * Monitors and handles execution timeouts
 * Automatically marks timed-out executions as failed
 */
export class TimeoutMonitor {
    private intervalId?: NodeJS.Timeout;
    private readonly checkInterval: number;
    private isRunning = false;

    constructor(
        private stateStore: IExecutionStateStore,
        private redis: Redis,
        checkIntervalMs: number = 60000 // Check every minute
    ) {
        this.checkInterval = checkIntervalMs;
    }

    /**
     * Start monitoring for timeouts
     */
    start(): void {
        if (this.isRunning) {
            console.warn('⚠️  TimeoutMonitor already running');
            return;
        }

        this.isRunning = true;
        console.log(`⏰ TimeoutMonitor started (check interval: ${this.checkInterval}ms)`);

        // Run immediately, then on interval
        this.checkTimeouts();
        this.intervalId = setInterval(() => this.checkTimeouts(), this.checkInterval);
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        this.isRunning = false;
        console.log('⏰ TimeoutMonitor stopped');
    }

    /**
     * Check for timed-out executions and handle them
     */
    private async checkTimeouts(): Promise<void> {
        try {
            // This requires a method in the state store to find timed-out executions
            // For now, we'll use a simple implementation

            // Check if stateStore has the method (DrizzleStore)
            if ('findTimedOutExecutions' in this.stateStore &&
                typeof (this.stateStore as any).findTimedOutExecutions === 'function') {

                const timedOutExecutions = await (this.stateStore as any).findTimedOutExecutions();

                if (timedOutExecutions.length > 0) {
                    console.log(`⏰ Found ${timedOutExecutions.length} timed-out executions`);

                    for (const execution of timedOutExecutions) {
                        await this.handleTimeout(execution.executionId, execution.workflowId);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error checking timeouts:', error);
            // Don't throw - keep monitor running
        }
    }

    /**
     * Handle a timed-out execution
     */
    private async handleTimeout(executionId: string, workflowId: string): Promise<void> {
        try {
            console.log(`⏰ Handling timeout for execution ${executionId}`);

            // Mark execution as timed out and failed
            if ('handleExecutionTimeout' in this.stateStore &&
                typeof (this.stateStore as any).handleExecutionTimeout === 'function') {

                await (this.stateStore as any).handleExecutionTimeout(executionId);
                console.log(`✓ Execution ${executionId} marked as timed out`);
            } else {
                // Fallback: manually update status
                await this.stateStore.setExecutionStatus(executionId, 'failed');
                await this.stateStore.addLog({
                    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    executionId,
                    level: 'error',
                    message: 'Execution timed out',
                    timestamp: new Date(),
                    metadata: { reason: 'timeout', workflowId },
                });
            }

            // Publish timeout event (for monitoring/alerting)
            await this.publishTimeoutEvent(executionId, workflowId);

        } catch (error) {
            console.error(`❌ Error handling timeout for ${executionId}:`, error);
        }
    }

    /**
     * Publish timeout event to Redis for monitoring
     */
    private async publishTimeoutEvent(executionId: string, workflowId: string): Promise<void> {
        try {
            await this.redis.publish('workflow:timeouts', JSON.stringify({
                executionId,
                workflowId,
                timestamp: new Date().toISOString(),
            }));
        } catch (error) {
            console.warn('⚠️  Failed to publish timeout event:', error);
            // Don't throw - timeout handling is more important
        }
    }

    /**
     * Set timeout for a specific execution
     * @param executionId Execution ID
     * @param timeoutMs Timeout in milliseconds
     */
    async setExecutionTimeout(executionId: string, timeoutMs: number): Promise<void> {
        const timeoutAt = new Date(Date.now() + timeoutMs);

        // Update execution with timeout
        if ('setExecutionTimeout' in this.stateStore &&
            typeof (this.stateStore as any).setExecutionTimeout === 'function') {

            await (this.stateStore as any).setExecutionTimeout(executionId, timeoutAt);
        }
    }

    /**
     * Clear timeout for a specific execution
     * @param executionId Execution ID
     */
    async clearExecutionTimeout(executionId: string): Promise<void> {
        if ('clearExecutionTimeout' in this.stateStore &&
            typeof (this.stateStore as any).clearExecutionTimeout === 'function') {

            await (this.stateStore as any).clearExecutionTimeout(executionId);
        }
    }

    /**
     * Get monitor status
     */
    getStatus(): { running: boolean; checkInterval: number } {
        return {
            running: this.isRunning,
            checkInterval: this.checkInterval,
        };
    }
}
