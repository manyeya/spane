import type { Worker, Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export interface ShutdownOptions {
    timeout: number; // Max time to wait for graceful shutdown in ms
    forceExit: boolean; // Whether to force exit after timeout
}

export class GracefulShutdown {
    private isShuttingDown = false;
    private workers: Worker[] = [];
    private queues: Queue[] = [];
    private redisConnections: Redis[] = [];
    private cleanupHandlers: Array<() => Promise<void>> = [];
    private signalHandlersRegistered = false;

    constructor(private options: ShutdownOptions = { timeout: 30000, forceExit: true }) {
        this.setupSignalHandlers();
    }

    registerWorker(worker: Worker): void {
        this.workers.push(worker);
    }

    registerQueue(queue: Queue): void {
        this.queues.push(queue);
    }

    registerRedis(redis: Redis): void {
        this.redisConnections.push(redis);
    }

    registerCleanupHandler(handler: () => Promise<void>): void {
        this.cleanupHandlers.push(handler);
    }

    private setupSignalHandlers(): void {
        // Prevent duplicate handler registration
        if (this.signalHandlersRegistered) {
            return;
        }
        this.signalHandlersRegistered = true;

        // Handle SIGTERM (e.g., from Kubernetes, Docker)
        process.once('SIGTERM', () => {
            console.log('Received SIGTERM signal, starting graceful shutdown...');
            this.shutdown().catch((error) => {
                console.error('Fatal error during shutdown:', error);
                process.exit(1);
            });
        });

        // Handle SIGINT (e.g., Ctrl+C)
        process.once('SIGINT', () => {
            console.log('Received SIGINT signal, starting graceful shutdown...');
            this.shutdown().catch((error) => {
                console.error('Fatal error during shutdown:', error);
                process.exit(1);
            });
        });

        // Handle uncaught exceptions - log and exit immediately
        process.once('uncaughtException', (error) => {
            console.error('Uncaught exception:', error);
            // Don't attempt graceful shutdown on uncaught exception
            // Just exit immediately to prevent hanging
            process.exit(1);
        });

        // Handle unhandled promise rejections - log and exit immediately
        process.once('unhandledRejection', (reason, promise) => {
            console.error('Unhandled rejection at:', promise, 'reason:', reason);
            // Don't attempt graceful shutdown on unhandled rejection
            // Just exit immediately to prevent hanging
            process.exit(1);
        });
    }

    async shutdown(exitCode: number = 0): Promise<void> {
        if (this.isShuttingDown) {
            console.log('Shutdown already in progress...');
            return;
        }

        this.isShuttingDown = true;
        console.log('Starting graceful shutdown...');

        // Use AbortController to properly cancel timeout
        const abortController = new AbortController();

        const shutdownPromise = this.performShutdown().finally(() => {
            abortController.abort(); // Cancel timeout when shutdown completes
        });

        const timeoutPromise = new Promise<void>((resolve) => {
            const timeoutId = setTimeout(() => {
                console.warn(`Shutdown timeout (${this.options.timeout}ms) reached`);
                resolve();
            }, this.options.timeout);

            // Clear timeout if shutdown completes early
            abortController.signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
            });
        });

        try {
            await Promise.race([shutdownPromise, timeoutPromise]);
            console.log('Graceful shutdown completed');
        } catch (error) {
            console.error('Error during shutdown:', error);
            exitCode = 1;
        }

        if (this.options.forceExit) {
            process.exit(exitCode);
        }
    }

    private async performShutdown(): Promise<void> {
        const steps: Array<{ name: string; fn: () => Promise<void> }> = [];

        // Step 1: Stop accepting new jobs (close workers)
        if (this.workers.length > 0) {
            steps.push({
                name: 'Closing workers',
                fn: async () => {
                    await Promise.allSettled(
                        this.workers.map(async (worker) => {
                            console.log(`Closing worker: ${worker.name}`);
                            await worker.close();
                        })
                    );
                },
            });
        }

        // Step 2: Run custom cleanup handlers (run all, even if some fail)
        if (this.cleanupHandlers.length > 0) {
            steps.push({
                name: 'Running cleanup handlers',
                fn: async () => {
                    const results = await Promise.allSettled(
                        this.cleanupHandlers.map((handler) => handler())
                    );

                    // Log any failures but continue
                    results.forEach((result, index) => {
                        if (result.status === 'rejected') {
                            console.error(`Cleanup handler ${index + 1} failed:`, result.reason);
                        }
                    });
                },
            });
        }

        // Step 3: Close queues
        if (this.queues.length > 0) {
            steps.push({
                name: 'Closing queues',
                fn: async () => {
                    await Promise.allSettled(
                        this.queues.map(async (queue) => {
                            console.log(`Closing queue: ${queue.name}`);
                            await queue.close();
                        })
                    );
                },
            });
        }

        // Step 4: Close Redis connections
        if (this.redisConnections.length > 0) {
            steps.push({
                name: 'Closing Redis connections',
                fn: async () => {
                    await Promise.allSettled(
                        this.redisConnections.map(async (redis) => {
                            console.log('Closing Redis connection');
                            await redis.quit();
                        })
                    );
                },
            });
        }

        // Execute all steps sequentially
        for (const step of steps) {
            try {
                console.log(`[Shutdown] ${step.name}...`);
                await step.fn();
                console.log(`[Shutdown] ${step.name} completed`);
            } catch (error) {
                console.error(`[Shutdown] Error in ${step.name}:`, error);
                // Continue with other steps even if one fails
            }
        }
    }

    isShutdownInProgress(): boolean {
        return this.isShuttingDown;
    }
}
