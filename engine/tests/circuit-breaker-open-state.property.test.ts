import { describe, test, expect, beforeEach, mock } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreakerRegistry, CircuitBreaker, CircuitBreakerError, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for open circuit behavior in circuit breaker integration.
 * 
 * **Feature: circuit-breaker-integration, Property 4: Open circuit returns failure result**
 * **Validates: Requirements 3.1**
 * 
 * These tests verify that:
 * - When a circuit breaker is OPEN, execution attempts throw CircuitBreakerError
 * - The error message contains "circuit breaker" information
 * - The circuit breaker prevents execution when open
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names
const breakerNameArb = fc.stringMatching(/^[a-z]+:[a-z0-9.-]+$/);

// Circuit breaker options with low thresholds for testing
const testOptionsArb = fc.record({
  failureThreshold: fc.integer({ min: 1, max: 3 }),
  successThreshold: fc.integer({ min: 1, max: 2 }),
  timeout: fc.integer({ min: 100, max: 1000 }),
  monitoringPeriod: fc.integer({ min: 1000, max: 5000 }),
});

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Circuit breaker open state property tests", () => {
  /**
   * **Feature: circuit-breaker-integration, Property 4: Open circuit returns failure result**
   * 
   * *For any* external node execution where the circuit breaker is in OPEN state, 
   * the NodeProcessor SHALL return an ExecutionResult with `success: false` and 
   * an error message containing "circuit breaker" or "Circuit breaker".
   * 
   * **Validates: Requirements 3.1**
   */
  describe("Property 4: Open circuit returns failure result", () => {
    
    test("open circuit throws CircuitBreakerError with descriptive message", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, testOptionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          
          // Force the circuit to open by causing failures
          const failingFn = async () => { throw new Error("Service unavailable"); };
          
          for (let i = 0; i < options.failureThreshold; i++) {
            try {
              await breaker.execute(failingFn);
            } catch (e) {
              // Expected failures
            }
          }
          
          // Verify circuit is now open
          expect(breaker.getState()).toBe(CircuitState.OPEN);
          
          // Property: attempting execution on open circuit throws CircuitBreakerError
          let thrownError: Error | null = null;
          try {
            await breaker.execute(async () => "should not execute");
          } catch (e) {
            thrownError = e as Error;
          }
          
          expect(thrownError).not.toBeNull();
          expect(thrownError).toBeInstanceOf(CircuitBreakerError);
          
          // Property: error message contains circuit breaker information
          const errorMessage = thrownError!.message.toLowerCase();
          expect(errorMessage).toContain("circuit breaker");
          expect(errorMessage).toContain(name);
        }),
        { numRuns: 100 }
      );
    });

    test("open circuit prevents function execution", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, testOptionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          let executionCount = 0;
          
          // Force the circuit to open
          const failingFn = async () => { 
            executionCount++;
            throw new Error("Service unavailable"); 
          };
          
          for (let i = 0; i < options.failureThreshold; i++) {
            try {
              await breaker.execute(failingFn);
            } catch (e) {
              // Expected failures
            }
          }
          
          const executionsBeforeOpen = executionCount;
          
          // Verify circuit is open
          expect(breaker.getState()).toBe(CircuitState.OPEN);
          
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

    test("CircuitBreakerError contains breaker name for identification", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const options = {
            failureThreshold: 1,
            successThreshold: 1,
            timeout: 60000,
            monitoringPeriod: 120000,
          };
          
          const breaker = new CircuitBreaker(name, options);
          
          // Force circuit open with single failure
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          // Property: error message contains the breaker name
          let thrownError: CircuitBreakerError | null = null;
          try {
            await breaker.execute(async () => "test");
          } catch (e) {
            if (e instanceof CircuitBreakerError) {
              thrownError = e;
            }
          }
          
          expect(thrownError).not.toBeNull();
          expect(thrownError!.message).toContain(name);
        }),
        { numRuns: 100 }
      );
    });

    test("registry returns same breaker instance for same key", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, testOptionsArb, async (name, options) => {
          const registry = new CircuitBreakerRegistry();
          
          const breaker1 = registry.getOrCreate(name, options);
          const breaker2 = registry.getOrCreate(name, options);
          
          // Property: same key returns same instance
          expect(breaker1).toBe(breaker2);
          
          // Force circuit open on breaker1
          for (let i = 0; i < options.failureThreshold; i++) {
            try {
              await breaker1.execute(async () => { throw new Error("fail"); });
            } catch (e) {
              // Expected
            }
          }
          
          // Property: breaker2 should also be open (same instance)
          expect(breaker2.getState()).toBe(CircuitState.OPEN);
        }),
        { numRuns: 100 }
      );
    });
  });
});
