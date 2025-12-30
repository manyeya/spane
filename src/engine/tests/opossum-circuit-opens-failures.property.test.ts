import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreaker, CircuitBreakerError, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for circuit breaker opening on failures.
 * 
 * **Feature: opossum-circuit-breaker, Property 3: Circuit Opens on Failure Threshold**
 * **Validates: Requirements 3.2, 3.3**
 * 
 * These tests verify that:
 * - For any sequence of consecutive failures equal to or exceeding the failureThreshold,
 *   the circuit breaker transitions to OPEN state and rejects subsequent execution attempts
 *   with a CircuitBreakerError.
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

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Opossum circuit opens on failures property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 3: Circuit Opens on Failure Threshold**
   * 
   * *For any* sequence of consecutive failures equal to or exceeding the failureThreshold,
   * the circuit breaker SHALL transition to OPEN state and reject subsequent execution
   * attempts with a CircuitBreakerError.
   * 
   * **Validates: Requirements 3.2, 3.3**
   */
  describe("Property 3: Circuit Opens on Failure Threshold", () => {
    
    test("circuit opens after exactly failureThreshold failures", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, lowFailureThresholdArb, async (name, failureThreshold) => {
          const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold));
          
          // Verify circuit starts closed
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
          
          // Cause exactly failureThreshold failures
          const failingFn = async () => { throw new Error("Service unavailable"); };
          
          for (let i = 0; i < failureThreshold; i++) {
            try {
              await breaker.execute(failingFn);
            } catch (e) {
              // Expected failures
            }
          }
          
          // Property: circuit should now be OPEN
          expect(breaker.getState()).toBe(CircuitState.OPEN);
        }),
        { numRuns: 100 }
      );
    });

    test("open circuit throws CircuitBreakerError", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, lowFailureThresholdArb, async (name, failureThreshold) => {
          const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold));
          
          // Force circuit open
          const failingFn = async () => { throw new Error("Service unavailable"); };
          
          for (let i = 0; i < failureThreshold; i++) {
            try {
              await breaker.execute(failingFn);
            } catch (e) {
              // Expected failures
            }
          }
          
          // Property: subsequent execution should throw CircuitBreakerError
          let thrownError: Error | null = null;
          try {
            await breaker.execute(async () => "should not execute");
          } catch (e) {
            thrownError = e as Error;
          }
          
          expect(thrownError).not.toBeNull();
          expect(thrownError).toBeInstanceOf(CircuitBreakerError);
        }),
        { numRuns: 100 }
      );
    });

    test("CircuitBreakerError message contains circuit breaker info", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, testOptionsArb(1));
          
          // Force circuit open with single failure
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          // Property: error message should contain breaker name
          let thrownError: CircuitBreakerError | null = null;
          try {
            await breaker.execute(async () => "test");
          } catch (e) {
            if (e instanceof CircuitBreakerError) {
              thrownError = e;
            }
          }
          
          expect(thrownError).not.toBeNull();
          expect(thrownError!.message.toLowerCase()).toContain("circuit breaker");
          expect(thrownError!.message).toContain(name);
        }),
        { numRuns: 100 }
      );
    });

    test("open circuit prevents function execution", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, lowFailureThresholdArb, async (name, failureThreshold) => {
          const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold));
          let executionCount = 0;
          
          // Force circuit open
          const failingFn = async () => {
            executionCount++;
            throw new Error("Service unavailable");
          };
          
          for (let i = 0; i < failureThreshold; i++) {
            try {
              await breaker.execute(failingFn);
            } catch (e) {
              // Expected failures
            }
          }
          
          const executionsBeforeOpen = executionCount;
          
          // Property: function should NOT be called when circuit is open
          const successFn = async () => {
            executionCount++;
            return "success";
          };
          
          try {
            await breaker.execute(successFn);
          } catch (e) {
            // Expected - circuit is open
          }
          
          // Property: execution count should not have increased
          expect(executionCount).toBe(executionsBeforeOpen);
        }),
        { numRuns: 100 }
      );
    });

    test("failures are tracked correctly", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, lowFailureThresholdArb, async (name, failureThreshold) => {
          const breaker = new CircuitBreaker(name, testOptionsArb(failureThreshold));
          
          // Cause failures one less than threshold
          const failingFn = async () => { throw new Error("Service unavailable"); };
          
          for (let i = 0; i < failureThreshold - 1; i++) {
            try {
              await breaker.execute(failingFn);
            } catch (e) {
              // Expected failures
            }
          }
          
          // Property: circuit should still be CLOSED (not enough failures yet)
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
          
          // One more failure should open the circuit
          try {
            await breaker.execute(failingFn);
          } catch (e) {
            // Expected
          }
          
          // Property: now circuit should be OPEN
          expect(breaker.getState()).toBe(CircuitState.OPEN);
        }),
        { numRuns: 100 }
      );
    });
  });
});
