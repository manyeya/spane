import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { mapToOpossumOptions, CircuitBreakerOptions } from "../../utils/circuit-breaker";

/**
 * Property-based tests for Opossum options mapping.
 * 
 * **Feature: opossum-circuit-breaker, Property 1: Options Mapping Preserves Configuration**
 * **Validates: Requirements 2.1, 2.2**
 * 
 * These tests verify that:
 * - CircuitBreakerOptions are correctly mapped to Opossum options
 * - failureThreshold maps to volumeThreshold
 * - timeout maps to resetTimeout
 * - monitoringPeriod maps to rollingCountTimeout
 */

// ============================================================================
// ARBITRARIES FOR OPTIONS GENERATION
// ============================================================================

// Valid circuit breaker option values
const failureThresholdArb = fc.integer({ min: 1, max: 100 });
const successThresholdArb = fc.integer({ min: 1, max: 50 });
const timeoutArb = fc.integer({ min: 1000, max: 300000 });
const monitoringPeriodArb = fc.integer({ min: 1000, max: 600000 });

// Full circuit breaker options
const circuitBreakerOptionsArb = fc.record({
  failureThreshold: failureThresholdArb,
  successThreshold: successThresholdArb,
  timeout: timeoutArb,
  monitoringPeriod: monitoringPeriodArb,
});

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Opossum options mapping property tests", () => {
  /**
   * **Feature: opossum-circuit-breaker, Property 1: Options Mapping Preserves Configuration**
   * 
   * *For any* valid CircuitBreakerOptions object with failureThreshold, successThreshold,
   * timeout, and monitoringPeriod properties, when mapped to Opossum options, the resulting
   * configuration SHALL produce equivalent circuit breaker behavior.
   * 
   * **Validates: Requirements 2.1, 2.2**
   */
  describe("Property 1: Options Mapping Preserves Configuration", () => {
    
    test("failureThreshold maps to volumeThreshold", async () => {
      await fc.assert(
        fc.asyncProperty(circuitBreakerOptionsArb, async (options) => {
          const opossumOptions = mapToOpossumOptions(options);
          
          // Property: failureThreshold should map to volumeThreshold
          expect(opossumOptions.volumeThreshold).toBe(options.failureThreshold);
        }),
        { numRuns: 100 }
      );
    });

    test("timeout maps to resetTimeout", async () => {
      await fc.assert(
        fc.asyncProperty(circuitBreakerOptionsArb, async (options) => {
          const opossumOptions = mapToOpossumOptions(options);
          
          // Property: timeout should map to resetTimeout
          expect(opossumOptions.resetTimeout).toBe(options.timeout);
        }),
        { numRuns: 100 }
      );
    });

    test("monitoringPeriod maps to rollingCountTimeout", async () => {
      await fc.assert(
        fc.asyncProperty(circuitBreakerOptionsArb, async (options) => {
          const opossumOptions = mapToOpossumOptions(options);
          
          // Property: monitoringPeriod should map to rollingCountTimeout
          expect(opossumOptions.rollingCountTimeout).toBe(options.monitoringPeriod);
        }),
        { numRuns: 100 }
      );
    });

    test("all required Opossum options are set", async () => {
      await fc.assert(
        fc.asyncProperty(circuitBreakerOptionsArb, async (options) => {
          const opossumOptions = mapToOpossumOptions(options);
          
          // Property: all required Opossum options should be defined
          expect(opossumOptions.volumeThreshold).toBeDefined();
          expect(opossumOptions.resetTimeout).toBeDefined();
          expect(opossumOptions.rollingCountTimeout).toBeDefined();
          expect(opossumOptions.errorThresholdPercentage).toBeDefined();
          expect(opossumOptions.timeout).toBe(false); // Disabled
        }),
        { numRuns: 100 }
      );
    });

    test("errorThresholdPercentage is set to trigger on failures", async () => {
      await fc.assert(
        fc.asyncProperty(circuitBreakerOptionsArb, async (options) => {
          const opossumOptions = mapToOpossumOptions(options);
          
          // Property: errorThresholdPercentage should be set to a low value
          // to ensure circuit opens when failures reach the threshold
          expect(opossumOptions.errorThresholdPercentage).toBeGreaterThan(0);
          expect(opossumOptions.errorThresholdPercentage).toBeLessThanOrEqual(100);
        }),
        { numRuns: 100 }
      );
    });

    test("mapping is deterministic", async () => {
      await fc.assert(
        fc.asyncProperty(circuitBreakerOptionsArb, async (options) => {
          const opossumOptions1 = mapToOpossumOptions(options);
          const opossumOptions2 = mapToOpossumOptions(options);
          
          // Property: same input should produce same output
          expect(opossumOptions1.volumeThreshold).toBe(opossumOptions2.volumeThreshold);
          expect(opossumOptions1.resetTimeout).toBe(opossumOptions2.resetTimeout);
          expect(opossumOptions1.rollingCountTimeout).toBe(opossumOptions2.rollingCountTimeout);
          expect(opossumOptions1.errorThresholdPercentage).toBe(opossumOptions2.errorThresholdPercentage);
        }),
        { numRuns: 100 }
      );
    });
  });
});
