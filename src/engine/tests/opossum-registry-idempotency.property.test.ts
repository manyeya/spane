import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { CircuitBreakerRegistry, CircuitBreakerOptions } from "../../utils/circuit-breaker";

/**
 * Property-based tests for CircuitBreakerRegistry idempotency.
 * 
 * **Feature: opossum-circuit-breaker, Property 7: Registry Idempotency**
 * **Validates: Requirements 4.1, 4.2**
 * 
 * These tests verify that:
 * - Calling getOrCreate with the same name returns the same instance
 * - Subsequent calls with different options ignore the new options
 */

// ============================================================================
// ARBITRARIES FOR TEST DATA GENERATION
// ============================================================================

// Circuit breaker names - valid identifier patterns
const breakerNameArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,30}$/);

// Circuit breaker options
const circuitBreakerOptionsArb = fc.record({
  failureThreshold: fc.integer({ min: 1, max: 100 }),
  successThreshold: fc.integer({ min: 1, max: 50 }),
  timeout: fc.integer({ min: 1000, max: 300000 }),
  monitoringPeriod: fc.integer({ min: 1000, max: 600000 }),
});

// Different options for testing that subsequent options are ignored
const differentOptionsArb = fc.record({
  failureThreshold: fc.integer({ min: 101, max: 200 }),
  successThreshold: fc.integer({ min: 51, max: 100 }),
  timeout: fc.integer({ min: 300001, max: 600000 }),
  monitoringPeriod: fc.integer({ min: 600001, max: 1200000 }),
});

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("CircuitBreakerRegistry idempotency property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 7: Registry Idempotency**
   * 
   * *For any* circuit breaker name, calling `getOrCreate(name, options)` multiple times
   * SHALL return the same circuit breaker instance, and subsequent calls SHALL ignore
   * the provided options.
   * 
   * **Validates: Requirements 4.1, 4.2**
   */
  describe("Property 7: Registry Idempotency", () => {
    
    test("getOrCreate returns same instance for same name", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, circuitBreakerOptionsArb, async (name, options) => {
          const registry = new CircuitBreakerRegistry();
          
          const breaker1 = registry.getOrCreate(name, options);
          const breaker2 = registry.getOrCreate(name, options);
          
          // Property: same name returns same instance (reference equality)
          expect(breaker1).toBe(breaker2);
        }),
        { numRuns: 100 }
      );
    });

    test("subsequent calls with different options return same instance", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb, 
          circuitBreakerOptionsArb, 
          differentOptionsArb, 
          async (name, options1, options2) => {
            const registry = new CircuitBreakerRegistry();
            
            const breaker1 = registry.getOrCreate(name, options1);
            const breaker2 = registry.getOrCreate(name, options2);
            
            // Property: same name returns same instance even with different options
            expect(breaker1).toBe(breaker2);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("multiple calls return same instance regardless of call count", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb, 
          circuitBreakerOptionsArb,
          fc.integer({ min: 2, max: 10 }),
          async (name, options, callCount) => {
            const registry = new CircuitBreakerRegistry();
            
            const firstBreaker = registry.getOrCreate(name, options);
            
            // Call getOrCreate multiple times
            for (let i = 0; i < callCount; i++) {
              const breaker = registry.getOrCreate(name, options);
              // Property: every call returns the same instance
              expect(breaker).toBe(firstBreaker);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("different names create different instances", async () => {
      await fc.assert(
        fc.asyncProperty(
          breakerNameArb, 
          breakerNameArb.filter(n => n.length > 0),
          circuitBreakerOptionsArb,
          async (name1, name2Suffix, options) => {
            // Ensure names are different
            const name2 = name1 + name2Suffix;
            
            const registry = new CircuitBreakerRegistry();
            
            const breaker1 = registry.getOrCreate(name1, options);
            const breaker2 = registry.getOrCreate(name2, options);
            
            // Property: different names create different instances
            expect(breaker1).not.toBe(breaker2);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("getOrCreate uses default options when none provided", async () => {
      await fc.assert(
        fc.asyncProperty(breakerNameArb, async (name) => {
          const registry = new CircuitBreakerRegistry();
          
          // Create without options - should use defaults
          const breaker = registry.getOrCreate(name);
          
          // Property: breaker is created successfully with defaults
          expect(breaker).toBeDefined();
          expect(breaker.getStats().name).toBe(name);
        }),
        { numRuns: 100 }
      );
    });
  });
});
