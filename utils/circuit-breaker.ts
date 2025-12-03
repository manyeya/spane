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

export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private successCount: number = 0;
    private nextAttempt: number = Date.now();
    private failures: number[] = []; // Timestamps of failures
    private halfOpenInProgress = false; // Mutex for HALF_OPEN state

    constructor(
        private name: string,
        private options: CircuitBreakerOptions
    ) { }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() < this.nextAttempt) {
                throw new CircuitBreakerError(
                    `Circuit breaker '${this.name}' is OPEN. Service unavailable.`
                );
            }
            // Attempt to reset - use mutex to prevent race condition
            if (this.halfOpenInProgress) {
                // Another request is already probing, reject this one
                throw new CircuitBreakerError(
                    `Circuit breaker '${this.name}' is being probed. Try again later.`
                );
            }
            this.halfOpenInProgress = true;
            this.state = CircuitState.HALF_OPEN;
            this.successCount = 0;
        }

        // If already HALF_OPEN and another request comes in, reject it
        if (this.state === CircuitState.HALF_OPEN && this.halfOpenInProgress) {
            // This request didn't set the flag, so another request is probing
            throw new CircuitBreakerError(
                `Circuit breaker '${this.name}' is being probed. Try again later.`
            );
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failureCount = 0;

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.options.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.successCount = 0;
                this.failures = [];
                this.halfOpenInProgress = false; // Release mutex
                console.log(`[CircuitBreaker] '${this.name}' closed after recovery`);
            }
        }
    }

    private onFailure(): void {
        const now = Date.now();
        this.failures.push(now);

        // Remove old failures outside monitoring period
        this.failures = this.failures.filter(
            (timestamp) => now - timestamp < this.options.monitoringPeriod
        );

        this.failureCount = this.failures.length;

        // CRITICAL: Single failure in HALF_OPEN should immediately re-open
        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.OPEN;
            this.nextAttempt = now + this.options.timeout;
            this.halfOpenInProgress = false; // Release mutex
            console.error(
                `[CircuitBreaker] '${this.name}' re-opened after failure during probe. Will retry at ${new Date(this.nextAttempt).toISOString()}`
            );
            return;
        }

        // Normal CLOSED state failure handling
        if (this.failureCount >= this.options.failureThreshold) {
            this.state = CircuitState.OPEN;
            this.nextAttempt = now + this.options.timeout;
            console.error(
                `[CircuitBreaker] '${this.name}' opened after ${this.failureCount} failures. Will retry at ${new Date(this.nextAttempt).toISOString()}`
            );
        }
    }

    getState(): CircuitState {
        return this.state;
    }

    getStats() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            nextAttempt: this.state === CircuitState.OPEN ? new Date(this.nextAttempt).toISOString() : null,
        };
    }

    reset(): void {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.failures = [];
        this.halfOpenInProgress = false;
        console.log(`[CircuitBreaker] '${this.name}' manually reset`);
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
        }
    ): CircuitBreaker {
        const existing = this.breakers.get(name);
        if (existing) {
            // Warn if options are being ignored
            console.warn(
                `[CircuitBreakerRegistry] Circuit breaker '${name}' already exists. Ignoring provided options.`
            );
            return existing;
        }

        const breaker = new CircuitBreaker(name, options);
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
