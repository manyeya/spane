import type { Worker, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from './logger';

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
            logger.info('Received SIGTERM signal, starting graceful shutdown');
            this.shutdown().catch((error) => {
                console.error('Fatal error during shutdown:', error); // Keep console for fatal errors
                process.exit(1);
            });
        });

        // Handle SIGINT (e.g., Ctrl+C)
        process.once('SIGINT', () => {
            logger.info('Received SIGINT signal, starting graceful shutdown');
            this.shutdown().catch((error) => {
                console.error('Fatal error during shutdown:', error); // Keep console for fatal errors
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
            logger.warn('Shutdown already in progress');
            return;
        }

        this.isShuttingDown = true;
        logger.info('Starting graceful shutdown');

        // Use AbortController to properly cancel timeout
        const abortController = new AbortController();

        const shutdownPromise = this.performShutdown().finally(() => {
            abortController.abort(); // Cancel timeout when shutdown completes
        });

        const timeoutPromise = new Promise<void>((resolve) => {
            const timeoutId = setTimeout(() => {
                logger.warn(`Shutdown timeout (${this.options.timeout}ms) reached`);
                resolve();
            }, this.options.timeout);

            // Clear timeout if shutdown completes early
            abortController.signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
            });
        });

        try {
            await Promise.race([shutdownPromise, timeoutPromise]);
            logger.info('Graceful shutdown completed');
        } catch (error) {
            logger.error({ error }, 'Error during shutdown');
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
                            logger.debug(`Closing worker: ${worker.name}`);
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
                            logger.error({ reason: result.reason }, `Cleanup handler ${index + 1} failed`);
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
                            logger.debug(`Closing queue: ${queue.name}`);
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
                            logger.debug('Closing Redis connection');
                            await redis.quit();
                        })
                    );
                },
            });
        }

        // Execute all steps sequentially
        for (const step of steps) {
            try {
                logger.info(`[Shutdown] ${step.name}...`);
                await step.fn();
                logger.info(`[Shutdown] ${step.name} completed`);
            } catch (error) {
                logger.error({ error, step: step.name }, `[Shutdown] Error in ${step.name}`);
                // Continue with other steps even if one fails
            }
        }
    }

    isShutdownInProgress(): boolean {
        return this.isShuttingDown;
    }
}
