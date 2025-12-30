import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreaker, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for circuit breaker half-open recovery.
 * 
 * **Feature: opossum-circuit-breaker, Property 4: Half-Open Recovery**
 * **Validates: Requirements 3.4**
 * 
 * These tests verify that:
 * - For any circuit breaker in HALF_OPEN state, when successThreshold consecutive
 *   successful executions occur, the circuit transitions to CLOSED state.
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names
const breakerNameArb = fc.stringMatching(/^[a-z]+:[a-z0-9.-]+$/);

// Success thresholds for testing (1-2 to keep tests fast)
const successThresholdArb = fc.integer({ min: 1, max: 2 });

// Test options with configurable success threshold and short timeout
const testOptionsArb = (successThreshold: number) => ({
  failureThreshold: 1, // Open quickly
  successThreshold,
  timeout: 10, // Very short timeout to quickly transition to half-open
  monitoringPeriod: 120000,
});

// Helper to wait for timeout
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Opossum half-open recovery property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 4: Half-Open Recovery**
   * 
   * *For any* circuit breaker in HALF_OPEN state, when successThreshold consecutive
   * successful executions occur, the circuit SHALL transition to CLOSED state.
   * 
   * **Validates: Requirements 3.4**
   */
  describe("Property 4: Half-Open Recovery", () => {
    
    test("circuit closes after successThreshold successes in half-open", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, successThresholdArb, async (name, successThreshold) => {
          const breaker = new CircuitBreaker(name, testOptionsArb(successThreshold));
          
          // Force circuit open
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          expect(breaker.getState()).toBe(CircuitState.OPEN);
          
          // Wait for timeout to allow half-open transition
          await wait(20);
          
          // Execute successThreshold successful functions
          for (let i = 0; i < successThreshold; i++) {
            await breaker.execute(async () => "success");
          }
          
          // Property: circuit should be CLOSED after enough successes
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
        }),
        { numRuns: 25 } // Reduced runs due to timing
      );
    }, 30000); // 30 second timeout

    test("single failure in half-open reopens circuit", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, {
            failureThreshold: 1,
            successThreshold: 3, // High threshold so we can test failure before closing
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
          
          // First success to enter half-open
          await breaker.execute(async () => "success");
          
          // Now fail in half-open state
          try {
            await breaker.execute(async () => { throw new Error("fail again"); });
          } catch (e) {
            // Expected
          }
          
          // Property: circuit should be OPEN again after failure in half-open
          expect(breaker.getState()).toBe(CircuitState.OPEN);
        }),
        { numRuns: 25 } // Reduced runs due to timing
      );
    }, 30000); // 30 second timeout

    test("successful recovery allows normal operation", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, {
            failureThreshold: 1,
            successThreshold: 1,
            timeout: 10,
            monitoringPeriod: 120000,
          });
          
          // Force circuit open
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          // Wait for timeout
          await wait(20);
          
          // Recover
          await breaker.execute(async () => "success");
          
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
          
          // Property: normal operation should work after recovery
          const result = await breaker.execute(async () => "normal operation");
          expect(result).toBe("normal operation");
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
        }),
        { numRuns: 25 } // Reduced runs due to timing
      );
    }, 30000); // 30 second timeout
  });
});
