/**
 * Retry helper with exponential backoff
 * Provides configurable retry logic for transient failures
 */
export class RetryHelper {
    /**
     * Execute a function with retry logic
     * @param fn Function to execute
     * @param options Retry options
     * @returns Function result
     * @throws Last error if all retries exhausted
     */
    static async withRetry<T>(
        fn: () => Promise<T>,
        options: {
            maxAttempts?: number;
            initialDelay?: number;
            maxDelay?: number;
            backoffMultiplier?: number;
            retryableErrors?: (error: Error) => boolean;
            onRetry?: (error: Error, attempt: number, delay: number) => void;
        } = {}
    ): Promise<T> {
        const {
            maxAttempts = 3,
            initialDelay = 1000, // 1 second
            maxDelay = 30000, // 30 seconds
            backoffMultiplier = 2,
            retryableErrors = () => true, // Retry all errors by default
            onRetry,
        } = options;

        let lastError: Error;
        let delay = initialDelay;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Check if error is retryable
                if (!retryableErrors(lastError)) {
                    throw lastError;
                }

                // Don't retry if this was the last attempt
                if (attempt === maxAttempts) {
                    break;
                }

                // Calculate delay with exponential backoff
                const currentDelay = Math.min(delay, maxDelay);

                // Call retry callback if provided
                if (onRetry) {
                    onRetry(lastError, attempt, currentDelay);
                }

                // Wait before retrying
                await this.sleep(currentDelay);

                // Increase delay for next attempt
                delay *= backoffMultiplier;
            }
        }

        throw lastError!;
    }

    /**
     * Sleep for specified milliseconds
     */
    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if error is a transient/retryable error
     * Common patterns for database, network, and queue errors
     */
    static isTransientError(error: Error): boolean {
        const message = error.message.toLowerCase();

        // Database connection errors
        if (
            message.includes('connection') ||
            message.includes('timeout') ||
            message.includes('econnrefused') ||
            message.includes('enotfound') ||
            message.includes('etimedout')
        ) {
            return true;
        }

        // Database lock/deadlock errors
        if (
            message.includes('deadlock') ||
            message.includes('lock timeout') ||
            message.includes('could not serialize')
        ) {
            return true;
        }

        // Redis errors
        if (
            message.includes('redis') &&
            (message.includes('connection') || message.includes('timeout'))
        ) {
            return true;
        }

        // Rate limiting
        if (
            message.includes('rate limit') ||
            message.includes('too many requests') ||
            message.includes('429')
        ) {
            return true;
        }

        // Temporary unavailability
        if (
            message.includes('temporarily unavailable') ||
            message.includes('service unavailable') ||
            message.includes('503')
        ) {
            return true;
        }

        return false;
    }

    /**
     * Retry with jitter to prevent thundering herd
     * Adds randomness to delay to spread out retries
     */
    static async withRetryAndJitter<T>(
        fn: () => Promise<T>,
        options: {
            maxAttempts?: number;
            baseDelay?: number;
            maxDelay?: number;
            jitterFactor?: number; // 0-1, amount of randomness
            retryableErrors?: (error: Error) => boolean;
            onRetry?: (error: Error, attempt: number, delay: number) => void;
        } = {}
    ): Promise<T> {
        const {
            maxAttempts = 3,
            baseDelay = 1000,
            maxDelay = 30000,
            jitterFactor = 0.3, // 30% jitter
            retryableErrors = RetryHelper.isTransientError,
            onRetry,
        } = options;

        let lastError: Error;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (!retryableErrors(lastError)) {
                    throw lastError;
                }

                if (attempt === maxAttempts) {
                    break;
                }

                // Exponential backoff: baseDelay * 2^(attempt-1)
                const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);

                // Add jitter: delay * (1 ± jitterFactor)
                const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1);
                const delayWithJitter = exponentialDelay + jitter;

                // Cap at maxDelay
                const currentDelay = Math.min(delayWithJitter, maxDelay);

                if (onRetry) {
                    onRetry(lastError, attempt, currentDelay);
                }

                await this.sleep(currentDelay);
            }
        }

        throw lastError!;
    }
}
