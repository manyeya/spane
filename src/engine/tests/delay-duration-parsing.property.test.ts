import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { resolveDuration } from "../node-processor";
import type { DelayNodeConfig } from "../../types";

/**
 * Property-based tests for delay node duration parsing.
 * 
 * **Feature: delay-node, Property 2: Duration parsing precedence**
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 * 
 * These tests verify that:
 * - duration (ms) has highest priority
 * - durationSeconds is converted correctly (×1000)
 * - durationMinutes is converted correctly (×60000)
 * - Precedence order: duration > durationSeconds > durationMinutes
 * - Missing config returns null
 */

// ============================================================================
// ARBITRARIES FOR CONFIG GENERATION
// ============================================================================

// Valid duration values (positive numbers)
const positiveDurationArb = fc.integer({ min: 1, max: 86400000 }); // Up to 24 hours in ms
const positiveSecondsArb = fc.integer({ min: 1, max: 86400 }); // Up to 24 hours in seconds
const positiveMinutesArb = fc.integer({ min: 1, max: 1440 }); // Up to 24 hours in minutes

// Config with only duration (ms)
const durationOnlyConfigArb = positiveDurationArb.map(duration => ({
  duration,
}));

// Config with only durationSeconds
const durationSecondsOnlyConfigArb = positiveSecondsArb.map(durationSeconds => ({
  durationSeconds,
}));

// Config with only durationMinutes
const durationMinutesOnlyConfigArb = positiveMinutesArb.map(durationMinutes => ({
  durationMinutes,
}));

// Config with all three duration properties
const allDurationsConfigArb = fc.record({
  duration: positiveDurationArb,
  durationSeconds: positiveSecondsArb,
  durationMinutes: positiveMinutesArb,
});

// Config with duration and durationSeconds (no minutes)
const durationAndSecondsConfigArb = fc.record({
  duration: positiveDurationArb,
  durationSeconds: positiveSecondsArb,
});

// Config with duration and durationMinutes (no seconds)
const durationAndMinutesConfigArb = fc.record({
  duration: positiveDurationArb,
  durationMinutes: positiveMinutesArb,
});

// Config with durationSeconds and durationMinutes (no ms)
const secondsAndMinutesConfigArb = fc.record({
  durationSeconds: positiveSecondsArb,
  durationMinutes: positiveMinutesArb,
});

// Empty or missing config
const emptyConfigArb = fc.oneof(
  fc.constant({}),
  fc.constant(undefined),
);

// Config with non-numeric values (should be treated as missing)
const invalidDurationValuesArb = fc.oneof(
  fc.constant({ duration: "1000" }),
  fc.constant({ duration: null }),
  fc.constant({ durationSeconds: "60" }),
  fc.constant({ durationMinutes: [] }),
  fc.constant({ duration: {} }),
);

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Delay duration parsing property tests", () => {
  /**
   * **Feature: delay-node, Property 2: Duration parsing precedence**
   * 
   * *For any* delay node configuration containing one or more duration properties,
   * the resolved duration should follow the precedence order: 
   * duration (ms) > durationSeconds > durationMinutes, with correct unit conversion applied.
   * 
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   */
  describe("Property 2: Duration parsing precedence", () => {
    
    test("duration (ms) is returned directly when present", async () => {
      await fc.assert(
        fc.asyncProperty(durationOnlyConfigArb, async (config) => {
          const result = resolveDuration(config);
          
          // Property: duration in ms should be returned as-is
          expect(result).toBe(config.duration);
        }),
        { numRuns: 100 }
      );
    });

    test("durationSeconds is converted to milliseconds", async () => {
      await fc.assert(
        fc.asyncProperty(durationSecondsOnlyConfigArb, async (config) => {
          const result = resolveDuration(config);
          
          // Property: durationSeconds should be multiplied by 1000
          expect(result).toBe(config.durationSeconds * 1000);
        }),
        { numRuns: 100 }
      );
    });

    test("durationMinutes is converted to milliseconds", async () => {
      await fc.assert(
        fc.asyncProperty(durationMinutesOnlyConfigArb, async (config) => {
          const result = resolveDuration(config);
          
          // Property: durationMinutes should be multiplied by 60000
          expect(result).toBe(config.durationMinutes * 60000);
        }),
        { numRuns: 100 }
      );
    });

    test("duration takes precedence over durationSeconds and durationMinutes", async () => {
      await fc.assert(
        fc.asyncProperty(allDurationsConfigArb, async (config) => {
          const result = resolveDuration(config);
          
          // Property: duration (ms) should always win when all three are present
          expect(result).toBe(config.duration);
        }),
        { numRuns: 100 }
      );
    });

    test("duration takes precedence over durationSeconds", async () => {
      await fc.assert(
        fc.asyncProperty(durationAndSecondsConfigArb, async (config) => {
          const result = resolveDuration(config);
          
          // Property: duration (ms) should win over durationSeconds
          expect(result).toBe(config.duration);
        }),
        { numRuns: 100 }
      );
    });

    test("duration takes precedence over durationMinutes", async () => {
      await fc.assert(
        fc.asyncProperty(durationAndMinutesConfigArb, async (config) => {
          const result = resolveDuration(config);
          
          // Property: duration (ms) should win over durationMinutes
          expect(result).toBe(config.duration);
        }),
        { numRuns: 100 }
      );
    });

    test("durationSeconds takes precedence over durationMinutes", async () => {
      await fc.assert(
        fc.asyncProperty(secondsAndMinutesConfigArb, async (config) => {
          const result = resolveDuration(config);
          
          // Property: durationSeconds should win over durationMinutes
          expect(result).toBe(config.durationSeconds * 1000);
        }),
        { numRuns: 100 }
      );
    });

    test("missing or empty config returns null", async () => {
      await fc.assert(
        fc.asyncProperty(emptyConfigArb, async (config) => {
          const result = resolveDuration(config as DelayNodeConfig | undefined);
          
          // Property: no valid duration config should return null
          expect(result).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    test("non-numeric duration values are treated as missing", async () => {
      await fc.assert(
        fc.asyncProperty(invalidDurationValuesArb, async (config) => {
          const result = resolveDuration(config as DelayNodeConfig);
          
          // Property: non-numeric values should be ignored, returning null
          expect(result).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    test("resolved duration is always positive when valid config provided", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            durationOnlyConfigArb,
            durationSecondsOnlyConfigArb,
            durationMinutesOnlyConfigArb,
            allDurationsConfigArb
          ),
          async (config) => {
            const result = resolveDuration(config);
            
            // Property: valid configs should always produce positive durations
            expect(result).not.toBeNull();
            expect(result).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
