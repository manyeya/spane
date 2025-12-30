import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreaker, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for circuit breaker execute pass-through.
 * 
 * **Feature: opossum-circuit-breaker, Property 2: Execute Pass-Through**
 * **Validates: Requirements 3.1**
 * 
 * These tests verify that:
 * - For any async function that succeeds, when executed through a CLOSED circuit breaker,
 *   the circuit breaker returns the exact same result as calling the function directly.
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names
const breakerNameArb = fc.stringMatching(/^[a-z]+:[a-z0-9.-]+$/);

// Default options for testing
const defaultOptions = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  monitoringPeriod: 120000,
};

// Various return value types
const returnValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.integer()),
  fc.record({ key: fc.string(), value: fc.integer() })
);

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Opossum execute pass-through property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 2: Execute Pass-Through**
   * 
   * *For any* async function that succeeds, when executed through a CLOSED circuit breaker,
   * the circuit breaker SHALL return the exact same result as calling the function directly.
   * 
   * **Validates: Requirements 3.1**
   */
  describe("Property 2: Execute Pass-Through", () => {
    
    test("successful function returns exact same result through circuit breaker", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, returnValueArb, async (name, expectedValue) => {
          const breaker = new CircuitBreaker(name, defaultOptions);
          
          // Verify circuit is closed
          expect(breaker.getState()).toBe(CircuitState.CLOSED);
          
          // Create a function that returns the expected value
          const fn = async () => expectedValue;
          
          // Execute through circuit breaker
          const result = await breaker.execute(fn);
          
          // Property: result should be exactly the same as expected value
          expect(result).toEqual(expectedValue);
        }),
        { numRuns: 100 }
      );
    });

    test("function is actually called when circuit is closed", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, defaultOptions);
          let callCount = 0;
          
          const fn = async () => {
            callCount++;
            return "result";
          };
          
          // Execute through circuit breaker
          await breaker.execute(fn);
          
          // Property: function should have been called exactly once
          expect(callCount).toBe(1);
        }),
        { numRuns: 100 }
      );
    });

    test("multiple successful executions all pass through", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          fc.array(returnValueArb, { minLength: 1, maxLength: 10 }),
          async (name, values) => {
            const breaker = new CircuitBreaker(name, defaultOptions);
            
            for (const expectedValue of values) {
              const fn = async () => expectedValue;
              const result = await breaker.execute(fn);
              
              // Property: each result should match expected value
              expect(result).toEqual(expectedValue);
            }
            
            // Property: circuit should still be closed after all successes
            expect(breaker.getState()).toBe(CircuitState.CLOSED);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("async function with delay still returns correct result", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb,
          fc.integer({ min: 1, max: 100 }),
          async (name, expectedValue) => {
            const breaker = new CircuitBreaker(name, defaultOptions);
            
            // Create a function with a small delay
            const fn = async () => {
              await new Promise(resolve => setTimeout(resolve, 5));
              return expectedValue;
            };
            
            const result = await breaker.execute(fn);
            
            // Property: result should still be correct after delay
            expect(result).toBe(expectedValue);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("circuit breaker preserves object reference equality", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const breaker = new CircuitBreaker(name, defaultOptions);
          const expectedObject = { id: 1, data: "test" };
          
          const fn = async () => expectedObject;
          const result = await breaker.execute(fn);
          
          // Property: should return the exact same object reference
          expect(result).toBe(expectedObject);
        }),
        { numRuns: 100 }
      );
    });
  });
});
