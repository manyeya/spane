import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { getCircuitBreakerOptions, DEFAULT_CIRCUIT_BREAKER_OPTIONS } from "../node-processor";

/**
 * Property-based tests for circuit breaker options configuration.
 * 
 * **Feature: circuit-breaker-integration, Property 5: Circuit breaker options are applied from config**
 * **Validates: Requirements 4.1, 4.2**
 * 
 * These tests verify that:
 * - Node configuration with circuitBreaker options are properly applied
 * - Missing options fall back to defaults
 * - Partial options are merged with defaults
 */

// ============================================================================
// ARBITRARIES FOR CONFIG GENERATION
// ============================================================================

// Valid circuit breaker option values
const failureThresholdArb = fc.integer({ min: 1, max: 100 });
const successThresholdArb = fc.integer({ min: 1, max: 50 });
const timeoutArb = fc.integer({ min: 1000, max: 300000 });
const monitoringPeriodArb = fc.integer({ min: 1000, max: 600000 });

// Full circuit breaker options
const fullCircuitBreakerOptionsArb = fc.record({
  failureThreshold: failureThresholdArb,
  successThreshold: successThresholdArb,
  timeout: timeoutArb,
  monitoringPeriod: monitoringPeriodArb,
});

// Partial circuit breaker options (some fields may be missing)
const partialCircuitBreakerOptionsArb = fc.record({
  failureThreshold: fc.option(failureThresholdArb, { nil: undefined }),
  successThreshold: fc.option(successThresholdArb, { nil: undefined }),
  timeout: fc.option(timeoutArb, { nil: undefined }),
  monitoringPeriod: fc.option(monitoringPeriodArb, { nil: undefined }),
}).map(opts => {
  // Remove undefined values to simulate partial config
  const result: Record<string, number> = {};
  if (opts.failureThreshold !== undefined) result.failureThreshold = opts.failureThreshold;
  if (opts.successThreshold !== undefined) result.successThreshold = opts.successThreshold;
  if (opts.timeout !== undefined) result.timeout = opts.timeout;
  if (opts.monitoringPeriod !== undefined) result.monitoringPeriod = opts.monitoringPeriod;
  return result;
});

// Node config with circuit breaker options
const nodeConfigWithCBOptionsArb = fullCircuitBreakerOptionsArb.map(cbOptions => ({
  circuitBreaker: cbOptions,
  // Other node config fields
  url: 'https://example.com',
}));

// Node config with partial circuit breaker options
const nodeConfigWithPartialCBOptionsArb = partialCircuitBreakerOptionsArb.map(cbOptions => ({
  circuitBreaker: cbOptions,
}));

// Node config without circuit breaker options
const nodeConfigWithoutCBOptionsArb = fc.oneof(
  fc.constant({}),
  fc.constant({ url: 'https://example.com' }),
  fc.constant({ path: '/webhook' }),
  fc.constant(null),
  fc.constant(undefined)
);

// Invalid circuit breaker option values (non-numbers)
const invalidOptionValuesArb = fc.oneof(
  fc.constant('string'),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant({}),
  fc.constant([]),
  fc.constant(true)
);

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Circuit breaker options property tests", () => {
  /**
   * **Feature: circuit-breaker-integration, Property 5: Circuit breaker options are applied from config**
   * 
   * *For any* node configuration containing circuitBreaker options, when a circuit 
   * breaker is created, those options SHALL be used instead of defaults.
   * 
   * **Validates: Requirements 4.1, 4.2**
   */
  describe("Property 5: Circuit breaker options are applied from config", () => {
    
    test("full circuit breaker options from config are applied", async () => {
      await fc.assert(
        fc.asyncProperty(nodeConfigWithCBOptionsArb, async (nodeConfig) => {
          const options = getCircuitBreakerOptions(nodeConfig);
          
          // Property: all options from config should be applied
          expect(options.failureThreshold).toBe(nodeConfig.circuitBreaker.failureThreshold);
          expect(options.successThreshold).toBe(nodeConfig.circuitBreaker.successThreshold);
          expect(options.timeout).toBe(nodeConfig.circuitBreaker.timeout);
          expect(options.monitoringPeriod).toBe(nodeConfig.circuitBreaker.monitoringPeriod);
        }),
        { numRuns: 100 }
      );
    });

    test("partial circuit breaker options are merged with defaults", async () => {
      await fc.assert(
        fc.asyncProperty(nodeConfigWithPartialCBOptionsArb, async (nodeConfig) => {
          const options = getCircuitBreakerOptions(nodeConfig);
          const cbConfig = nodeConfig.circuitBreaker;
          
          // Property: provided options should be used, missing ones should use defaults
          if (cbConfig.failureThreshold !== undefined) {
            expect(options.failureThreshold).toBe(cbConfig.failureThreshold);
          } else {
            expect(options.failureThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.failureThreshold);
          }
          
          if (cbConfig.successThreshold !== undefined) {
            expect(options.successThreshold).toBe(cbConfig.successThreshold);
          } else {
            expect(options.successThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.successThreshold);
          }
          
          if (cbConfig.timeout !== undefined) {
            expect(options.timeout).toBe(cbConfig.timeout);
          } else {
            expect(options.timeout).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeout);
          }
          
          if (cbConfig.monitoringPeriod !== undefined) {
            expect(options.monitoringPeriod).toBe(cbConfig.monitoringPeriod);
          } else {
            expect(options.monitoringPeriod).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.monitoringPeriod);
          }
        }),
        { numRuns: 100 }
      );
    });

    test("missing circuit breaker config uses all defaults", async () => {
      await fc.assert(
        fc.asyncProperty(nodeConfigWithoutCBOptionsArb, async (nodeConfig) => {
          const options = getCircuitBreakerOptions(nodeConfig);
          
          // Property: all options should be defaults when no circuitBreaker config
          expect(options.failureThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.failureThreshold);
          expect(options.successThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.successThreshold);
          expect(options.timeout).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeout);
          expect(options.monitoringPeriod).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.monitoringPeriod);
        }),
        { numRuns: 100 }
      );
    });

    test("invalid option values fall back to defaults", async () => {
      await fc.assert(
        fc.asyncProperty(
          invalidOptionValuesArb,
          invalidOptionValuesArb,
          invalidOptionValuesArb,
          invalidOptionValuesArb,
          async (ft, st, to, mp) => {
            const nodeConfig = {
              circuitBreaker: {
                failureThreshold: ft,
                successThreshold: st,
                timeout: to,
                monitoringPeriod: mp,
              }
            };
            
            const options = getCircuitBreakerOptions(nodeConfig);
            
            // Property: invalid (non-number) values should fall back to defaults
            expect(options.failureThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.failureThreshold);
            expect(options.successThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.successThreshold);
            expect(options.timeout).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeout);
            expect(options.monitoringPeriod).toBe(DEFAULT_CIRCUIT_BREAKER_OPTIONS.monitoringPeriod);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("returned options always have all required fields", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            nodeConfigWithCBOptionsArb,
            nodeConfigWithPartialCBOptionsArb,
            nodeConfigWithoutCBOptionsArb
          ),
          async (nodeConfig) => {
            const options = getCircuitBreakerOptions(nodeConfig);
            
            // Property: returned options should always have all required fields
            expect(typeof options.failureThreshold).toBe('number');
            expect(typeof options.successThreshold).toBe('number');
            expect(typeof options.timeout).toBe('number');
            expect(typeof options.monitoringPeriod).toBe('number');
            
            // Property: all values should be positive
            expect(options.failureThreshold).toBeGreaterThan(0);
            expect(options.successThreshold).toBeGreaterThan(0);
            expect(options.timeout).toBeGreaterThan(0);
            expect(options.monitoringPeriod).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("default options match expected values", () => {
      // Property: default options should match the documented defaults
      expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.failureThreshold).toBe(5);
      expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.successThreshold).toBe(2);
      expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeout).toBe(60000);
      expect(DEFAULT_CIRCUIT_BREAKER_OPTIONS.monitoringPeriod).toBe(120000);
    });
  });
});
