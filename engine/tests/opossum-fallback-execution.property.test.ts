import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreaker, CircuitBreakerError, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for circuit breaker fallback execution.
 * 
 * **Feature: opossum-circuit-breaker, Property 10: Fallback Execution**
 * **Validates: Requirements 5.2, 5.3**
 * 
 * These tests verify that:
 * - For any circuit breaker configured with a fallback function, when the circuit is OPEN
 *   or the protected function fails, the fallback SHALL be executed and its result returned
 *   instead of throwing an error.
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names
const breakerNameArb = fc.stringMatching(/^[a-z]+:[a-z0-9.-]+$/);

// Low failure thresholds for testing (1-5)
const lowFailureThresholdArb = fc.integer({ min: 1, max: 5 });

// Test options with configurable failure threshold
const testOptionsArb = (failureThreshold: number) => ({
  failureThreshold,
  successThreshold: 2,
  timeout: 60000, // Long timeout to ensure circuit stays open during test
  monitoringPeriod: 120000,
});

// Various return value types for fallback results
const fallbackValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.array(fc.integer()),
  fc.record({ key: fc.string(), value: fc.integer() })
);

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Opossum fallback execution property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 10: Fallback Execution**
   * 
   * *For any* circuit breaker configured with a fallback function, when the circuit is OPEN
   * or the protected function fails, the fallback SHALL be executed and its result returned
   * instead of throwing an error.
   * 
   * **Validates: Requirements 5.2, 5.3**
   */
  describe("Property 10: Fallback Execution", () => {
    
    test("fallback is executed when circuit is OPEN", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          lowFailureThresholdArb,
          fallbackValueArb,
          async (name, failureThreshold, fallbackValue) => {
            const fallbackFn = async () => fallbackValue;
            const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold), fallbackFn);
            
            // Force circuit open
            const failingFn = async () => { throw new Error("Service unavailable"); };
            
            for (let i = 0; i < failureThreshold; i++) {
              try {
                await breaker.execute(failingFn);
              } catch (e) {
                // Expected failures during opening
              }
            }
            
            // Verify circuit is OPEN
            expect(breaker.getState()).toBe(CircuitState.OPEN);
            
            // Property: when circuit is OPEN, fallback should be executed and return its value
            const result = await breaker.execute(async () => "should not execute");
            expect(result).toEqual(fallbackValue);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("fallback is NOT executed when circuit is CLOSED and function succeeds", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          fallbackValueArb,
          fc.string(),
          async (name, fallbackValue, successValue) => {
            let fallbackCalled = false;
            const fallbackFn = async () => {
              fallbackCalled = true;
              return fallbackValue;
            };
            const breaker = new CircuitBreaker(name, testOptionsArb(5), fallbackFn);
            
            // Verify circuit is CLOSED
            expect(breaker.getState()).toBe(CircuitState.CLOSED);
            
            // Execute a successful function
            const result = await breaker.execute(async () => successValue);
            
            // Property: fallback should NOT be called when function succeeds
            expect(fallbackCalled).toBe(false);
            expect(result).toBe(successValue);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("no error thrown when circuit is OPEN with fallback configured", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          lowFailureThresholdArb,
          fallbackValueArb,
          async (name, failureThreshold, fallbackValue) => {
            const fallbackFn = async () => fallbackValue;
            const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold), fallbackFn);
            
            // Force circuit open
            const failingFn = async () => { throw new Error("Service unavailable"); };
            
            for (let i = 0; i < failureThreshold; i++) {
              try {
                await breaker.execute(failingFn);
              } catch (e) {
                // Expected failures during opening
              }
            }
            
            // Property: no CircuitBreakerError should be thrown when fallback is configured
            let errorThrown = false;
            try {
              await breaker.execute(async () => "test");
            } catch (e) {
              if (e instanceof CircuitBreakerError) {
                errorThrown = true;
              }
            }
            
            expect(errorThrown).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("CircuitBreakerError thrown when circuit is OPEN without fallback", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          lowFailureThresholdArb,
          async (name, failureThreshold) => {
            // No fallback configured
            const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold));
            
            // Force circuit open
            const failingFn = async () => { throw new Error("Service unavailable"); };
            
            for (let i = 0; i < failureThreshold; i++) {
              try {
                await breaker.execute(failingFn);
              } catch (e) {
                // Expected failures during opening
              }
            }
            
            // Property: CircuitBreakerError should be thrown when no fallback is configured
            let thrownError: Error | null = null;
            try {
              await breaker.execute(async () => "test");
            } catch (e) {
              thrownError = e as Error;
            }
            
            expect(thrownError).not.toBeNull();
            expect(thrownError).toBeInstanceOf(CircuitBreakerError);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("fallback receives no arguments when executed", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          lowFailureThresholdArb,
          async (name, failureThreshold) => {
            let receivedArgs: any[] = [];
            const fallbackFn = async (...args: any[]) => {
              receivedArgs = args;
              return "fallback result";
            };
            const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold), fallbackFn);
            
            // Force circuit open
            const failingFn = async () => { throw new Error("Service unavailable"); };
            
            for (let i = 0; i < failureThreshold; i++) {
              try {
                await breaker.execute(failingFn);
              } catch (e) {
                // Expected failures during opening
              }
            }
            
            // Execute with fallback
            await breaker.execute(async () => "test");
            
            // Property: fallback should receive no arguments (empty array)
            expect(receivedArgs.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("multiple calls to OPEN circuit all use fallback", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          lowFailureThresholdArb,
          fc.integer({ min: 2, max: 10 }),
          fallbackValueArb,
          async (name, failureThreshold, callCount, fallbackValue) => {
            const fallbackFn = async () => fallbackValue;
            const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold), fallbackFn);
            
            // Force circuit open
            const failingFn = async () => { throw new Error("Service unavailable"); };
            
            for (let i = 0; i < failureThreshold; i++) {
              try {
                await breaker.execute(failingFn);
              } catch (e) {
                // Expected failures during opening
              }
            }
            
            // Reset call count tracking after circuit is open
            let fallbackCallCount = 0;
            const trackingFallbackFn = async () => {
              fallbackCallCount++;
              return fallbackValue;
            };
            
            // Create a new breaker with tracking fallback for the actual test
            const trackingBreaker = new CircuitBreaker(`${name}-tracking`, testOptionsArb(failureThreshold), trackingFallbackFn);
            
            // Force this circuit open too
            for (let i = 0; i < failureThreshold; i++) {
              try {
                await trackingBreaker.execute(failingFn);
              } catch (e) {
                // Expected failures during opening
              }
            }
            
            // Reset counter after opening
            fallbackCallCount = 0;
            
            // Make multiple calls to the open circuit
            const results: any[] = [];
            for (let i = 0; i < callCount; i++) {
              const result = await trackingBreaker.execute(async () => "should not execute");
              results.push(result);
            }
            
            // Property: all results should be the fallback value
            for (const result of results) {
              expect(result).toEqual(fallbackValue);
            }
            
            // Property: fallback should have been called for each request
            expect(fallbackCallCount).toBe(callCount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
