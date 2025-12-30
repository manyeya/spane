import { describe, test, expect, beforeEach } from "bun:test";
import * as fc from "fast-check";
import { NodeRegistry, DEFAULT_EXTERNAL_NODE_EXTRACTORS } from "../registry";

/**
 * Property-based tests for external node detection in circuit breaker integration.
 * 
 * **Feature: circuit-breaker-integration, Property 1: External nodes use circuit breaker**
 * **Feature: circuit-breaker-integration, Property 2: Non-external nodes bypass circuit breaker**
 * **Validates: Requirements 1.2, 1.3**
 * 
 * These tests verify that:
 * - External node types (http, webhook, database, email) are correctly identified
 * - Non-external node types are correctly excluded from circuit breaker protection
 */

// ============================================================================
// ARBITRARIES FOR NODE TYPE GENERATION
// ============================================================================

// External node types that should use circuit breaker
const externalNodeTypeArb = fc.constantFrom('http', 'webhook', 'database', 'email');

// Non-external node types that should bypass circuit breaker
const nonExternalNodeTypeArb = fc.constantFrom(
  'action',
  'condition',
  'trigger',
  'transform',
  'delay',
  'sub-workflow',
  'merge',
  'split',
  'loop',
  'switch',
  'script',
  'log',
  'notification',
  'custom'
);

// Default external node types set
const DEFAULT_EXTERNAL_TYPES = new Set(Object.keys(DEFAULT_EXTERNAL_NODE_EXTRACTORS));

// Random string node types (excluding external types)
const randomNonExternalNodeTypeArb = fc.string({ minLength: 1, maxLength: 30 })
  .filter(s => !DEFAULT_EXTERNAL_TYPES.has(s));

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Circuit breaker external node detection property tests", () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.registerDefaultExternalNodes();
  });

  /**
   * **Feature: circuit-breaker-integration, Property 1: External nodes use circuit breaker**
   * 
   * *For any* node of type http, webhook, database, or email, when executed by 
   * NodeProcessor with a CircuitBreakerRegistry, the execution SHALL be wrapped 
   * by a circuit breaker call.
   * 
   * **Validates: Requirements 1.2**
   */
  describe("Property 1: External nodes use circuit breaker", () => {
    test("all external node types are identified as external", async () => {
      await fc.assert(
        fc.asyncProperty(externalNodeTypeArb, async (nodeType) => {
          // Property: external node types should return true
          expect(registry.isExternalNode(nodeType)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test("external node types set contains exactly http, webhook, database, email", () => {
      // Property: the set of external node types is exactly as specified
      expect(DEFAULT_EXTERNAL_TYPES.size).toBe(4);
      expect(registry.isExternalNode('http')).toBe(true);
      expect(registry.isExternalNode('webhook')).toBe(true);
      expect(registry.isExternalNode('database')).toBe(true);
      expect(registry.isExternalNode('email')).toBe(true);
    });
  });

  /**
   * **Feature: circuit-breaker-integration, Property 2: Non-external nodes bypass circuit breaker**
   * 
   * *For any* node of a type NOT in {http, webhook, database, email}, when executed 
   * by NodeProcessor, the execution SHALL NOT invoke any circuit breaker.
   * 
   * **Validates: Requirements 1.3**
   */
  describe("Property 2: Non-external nodes bypass circuit breaker", () => {
    test("common non-external node types are not identified as external", async () => {
      await fc.assert(
        fc.asyncProperty(nonExternalNodeTypeArb, async (nodeType) => {
          // Property: non-external node types should return false
          expect(registry.isExternalNode(nodeType)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test("random non-external node types are not identified as external", async () => {
      await fc.assert(
        fc.asyncProperty(randomNonExternalNodeTypeArb, async (nodeType) => {
          // Property: any string not in the external set should return false
          expect(registry.isExternalNode(nodeType)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test("empty string is not external", () => {
      expect(registry.isExternalNode('')).toBe(false);
    });

    test("case sensitivity is enforced", async () => {
      // Property: node types are case-sensitive
      const upperCaseExternalTypes = ['HTTP', 'WEBHOOK', 'DATABASE', 'EMAIL'];
      const mixedCaseExternalTypes = ['Http', 'Webhook', 'Database', 'Email'];
      
      for (const nodeType of [...upperCaseExternalTypes, ...mixedCaseExternalTypes]) {
        expect(registry.isExternalNode(nodeType)).toBe(false);
      }
    });
  });
});
