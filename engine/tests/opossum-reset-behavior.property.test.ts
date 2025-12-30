import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreaker, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for circuit breaker reset behavior.
 * 
 * **Feature: opossum-circuit-breaker, Property 6: Reset Clears State**
 * **Validates: Requirements 3.7**
 * 
 * These tests verify that:
 * - For any circuit breaker in any state (CLOSED, OPEN, or HALF_OPEN), calling reset()
 *   transitions the circuit to CLOSED state.
 * 
 * Note: Opossum maintains rolling stats that don't reset, but the circuit state
 * is properly reset to CLOSED, allowing normal operation to resume.
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names
const breakerNameArb = fc.stringMatching(/^[a-z]+:[a-z0-9.-]+$/);

// Default options for testing
const defaultOptions = {
  failureThreshold: 1,
  successThreshold: 2,
  timeout: 10, // Short timeout for testing
  monitoringPeriod: 120000,
};

// Helper to wait for timeout
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Opossum reset behavior property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 6: Reset Clears State**
   * 
   * *For any* circuit breaker in any state (CLOSED, OPEN, or HALF_OPEN), calling reset()
   * SHALL transition the circuit to CLOSED state.
   * 
   * **Validates: Requirements 3.7**
   */
  describe("Property 6: Reset Clears State", () => {
    
    test("reset from CLOSED state keeps circuit CLOSED", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, {
            failureThreshold: 10,
            successThreshold: 2,
            timeout: 60000,
            monitoringPeriod: 120000,
          });
          
          // Execute some successful operations
          for (let i = 0; i < 5; i++) {
            await breaker.execute(async () => "success");
          }
          
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
          
          // Reset
          breaker.reset();
          
          const stats = breaker.getStats();
          
          // Property: after reset, state should be CLOSED
          expect(stats.state).toBe(CircuitState.CLOSED);
          expect(stats.nextAttempt).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    test("reset from OPEN state results in CLOSED", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, defaultOptions);
          
          // Force circuit open
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          expect(breaker.getState()).toBe(CircuitState.OPEN);
          
          // Reset
          breaker.reset();
          
          const stats = breaker.getStats();
          
          // Property: after reset, state should be CLOSED
          expect(stats.state).toBe(CircuitState.CLOSED);
          expect(stats.nextAttempt).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    test("reset from any state results in CLOSED and allows operation", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, {
            failureThreshold: 1,
            successThreshold: 5, // High threshold
            timeout: 10,
            monitoringPeriod: 120000,
          });
          
          // Force circuit open
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          expect(breaker.getState()).toBe(CircuitState.OPEN);
          
          // Wait for timeout
          await wait(20);
          
          // Reset from whatever state we're in (OPEN or transitioning)
          breaker.reset();
          
          const stats = breaker.getStats();
          
          // Property: after reset, state should be CLOSED
          expect(stats.state).toBe(CircuitState.CLOSED);
          expect(stats.nextAttempt).toBeNull();
          
          // Property: should be able to execute after reset
          const result = await breaker.execute(async () => "success");
          expect(result).toBe("success");
        }),
        { numRuns: 25 } // Reduced due to timing
      );
    }, 30000);

    test("reset allows normal operation after being OPEN", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, defaultOptions);
          
          // Force circuit open
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          expect(breaker.getState()).toBe(CircuitState.OPEN);
          
          // Reset
          breaker.reset();
          
          // Property: should be able to execute normally after reset
          const result = await breaker.execute(async () => "success after reset");
          expect(result).toBe("success after reset");
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
        }),
        { numRuns: 100 }
      );
    });

    test("multiple resets are idempotent", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, fc.integer({ min: 2, max: 5 }), async (name, resetCount) => {
          const breaker = new CircuitBreaker(name, defaultOptions);
          
          // Force circuit open
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          // Reset multiple times
          for (let i = 0; i < resetCount; i++) {
            breaker.reset();
          }
          
          const stats = breaker.getStats();
          
          // Property: multiple resets should have same effect as single reset
          expect(stats.state).toBe(CircuitState.CLOSED);
          expect(stats.nextAttempt).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    test("reset allows circuit to function normally again", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, {
            failureThreshold: 2,
            successThreshold: 2,
            timeout: 60000,
            monitoringPeriod: 120000,
          });
          
          // Force circuit open with failures
          for (let i = 0; i < 2; i++) {
            try {
              await breaker.execute(async () => { throw new Error("fail"); });
            } catch (e) {
              // Expected
            }
          }
          
          expect(breaker.getState()).toBe(CircuitState.OPEN);
          
          // Reset
          breaker.reset();
          
          // Property: circuit should function normally after reset
          // Execute successful operations
          const result1 = await breaker.execute(async () => "success1");
          const result2 = await breaker.execute(async () => "success2");
          
          expect(result1).toBe("success1");
          expect(result2).toBe("success2");
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
        }),
        { numRuns: 100 }
      );
    });
  });
});
