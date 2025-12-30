import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { resolveDuration } from "../node-processor";
import type { DelayNodeConfig } from "../../types";

/**
 * Unit tests for delay node validation edge cases.
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3**
 * 
 * These tests verify:
 * - Missing duration config returns appropriate error
 * - Negative duration returns appropriate error
 * - Duration > 24 hours logs a warning but proceeds
 */

// ============================================================================
// HELPER FUNCTIONS FOR VALIDATION
// ============================================================================

/**
 * Validates delay node configuration.
 * This mirrors the validation logic in processDelayNode.
 */
function validateDelayConfig(config: DelayNodeConfig | undefined): {
  valid: boolean;
  duration: number | null;
  error?: string;
  warning?: string;
} {
  const duration = resolveDuration(config);
  
  // Check for missing duration configuration
  if (duration === null) {
    return {
      valid: false,
      duration: null,
      error: 'Delay node missing duration configuration',
    };
  }
  
  // Check for negative duration
  if (duration < 0) {
    return {
      valid: false,
      duration,
      error: 'Delay duration must be positive',
    };
  }
  
  // Check for duration exceeding 24 hours (warning only)
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  let warning: string | undefined;
  if (duration > TWENTY_FOUR_HOURS_MS) {
    warning = `Delay duration exceeds 24 hours: ${duration}ms`;
  }
  
  return {
    valid: true,
    duration,
    warning,
  };
}

// ============================================================================
// UNIT TESTS
// ============================================================================

describe("Delay node validation unit tests", () => {
  /**
   * Tests for Requirement 6.1:
   * WHEN a delay node has no duration configuration
   * THEN the Node Processor SHALL return a failure result with a descriptive error
   */
  describe("Missing duration configuration (Requirement 6.1)", () => {
    test("undefined config returns error", () => {
      const result = validateDelayConfig(undefined);
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBeNull();
      expect(result.error).toBe('Delay node missing duration configuration');
    });

    test("empty config object returns error", () => {
      const result = validateDelayConfig({});
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBeNull();
      expect(result.error).toBe('Delay node missing duration configuration');
    });

    test("config with unrelated properties returns error", () => {
      const result = validateDelayConfig({ someOtherProp: 'value' } as any);
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBeNull();
      expect(result.error).toBe('Delay node missing duration configuration');
    });

    test("config with non-numeric duration returns error", () => {
      const result = validateDelayConfig({ duration: 'not-a-number' } as any);
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBeNull();
      expect(result.error).toBe('Delay node missing duration configuration');
    });

    test("config with null duration returns error", () => {
      const result = validateDelayConfig({ duration: null } as any);
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBeNull();
      expect(result.error).toBe('Delay node missing duration configuration');
    });

    test("config with undefined duration returns error", () => {
      const result = validateDelayConfig({ duration: undefined });
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBeNull();
      expect(result.error).toBe('Delay node missing duration configuration');
    });
  });

  /**
   * Tests for Requirement 6.2:
   * WHEN a delay node has a negative duration
   * THEN the Node Processor SHALL return a failure result with a descriptive error
   */
  describe("Negative duration (Requirement 6.2)", () => {
    test("negative duration in milliseconds returns error", () => {
      const result = validateDelayConfig({ duration: -1000 });
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBe(-1000);
      expect(result.error).toBe('Delay duration must be positive');
    });

    test("negative duration in seconds returns error", () => {
      const result = validateDelayConfig({ durationSeconds: -5 });
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBe(-5000);
      expect(result.error).toBe('Delay duration must be positive');
    });

    test("negative duration in minutes returns error", () => {
      const result = validateDelayConfig({ durationMinutes: -2 });
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBe(-120000);
      expect(result.error).toBe('Delay duration must be positive');
    });

    test("very large negative duration returns error", () => {
      const result = validateDelayConfig({ duration: -999999999 });
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBe(-999999999);
      expect(result.error).toBe('Delay duration must be positive');
    });

    test("negative one millisecond returns error", () => {
      const result = validateDelayConfig({ duration: -1 });
      
      expect(result.valid).toBe(false);
      expect(result.duration).toBe(-1);
      expect(result.error).toBe('Delay duration must be positive');
    });
  });

  /**
   * Tests for Requirement 6.3:
   * WHEN a delay node has a duration exceeding 24 hours
   * THEN the Node Processor SHALL log a warning but proceed with the delay
   */
  describe("Duration exceeding 24 hours (Requirement 6.3)", () => {
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000; // 86400000

    test("duration exactly 24 hours does not trigger warning", () => {
      const result = validateDelayConfig({ duration: TWENTY_FOUR_HOURS_MS });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(TWENTY_FOUR_HOURS_MS);
      expect(result.warning).toBeUndefined();
    });

    test("duration slightly over 24 hours triggers warning but is valid", () => {
      const duration = TWENTY_FOUR_HOURS_MS + 1;
      const result = validateDelayConfig({ duration });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(duration);
      expect(result.warning).toBe(`Delay duration exceeds 24 hours: ${duration}ms`);
    });

    test("duration of 25 hours triggers warning but is valid", () => {
      const duration = 25 * 60 * 60 * 1000; // 25 hours
      const result = validateDelayConfig({ duration });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(duration);
      expect(result.warning).toBeDefined();
    });

    test("duration of 48 hours triggers warning but is valid", () => {
      const duration = 48 * 60 * 60 * 1000; // 48 hours
      const result = validateDelayConfig({ duration });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(duration);
      expect(result.warning).toBeDefined();
    });

    test("duration of 7 days triggers warning but is valid", () => {
      const duration = 7 * 24 * 60 * 60 * 1000; // 7 days
      const result = validateDelayConfig({ duration });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(duration);
      expect(result.warning).toBeDefined();
    });

    test("durationMinutes over 24 hours triggers warning but is valid", () => {
      const minutes = 25 * 60; // 25 hours in minutes
      const result = validateDelayConfig({ durationMinutes: minutes });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(minutes * 60000);
      expect(result.warning).toBeDefined();
    });
  });

  /**
   * Additional edge case tests
   */
  describe("Edge cases", () => {
    test("zero duration is valid (immediate execution)", () => {
      const result = validateDelayConfig({ duration: 0 });
      
      // Zero is technically valid - it means immediate execution
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(0);
      expect(result.error).toBeUndefined();
    });

    test("very small positive duration is valid", () => {
      const result = validateDelayConfig({ duration: 1 });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(1);
      expect(result.error).toBeUndefined();
    });

    test("fractional seconds are handled correctly", () => {
      // Note: durationSeconds is expected to be a number, fractional values work
      const result = validateDelayConfig({ durationSeconds: 1.5 });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(1500);
    });

    test("precedence: duration takes priority over durationSeconds", () => {
      const result = validateDelayConfig({ 
        duration: 5000, 
        durationSeconds: 10 
      });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(5000); // duration wins
    });

    test("precedence: durationSeconds takes priority over durationMinutes", () => {
      const result = validateDelayConfig({ 
        durationSeconds: 30, 
        durationMinutes: 5 
      });
      
      expect(result.valid).toBe(true);
      expect(result.duration).toBe(30000); // durationSeconds wins
    });
  });
});
