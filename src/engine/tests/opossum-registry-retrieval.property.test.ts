import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreakerRegistry, CircuitState } from "../../utils/circuit-breaker";

/**
 * Property-based tests for CircuitBreakerRegistry retrieval methods.
 * 
 * **Feature: opossum-circuit-breaker, Property 8: Registry Retrieval Consistency**
 * **Validates: Requirements 4.3, 4.4**
 * 
 * These tests verify that:
 * - get(name) returns the same instance created via getOrCreate
 * - get(name) returns undefined for non-existent breakers
 * - getAllStats() includes stats for every registered breaker
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names - valid identifier patterns
const breakerNameArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,20}$/);

// Circuit breaker options
const circuitBreakerOptionsArb = fc.record({
  failureThreshold: fc.integer({ min: 1, max: 100 }),
  successThreshold: fc.integer({ min: 1, max: 50 }),
  timeout: fc.integer({ min: 1000, max: 300000 }),
  monitoringPeriod: fc.integer({ min: 1000, max: 600000 }),
});

// Array of unique breaker names
const uniqueNamesArb = fc.uniqueArray(breakerNameArb, { minLength: 1, maxLength: 10 });

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("CircuitBreakerRegistry retrieval property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 8: Registry Retrieval Consistency**
   * 
   * *For any* set of circuit breakers created via `getOrCreate()`, the `get(name)` method
   * SHALL return the same instance, and `getAllStats()` SHALL include stats for every
   * registered breaker.
   * 
   * **Validates: Requirements 4.3, 4.4**
   */
  describe("Property 8: Registry Retrieval Consistency", () => {
    
    test("get returns same instance as getOrCreate", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, circuitBreakerOptionsArb, async (name, options) => {
          const registry = new CircuitBreakerRegistry();
          
          const createdBreaker = registry.getOrCreate(name, options);
          const retrievedBreaker = registry.get(name);
          
          // Property: get returns the same instance that was created
          expect(retrievedBreaker).toBe(createdBreaker);
        }),
        { numRuns: 100 }
      );
    });

    test("get returns undefined for non-existent breakers", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const registry = new CircuitBreakerRegistry();
          
          // Property: get returns undefined when breaker doesn't exist
          const breaker = registry.get(name);
          expect(breaker).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    test("getAllStats includes stats for all registered breakers", async () => {
      await fc.assert(
        fc.asyncProperty(uniqueNamesArb, circuitBreakerOptionsArb, async (names, options) => {
          const registry = new CircuitBreakerRegistry();
          
          // Create breakers for all names
          for (const name of names) {
            registry.getOrCreate(name, options);
          }
          
          const allStats = registry.getAllStats();
          
          // Property: getAllStats returns stats for every registered breaker
          expect(allStats.length).toBe(names.length);
          
          // Property: each name appears exactly once in stats
          const statNames = allStats.map(s => s.name);
          for (const name of names) {
            expect(statNames).toContain(name);
          }
        }),
        { numRuns: 100 }
      );
    });

    test("getAllStats returns empty array when no breakers registered", async () => {
      const registry = new CircuitBreakerRegistry();
      
      // Property: empty registry returns empty stats array
      const allStats = registry.getAllStats();
      expect(allStats).toEqual([]);
    });

    test("getAllStats contains required fields for each breaker", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, circuitBreakerOptionsArb, async (name, options) => {
          const registry = new CircuitBreakerRegistry();
          registry.getOrCreate(name, options);
          
          const allStats = registry.getAllStats();
          
          // Property: stats contain all required fields
          expect(allStats.length).toBe(1);
          const stats = allStats[0];
          
          expect(stats.name).toBe(name);
          expect(stats.state).toBeDefined();
          expect([CircuitState.CLOSED, CircuitState.OPEN, CircuitState.HALF_OPEN]).toContain(stats.state);
          expect(typeof stats.failureCount).toBe("number");
          expect(typeof stats.successCount).toBe("number");
          expect(stats.nextAttempt === null || typeof stats.nextAttempt === "string").toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test("get after getOrCreate is consistent across multiple retrievals", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb, 
          circuitBreakerOptionsArb,
          fc.integer({ min: 2, max: 10 }),
          async (name, options, retrievalCount) => {
            const registry = new CircuitBreakerRegistry();
            const createdBreaker = registry.getOrCreate(name, options);
            
            // Property: multiple get calls return the same instance
            for (let i = 0; i < retrievalCount; i++) {
              const retrievedBreaker = registry.get(name);
              expect(retrievedBreaker).toBe(createdBreaker);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
