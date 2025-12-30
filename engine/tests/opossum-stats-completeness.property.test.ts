import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreaker, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for circuit breaker stats completeness.
 * 
 * **Feature: opossum-circuit-breaker, Property 5: Stats Completeness**
 * **Validates: Requirements 3.5, 3.6**
 * 
 * These tests verify that:
 * - For any circuit breaker instance, getStats() returns an object containing:
 *   name (string), state (CircuitState), failureCount (number), successCount (number),
 *   and nextAttempt (string | null).
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names
const breakerNameArb = fc.stringMatching(/^[a-z]+:[a-z0-9.-]+$/);

// Circuit breaker options
const optionsArb = fc.record({
  failureThreshold: fc.integer({ min: 1, max: 10 }),
  successThreshold: fc.integer({ min: 1, max: 5 }),
  timeout: fc.integer({ min: 1000, max: 60000 }),
  monitoringPeriod: fc.integer({ min: 1000, max: 120000 }),
});

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Opossum stats completeness property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 5: Stats Completeness**
   * 
   * *For any* circuit breaker instance, getStats() SHALL return an object containing:
   * name (string), state (CircuitState), failureCount (number), successCount (number),
   * and nextAttempt (string | null).
   * 
   * **Validates: Requirements 3.5, 3.6**
   */
  describe("Property 5: Stats Completeness", () => {
    
    test("getStats returns all required fields for new circuit breaker", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, optionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          const stats = breaker.getStats();
          
          // Property: stats should have all required fields
          expect(stats).toHaveProperty('name');
          expect(stats).toHaveProperty('state');
          expect(stats).toHaveProperty('failureCount');
          expect(stats).toHaveProperty('successCount');
          expect(stats).toHaveProperty('nextAttempt');
          
          // Property: field types should be correct
          expect(typeof stats.name).toBe('string');
          expect(typeof stats.state).toBe('string');
          expect(typeof stats.failureCount).toBe('number');
          expect(typeof stats.successCount).toBe('number');
          expect(stats.nextAttempt === null || typeof stats.nextAttempt === 'string').toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test("stats name matches constructor name", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, optionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          const stats = breaker.getStats();
          
          // Property: stats name should match the name passed to constructor
          expect(stats.name).toBe(name);
        }),
        { numRuns: 100 }
      );
    });

    test("stats state is valid CircuitState value", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, optionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          const stats = breaker.getStats();
          
          // Property: state should be one of the valid CircuitState values
          const validStates = [CircuitState.CLOSED, CircuitState.OPEN, CircuitState.HALF_OPEN];
          expect(validStates).toContain(stats.state);
        }),
        { numRuns: 100 }
      );
    });

    test("stats counts are non-negative", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, optionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          const stats = breaker.getStats();
          
          // Property: counts should be non-negative
          expect(stats.failureCount).toBeGreaterThanOrEqual(0);
          expect(stats.successCount).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 }
      );
    });

    test("new circuit breaker has zero counts and CLOSED state", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, optionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          const stats = breaker.getStats();
          
          // Property: new breaker should be CLOSED with zero counts
          expect(stats.state).toBe(CircuitState.CLOSED);
          expect(stats.failureCount).toBe(0);
          expect(stats.successCount).toBe(0);
          expect(stats.nextAttempt).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    test("nextAttempt is null when circuit is CLOSED", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, optionsArb, async (name, options) => {
          const breaker = new CircuitBreaker(name, options);
          
          // Execute some successful operations
          for (let i = 0; i < 3; i++) {
            await breaker.execute(async () => "success");
          }
          
          const stats = breaker.getStats();
          
          // Property: nextAttempt should be null when CLOSED
          expect(stats.state).toBe(CircuitState.CLOSED);
          expect(stats.nextAttempt).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    test("nextAttempt is ISO string when circuit is OPEN", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, {
            failureThreshold: 1,
            successThreshold: 1,
            timeout: 60000,
            monitoringPeriod: 120000,
          });
          
          // Force circuit open
          try {
            await breaker.execute(async () => { throw new Error("fail"); });
          } catch (e) {
            // Expected
          }
          
          const stats = breaker.getStats();
          
          // Property: nextAttempt should be an ISO date string when OPEN
          expect(stats.state).toBe(CircuitState.OPEN);
          expect(stats.nextAttempt).not.toBeNull();
          expect(typeof stats.nextAttempt).toBe('string');
          
          // Verify it's a valid ISO date string
          const date = new Date(stats.nextAttempt!);
          expect(date.getTime()).not.toBeNaN();
        }),
        { numRuns: 100 }
      );
    });

    test("stats reflect actual execution counts", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          fc.integer({ min: 1, max: 5 }),
          async (name, successCount) => {
            const breaker = new CircuitBreaker(name, {
              failureThreshold: 10, // High threshold to avoid opening
              successThreshold: 2,
              timeout: 60000,
              monitoringPeriod: 120000,
            });
            
            // Execute some successful operations
            for (let i = 0; i < successCount; i++) {
              await breaker.execute(async () => "success");
            }
            
            const stats = breaker.getStats();
            
            // Property: success count should match executions
            expect(stats.successCount).toBe(successCount);
            expect(stats.failureCount).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
