import type { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: number;
    checks: {
        redis: HealthCheck;
        workers: HealthCheck;
        queues: HealthCheck;
    };
    uptime: number;
}

export interface HealthCheck {
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: any;
}

export class HealthMonitor {
    private startTime: number;
    private workers: Worker[] = [];
    private queues: Queue[] = [];

    constructor(private redisConnection: Redis) {
        this.startTime = Date.now();
    }

    registerWorker(worker: Worker): void {
        this.workers.push(worker);
    }

    registerQueue(queue: Queue): void {
        this.queues.push(queue);
    }

    async getHealth(): Promise<HealthStatus> {
        const redisCheck = await this.checkRedis();
        const workersCheck = await this.checkWorkers();
        const queuesCheck = await this.checkQueues();

        // Determine overall status
        const checks = [redisCheck, workersCheck, queuesCheck];
        const hasFail = checks.some(c => c.status === 'fail');
        const hasWarn = checks.some(c => c.status === 'warn');

        return {
            status: hasFail ? 'unhealthy' : hasWarn ? 'degraded' : 'healthy',
            timestamp: Date.now(),
            checks: {
                redis: redisCheck,
                workers: workersCheck,
                queues: queuesCheck,
            },
            uptime: Date.now() - this.startTime,
        };
    }

    private async checkRedis(): Promise<HealthCheck> {
        try {
            const start = Date.now();
            await this.redisConnection.ping();
            const latency = Date.now() - start;

            if (latency > 1000) {
                return {
                    status: 'warn',
                    message: 'Redis connection slow',
                    details: { latency: `${latency}ms` },
                };
            }

            return {
                status: 'pass',
                message: 'Redis connection healthy',
                details: { latency: `${latency}ms` },
            };
        } catch (error) {
            return {
                status: 'fail',
                message: 'Redis connection failed',
                details: { error: error instanceof Error ? error.message : String(error) },
            };
        }
    }

    private async checkWorkers(): Promise<HealthCheck> {
        if (this.workers.length === 0) {
            return {
                status: 'warn',
                message: 'No workers registered',
            };
        }

        try {
            const runningWorkers = this.workers.filter(w => !w.isRunning()).length;

            if (runningWorkers === this.workers.length) {
                return {
                    status: 'fail',
                    message: 'All workers are stopped',
                    details: { total: this.workers.length, running: 0 },
                };
            }

            if (runningWorkers > 0) {
                return {
                    status: 'warn',
                    message: 'Some workers are stopped',
                    details: { total: this.workers.length, running: this.workers.length - runningWorkers },
                };
            }

            return {
                status: 'pass',
                message: 'All workers running',
                details: { total: this.workers.length, running: this.workers.length },
            };
        } catch (error) {
            return {
                status: 'fail',
                message: 'Worker health check failed',
                details: { error: error instanceof Error ? error.message : String(error) },
            };
        }
    }

    private async checkQueues(): Promise<HealthCheck> {
        if (this.queues.length === 0) {
            return {
                status: 'warn',
                message: 'No queues registered',
            };
        }

        try {
            const queueStats = await Promise.all(
                this.queues.map(async (queue) => {
                    const counts = await queue.getJobCounts();
                    return {
                        name: queue.name,
                        waiting: counts.waiting || 0,
                        active: counts.active || 0,
                        failed: counts.failed || 0,
                    };
                })
            );

            const totalFailed = queueStats.reduce((sum, q) => sum + q.failed, 0);
            const totalWaiting = queueStats.reduce((sum, q) => sum + q.waiting, 0);

            if (totalFailed > 100) {
                return {
                    status: 'warn',
                    message: 'High number of failed jobs',
                    details: { queues: queueStats },
                };
            }

            if (totalWaiting > 1000) {
                return {
                    status: 'warn',
                    message: 'High queue backlog',
                    details: { queues: queueStats },
                };
            }

            return {
                status: 'pass',
                message: 'Queues healthy',
                details: { queues: queueStats },
            };
        } catch (error) {
            return {
                status: 'fail',
                message: 'Queue health check failed',
                details: { error: error instanceof Error ? error.message : String(error) },
            };
        }
    }

    async getLiveness(): Promise<{ alive: boolean }> {
        // Simple liveness check - just verify the process is running
        return { alive: true };
    }

    async getReadiness(): Promise<{ ready: boolean; reason?: string }> {
        // Readiness check - verify system can handle requests
        const health = await this.getHealth();

        if (health.status === 'unhealthy') {
            return {
                ready: false,
                reason: 'System is unhealthy',
            };
        }

        return { ready: true };
    }
}
