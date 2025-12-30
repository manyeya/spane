import CircuitBreakerLib from 'opossum';
import { logger } from './logger';

export interface CircuitBreakerOptions {
    failureThreshold: number; // Number of failures before opening circuit
    successThreshold: number; // Number of successes to close circuit
    timeout: number; // Time in ms to wait before attempting reset
    monitoringPeriod: number; // Time window to track failures
}

export enum CircuitState {
    CLOSED = 'CLOSED', // Normal operation
    OPEN = 'OPEN', // Failing, reject requests
    HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

export class CircuitBreakerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CircuitBreakerError';
    }
}

/**
 * Maps our CircuitBreakerOptions to Opossum options.
 * 
 * Mapping:
 * - failureThreshold → volumeThreshold (minimum requests before calculating error rate)
 * - timeout → resetTimeout (time before attempting half-open)
 * - monitoringPeriod → rollingCountTimeout (time window for tracking failures)
 * - successThreshold is handled via custom logic in half-open state
 */
export function mapToOpossumOptions(options: CircuitBreakerOptions): CircuitBreakerLib.Options {
    return {
        volumeThreshold: options.failureThreshold,
        resetTimeout: options.timeout,
        rollingCountTimeout: options.monitoringPeriod,
        // Set error threshold percentage - when this % of requests fail, circuit opens
        // With volumeThreshold=N, we want to open after N failures
        // So we set errorThresholdPercentage to ensure N failures triggers opening
        errorThresholdPercentage: 1, // Open on any failure once volume threshold is met
        // Disable timeout for the wrapped function (we don't want Opossum to timeout)
        timeout: false,
        // Allow only one request in half-open state
        allowWarmUp: false,
    };
}

export class CircuitBreaker {
    private breaker: CircuitBreakerLib<[() => Promise<any>], any>;
    private successCountInHalfOpen: number = 0;
    private readonly successThreshold: number;
    private readonly breakerName: string;
    private readonly resetTimeout: number;
    private fallbackFn?: (...args: any[]) => Promise<any>;
    private halfOpenInProgress: boolean = false;

    constructor(
        name: string,
        options: CircuitBreakerOptions,
        fallback?: (...args: any[]) => Promise<any>
    ) {
        this.breakerName = name;
        this.successThreshold = options.successThreshold;
        this.resetTimeout = options.timeout;
        this.fallbackFn = fallback;
        
        // Create a wrapper function that executes the passed function
        const executorFn = async (fn: () => Promise<any>) => {
            return await fn();
        };
        
        const opossumOptions = mapToOpossumOptions(options);
        this.breaker = new CircuitBreakerLib(executorFn, opossumOptions);
        
        this.setupEventHandlers();
        
        if (fallback) {
            this.breaker.fallback(async () => fallback());
        }
    }

    private setupEventHandlers(): void {
        this.breaker.on('open', () => {
            const nextRetry = new Date(Date.now() + this.resetTimeout).toISOString();
            logger.error(
                { breakerName: this.breakerName, nextRetry },
                `Circuit breaker '${this.breakerName}' opened. Will retry at ${nextRetry}`
            );
        });

        this.breaker.on('close', () => {
            this.successCountInHalfOpen = 0;
            this.halfOpenInProgress = false;
            logger.info(
                { breakerName: this.breakerName },
                `Circuit breaker '${this.breakerName}' closed after recovery`
            );
        });

        this.breaker.on('halfOpen', () => {
            this.successCountInHalfOpen = 0;
            this.halfOpenInProgress = false;
            logger.debug(
                { breakerName: this.breakerName },
                `Circuit breaker '${this.breakerName}' half-open, attempting probe`
            );
        });
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // Check if circuit is open and should reject
        if (this.breaker.opened && !this.breaker.pendingClose) {
            if (this.fallbackFn) {
                return this.fallbackFn() as Promise<T>;
            }
            throw new CircuitBreakerError(
                `Circuit breaker '${this.breakerName}' is OPEN. Service unavailable.`
            );
        }

        // Handle half-open state with mutex
        if (this.breaker.halfOpen || this.breaker.pendingClose) {
            if (this.halfOpenInProgress) {
                if (this.fallbackFn) {
                    return this.fallbackFn() as Promise<T>;
                }
                throw new CircuitBreakerError(
                    `Circuit breaker '${this.breakerName}' is being probed. Try again later.`
                );
            }
            this.halfOpenInProgress = true;
        }

        try {
            // Fire the actual function through Opossum
            const result = await this.breaker.fire(fn);
            
            // Handle half-open success counting
            if (this.breaker.halfOpen || this.breaker.pendingClose) {
                this.successCountInHalfOpen++;
                if (this.successCountInHalfOpen >= this.successThreshold) {
                    this.breaker.close();
                    this.halfOpenInProgress = false;
                }
            }
            
            return result;
        } catch (error) {
            this.halfOpenInProgress = false;
            
            // If Opossum rejected due to open circuit
            if (error instanceof Error && error.message.includes('Breaker is open')) {
                if (this.fallbackFn) {
                    return this.fallbackFn() as Promise<T>;
                }
                throw new CircuitBreakerError(
                    `Circuit breaker '${this.breakerName}' is OPEN. Service unavailable.`
                );
            }
            throw error;
        }
    }

    getState(): CircuitState {
        if (this.breaker.halfOpen || this.breaker.pendingClose) {
            return CircuitState.HALF_OPEN;
        }
        if (this.breaker.opened) {
            return CircuitState.OPEN;
        }
        return CircuitState.CLOSED;
    }

    getStats() {
        const stats = this.breaker.stats;
        return {
            name: this.breakerName,
            state: this.getState(),
            failureCount: stats.failures,
            successCount: stats.successes,
            nextAttempt: this.breaker.opened && !this.breaker.halfOpen && !this.breaker.pendingClose
                ? new Date(Date.now() + this.resetTimeout).toISOString()
                : null,
        };
    }

    reset(): void {
        this.breaker.close();
        // Opossum doesn't have a stats.reset() method, but closing the circuit
        // and resetting our internal state is sufficient for the reset behavior
        this.successCountInHalfOpen = 0;
        this.halfOpenInProgress = false;
        logger.info(
            { breakerName: this.breakerName },
            `Circuit breaker '${this.breakerName}' manually reset`
        );
    }
}

// Circuit breaker registry for managing multiple breakers
export class CircuitBreakerRegistry {
    private breakers = new Map<string, CircuitBreaker>();

    getOrCreate(
        name: string,
        options: CircuitBreakerOptions = {
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 60000, // 1 minute
            monitoringPeriod: 120000, // 2 minutes
        },
        fallback?: (...args: any[]) => Promise<any>
    ): CircuitBreaker {
        const existing = this.breakers.get(name);
        if (existing) {
            // Warn if options are being ignored
            logger.warn(
                { breakerName: name },
                `Circuit breaker '${name}' already exists. Ignoring provided options.`
            );
            return existing;
        }

        const breaker = new CircuitBreaker(name, options, fallback);
        this.breakers.set(name, breaker);
        return breaker;
    }

    get(name: string): CircuitBreaker | undefined {
        return this.breakers.get(name);
    }

    getAllStats() {
        return Array.from(this.breakers.values()).map((breaker) => breaker.getStats());
    }

    reset(name: string): boolean {
        const breaker = this.breakers.get(name);
        if (breaker) {
            breaker.reset();
            return true;
        }
        return false;
    }

    resetAll(): void {
        this.breakers.forEach((breaker) => breaker.reset());
    }
}
