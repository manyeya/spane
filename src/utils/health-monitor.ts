import type { IExecutionStateStore } from '../types';
import type { Redis } from 'ioredis';
import type { QueueManager } from '../engine/queue-manager';

export interface HealthCheckResult {
    healthy: boolean;
    component: string;
    message?: string;
    timestamp: Date;
}

export interface SystemHealth {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    checks: HealthCheckResult[];
    timestamp: Date;
}

/**
 * Health monitoring for workflow engine components
 * Detects and reports on system health issues
 */
export class HealthMonitor {
    private intervalId?: NodeJS.Timeout;
    private readonly checkInterval: number;
    private isRunning = false;
    private lastHealthStatus: SystemHealth | null = null;

    constructor(
        private stateStore: IExecutionStateStore,
        private redis: Redis,
        private queueManager?: QueueManager,
        checkIntervalMs: number = 30000 // Check every 30 seconds
    ) {
        this.checkInterval = checkIntervalMs;
    }

    /**
     * Start health monitoring
     */
    start(): void {
        if (this.isRunning) {
            console.warn('⚠️  HealthMonitor already running');
            return;
        }

        this.isRunning = true;
        console.log(`💚 HealthMonitor started (check interval: ${this.checkInterval}ms)`);

        // Run immediately, then on interval
        this.performHealthCheck();
        this.intervalId = setInterval(() => this.performHealthCheck(), this.checkInterval);
    }

    /**
     * Stop health monitoring
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        this.isRunning = false;
        console.log('💚 HealthMonitor stopped');
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck(): Promise<SystemHealth> {
        const checks: HealthCheckResult[] = [];
        const timestamp = new Date();

        // 1. Check Redis connection
        checks.push(await this.checkRedis());

        // 2. Check database connection
        checks.push(await this.checkDatabase());

        // 3. Check queue health (if available)
        if (this.queueManager) {
            checks.push(await this.checkQueues());
        }

        // 4. Check for stuck executions
        checks.push(await this.checkStuckExecutions());

        // Determine overall health
        const unhealthyCount = checks.filter(c => !c.healthy).length;
        let overall: SystemHealth['overall'];

        if (unhealthyCount === 0) {
            overall = 'healthy';
        } else if (unhealthyCount <= 1) {
            overall = 'degraded';
        } else {
            overall = 'unhealthy';
        }

        const health: SystemHealth = {
            overall,
            checks,
            timestamp,
        };

        this.lastHealthStatus = health;

        // Log health status changes
        if (overall !== 'healthy') {
            console.warn(`⚠️  System health: ${overall}`, {
                unhealthyComponents: checks.filter(c => !c.healthy).map(c => c.component),
            });
        }

        // Publish health status to Redis
        await this.publishHealthStatus(health);

        return health;
    }

    /**
     * Check Redis connection health
     */
    private async checkRedis(): Promise<HealthCheckResult> {
        try {
            await this.redis.ping();
            return {
                healthy: true,
                component: 'redis',
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                healthy: false,
                component: 'redis',
                message: error instanceof Error ? error.message : 'Connection failed',
                timestamp: new Date(),
            };
        }
    }

    /**
     * Check database connection health
     * For HybridExecutionStateStore, this checks both Redis and database backends
     */
    private async checkDatabase(): Promise<HealthCheckResult> {
        try {
            // Try to fetch a simple record or perform a simple query
            // This assumes the state store has some method we can call
            if ('healthCheck' in this.stateStore &&
                typeof (this.stateStore as any).healthCheck === 'function') {
                const healthResult = await (this.stateStore as any).healthCheck();
                
                // Handle HybridExecutionStateStore health check result
                // which returns { status, redis, database }
                if (healthResult && typeof healthResult === 'object' && 'status' in healthResult) {
                    const hybridHealth = healthResult as {
                        status: 'healthy' | 'degraded' | 'unhealthy';
                        redis: { healthy: boolean; message?: string };
                        database: { healthy: boolean; message?: string };
                    };
                    
                    if (hybridHealth.status === 'unhealthy') {
                        return {
                            healthy: false,
                            component: 'database',
                            message: `Hybrid store unhealthy - Redis: ${hybridHealth.redis.message || 'unknown'}, DB: ${hybridHealth.database.message || 'unknown'}`,
                            timestamp: new Date(),
                        };
                    }
                    
                    if (hybridHealth.status === 'degraded') {
                        // Return degraded status with details
                        const issues: string[] = [];
                        if (!hybridHealth.redis.healthy) {
                            issues.push(`Redis: ${hybridHealth.redis.message || 'unhealthy'}`);
                        }
                        if (!hybridHealth.database.healthy) {
                            issues.push(`Database: ${hybridHealth.database.message || 'unhealthy'}`);
                        }
                        
                        return {
                            healthy: false, // Mark as unhealthy to trigger degraded overall status
                            component: 'database',
                            message: `Hybrid store degraded - ${issues.join(', ')}`,
                            timestamp: new Date(),
                        };
                    }
                    
                    // Healthy
                    return {
                        healthy: true,
                        component: 'database',
                        message: 'Hybrid store healthy (Redis + Database)',
                        timestamp: new Date(),
                    };
                }
            }

            return {
                healthy: true,
                component: 'database',
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                healthy: false,
                component: 'database',
                message: error instanceof Error ? error.message : 'Connection failed',
                timestamp: new Date(),
            };
        }
    }

    /**
     * Check queue health
     */
    private async checkQueues(): Promise<HealthCheckResult> {
        try {
            if (!this.queueManager) {
                return {
                    healthy: true,
                    component: 'queues',
                    message: 'Queue manager not available',
                    timestamp: new Date(),
                };
            }

            // Check if queues are responsive
            const nodeQueueHealth = await this.queueManager.nodeQueue.getJobCounts();
            const workflowQueueHealth = await this.queueManager.workflowQueue.getJobCounts();

            // Check for excessive failed jobs
            const totalFailed = (nodeQueueHealth.failed || 0) + (workflowQueueHealth.failed || 0);
            const totalCompleted = (nodeQueueHealth.completed || 0) + (workflowQueueHealth.completed || 0);
            const totalProcessed = totalFailed + totalCompleted;

            // Only flag as unhealthy if:
            // 1. More than 100 failed jobs, OR
            // 2. Failure rate > 50% with at least 10 jobs processed
            const failureRate = totalProcessed > 0 ? totalFailed / totalProcessed : 0;

            if (totalFailed > 100 || (failureRate > 0.5 && totalProcessed >= 10)) {
                return {
                    healthy: false,
                    component: 'queues',
                    message: `High failure rate: ${totalFailed} failed / ${totalProcessed} total (${(failureRate * 100).toFixed(1)}%)`,
                    timestamp: new Date(),
                };
            }

            return {
                healthy: true,
                component: 'queues',
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                healthy: false,
                component: 'queues',
                message: error instanceof Error ? error.message : 'Queue check failed',
                timestamp: new Date(),
            };
        }
    }

    /**
     * Check for stuck executions (running too long)
     */
    private async checkStuckExecutions(): Promise<HealthCheckResult> {
        try {
            // Check if state store has method to find long-running executions
            if ('findLongRunningExecutions' in this.stateStore &&
                typeof (this.stateStore as any).findLongRunningExecutions === 'function') {

                const stuckExecutions = await (this.stateStore as any).findLongRunningExecutions(3600000); // 1 hour

                if (stuckExecutions.length > 0) {
                    return {
                        healthy: false,
                        component: 'executions',
                        message: `${stuckExecutions.length} executions running longer than 1 hour`,
                        timestamp: new Date(),
                    };
                }
            }

            return {
                healthy: true,
                component: 'executions',
                timestamp: new Date(),
            };
        } catch (error) {
            return {
                healthy: false,
                component: 'executions',
                message: error instanceof Error ? error.message : 'Check failed',
                timestamp: new Date(),
            };
        }
    }

    /**
     * Publish health status to Redis for monitoring
     */
    private async publishHealthStatus(health: SystemHealth): Promise<void> {
        try {
            await this.redis.set(
                'system:health',
                JSON.stringify(health),
                'EX',
                this.checkInterval * 3 / 1000 // Expire after 3 check intervals
            );

            // Also publish to pub/sub for real-time monitoring
            await this.redis.publish('system:health:updates', JSON.stringify(health));
        } catch (error) {
            console.warn('⚠️  Failed to publish health status:', error);
        }
    }

    /**
     * Get last health check result
     */
    getLastHealthStatus(): SystemHealth | null {
        return this.lastHealthStatus;
    }

    /**
     * Perform on-demand health check
     */
    async checkNow(): Promise<SystemHealth> {
        return await this.performHealthCheck();
    }

    /**
     * Get monitor status
     */
    getStatus(): { running: boolean; checkInterval: number; lastCheck: Date | null } {
        return {
            running: this.isRunning,
            checkInterval: this.checkInterval,
            lastCheck: this.lastHealthStatus?.timestamp || null,
        };
    }
}
