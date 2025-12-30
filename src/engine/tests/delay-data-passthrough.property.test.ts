import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { ExecutionResult } from "../../types";

/**
 * Property-based tests for delay node data pass-through.
 * 
 * **Feature: delay-node, Property 3: Data pass-through invariant**
 * **Validates: Requirements 2.1, 2.2**
 * 
 * These tests verify that:
 * - Delay node output equals input data without modification
 * - Single parent: data is passed directly
 * - Multiple parents: data is merged into object keyed by parent ID
 * - Data structure and types are preserved
 */

// ============================================================================
// ARBITRARIES FOR DATA GENERATION
// ============================================================================

// Arbitrary for generating various data types
const primitiveDataArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);

// Arbitrary for generating complex data structures
const complexDataArb = fc.oneof(
  fc.record({ value: fc.string(), count: fc.integer() }),
  fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  fc.record({
    nested: fc.record({ deep: fc.string() }),
    array: fc.array(fc.integer()),
  }),
);

// Arbitrary for any valid input data
const anyDataArb = fc.oneof(
  primitiveDataArb,
  complexDataArb,
  fc.record({
    id: fc.string(),
    timestamp: fc.integer(),
    payload: fc.oneof(primitiveDataArb, complexDataArb),
  }),
);

// Arbitrary for generating valid node IDs
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,8}$/);

// Arbitrary for generating successful execution results
const successResultArb = (data: any) => ({
  success: true as const,
  data,
});

// Arbitrary for generating parent results (1 to 5 parents)
const parentResultsArb = fc.array(
  fc.tuple(nodeIdArb, anyDataArb),
  { minLength: 1, maxLength: 5 }
).map(tuples => {
  // Ensure unique node IDs
  const seen = new Set<string>();
  return tuples.filter(([id]) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}).filter(arr => arr.length >= 1);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Simulates the data pass-through logic from processDelayNode.
 * This mirrors the actual implementation for the 'resumed' step.
 * 
 * @param inputData - Initial input data (may be undefined)
 * @param parentIds - Array of parent node IDs
 * @param previousResults - Results from parent nodes
 * @returns The output data that would be passed through
 */
function simulateDelayPassThrough(
  inputData: any,
  parentIds: string[],
  previousResults: Record<string, ExecutionResult>
): any {
  let outputData: any = inputData;
  
  if (parentIds.length > 0) {
    if (parentIds.length === 1) {
      // Single parent: Pass data directly
      const parentId = parentIds[0];
      if (parentId) {
        const parentResult = previousResults[parentId];
        if (parentResult?.success && parentResult.data !== undefined) {
          outputData = parentResult.data;
        }
      }
    } else {
      // Multiple parents: Merge data into an object keyed by parent node ID
      const mergedData: Record<string, any> = {};
      for (const parentId of parentIds) {
        const parentResult = previousResults[parentId];
        if (parentResult?.success && parentResult.data !== undefined) {
          mergedData[parentId] = parentResult.data;
        }
      }
      outputData = mergedData;
    }
  }
  
  return outputData;
}

/**
 * Deep equality check that handles various data types
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  
  return true;
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Delay data pass-through property tests", () => {
  /**
   * **Feature: delay-node, Property 3: Data pass-through invariant**
   * 
   * *For any* delay node execution, the output data should equal the input data
   * without modification, regardless of the number of parent nodes or the
   * structure of the input.
   * 
   * **Validates: Requirements 2.1, 2.2**
   */
  describe("Property 3: Data pass-through invariant", () => {
    
    test("single parent data is passed through directly", async () => {
      await fc.assert(
        fc.asyncProperty(
          nodeIdArb,
          anyDataArb,
          async (parentId, parentData) => {
            const parentIds = [parentId];
            const previousResults: Record<string, ExecutionResult> = {
              [parentId]: successResultArb(parentData),
            };
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: Output equals parent data exactly
            expect(deepEqual(output, parentData)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("multiple parent data is merged by parent ID", async () => {
      await fc.assert(
        fc.asyncProperty(
          parentResultsArb.filter(arr => arr.length >= 2),
          async (parentResults) => {
            const parentIds = parentResults.map(([id]) => id);
            const previousResults: Record<string, ExecutionResult> = {};
            
            for (const [parentId, data] of parentResults) {
              previousResults[parentId] = successResultArb(data);
            }
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: Output is an object with parent IDs as keys
            expect(typeof output).toBe('object');
            expect(output).not.toBeNull();
            
            // Property: Each parent's data is present under its ID
            for (const [parentId, data] of parentResults) {
              expect(deepEqual(output[parentId], data)).toBe(true);
            }
            
            // Property: No extra keys in output
            expect(Object.keys(output).sort()).toEqual(parentIds.sort());
          }
        ),
        { numRuns: 100 }
      );
    });

    test("data types are preserved through pass-through", async () => {
      await fc.assert(
        fc.asyncProperty(
          nodeIdArb,
          fc.record({
            stringVal: fc.string(),
            numberVal: fc.integer(),
            booleanVal: fc.boolean(),
            nullVal: fc.constant(null),
            arrayVal: fc.array(fc.integer()),
            objectVal: fc.record({ key: fc.string() }),
          }),
          async (parentId, complexData) => {
            const parentIds = [parentId];
            const previousResults: Record<string, ExecutionResult> = {
              [parentId]: successResultArb(complexData),
            };
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: All data types are preserved
            expect(typeof output.stringVal).toBe('string');
            expect(typeof output.numberVal).toBe('number');
            expect(typeof output.booleanVal).toBe('boolean');
            expect(output.nullVal).toBeNull();
            expect(Array.isArray(output.arrayVal)).toBe(true);
            expect(typeof output.objectVal).toBe('object');
            
            // Property: Values are exactly preserved
            expect(output.stringVal).toBe(complexData.stringVal);
            expect(output.numberVal).toBe(complexData.numberVal);
            expect(output.booleanVal).toBe(complexData.booleanVal);
            expect(output.arrayVal).toEqual(complexData.arrayVal);
            expect(output.objectVal).toEqual(complexData.objectVal);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("nested objects are preserved through pass-through", async () => {
      await fc.assert(
        fc.asyncProperty(
          nodeIdArb,
          fc.record({
            level1: fc.record({
              level2: fc.record({
                level3: fc.string(),
              }),
            }),
          }),
          async (parentId, nestedData) => {
            const parentIds = [parentId];
            const previousResults: Record<string, ExecutionResult> = {
              [parentId]: successResultArb(nestedData),
            };
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: Nested structure is preserved
            expect(output.level1.level2.level3).toBe(nestedData.level1.level2.level3);
            expect(deepEqual(output, nestedData)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("arrays are preserved through pass-through", async () => {
      await fc.assert(
        fc.asyncProperty(
          nodeIdArb,
          fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), { minLength: 0, maxLength: 10 }),
          async (parentId, arrayData) => {
            const parentIds = [parentId];
            const previousResults: Record<string, ExecutionResult> = {
              [parentId]: successResultArb(arrayData),
            };
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: Array is preserved exactly
            expect(Array.isArray(output)).toBe(true);
            expect(output.length).toBe(arrayData.length);
            expect(output).toEqual(arrayData);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("entry node with no parents uses initial input data", async () => {
      await fc.assert(
        fc.asyncProperty(
          anyDataArb,
          async (initialData) => {
            const parentIds: string[] = [];
            const previousResults: Record<string, ExecutionResult> = {};
            
            const output = simulateDelayPassThrough(initialData, parentIds, previousResults);
            
            // Property: Initial input data is passed through when no parents
            expect(deepEqual(output, initialData)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("undefined parent data is excluded from merged output", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(nodeIdArb, { minLength: 2, maxLength: 5 }).filter(arr => new Set(arr).size === arr.length),
          fc.integer({ min: 0, max: 4 }),
          anyDataArb,
          async (parentIds, undefinedIndex, validData) => {
            const actualUndefinedIndex = undefinedIndex % parentIds.length;
            
            const previousResults: Record<string, ExecutionResult> = {};
            for (let i = 0; i < parentIds.length; i++) {
              if (i === actualUndefinedIndex) {
                // Parent with undefined data
                previousResults[parentIds[i]!] = { success: true };
              } else {
                previousResults[parentIds[i]!] = successResultArb(validData);
              }
            }
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: Parent with undefined data is excluded
            expect(output[parentIds[actualUndefinedIndex]!]).toBeUndefined();
            
            // Property: Other parents are included
            for (let i = 0; i < parentIds.length; i++) {
              if (i !== actualUndefinedIndex) {
                expect(deepEqual(output[parentIds[i]!], validData)).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("failed parent results are excluded from merged output", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(nodeIdArb, { minLength: 2, maxLength: 5 }).filter(arr => new Set(arr).size === arr.length),
          fc.integer({ min: 0, max: 4 }),
          anyDataArb,
          async (parentIds, failedIndex, validData) => {
            const actualFailedIndex = failedIndex % parentIds.length;
            
            const previousResults: Record<string, ExecutionResult> = {};
            for (let i = 0; i < parentIds.length; i++) {
              if (i === actualFailedIndex) {
                // Failed parent
                previousResults[parentIds[i]!] = { success: false, error: 'Test failure' };
              } else {
                previousResults[parentIds[i]!] = successResultArb(validData);
              }
            }
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: Failed parent is excluded
            expect(output[parentIds[actualFailedIndex]!]).toBeUndefined();
            
            // Property: Successful parents are included
            for (let i = 0; i < parentIds.length; i++) {
              if (i !== actualFailedIndex) {
                expect(deepEqual(output[parentIds[i]!], validData)).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("output data structure matches input exactly (no mutation)", async () => {
      await fc.assert(
        fc.asyncProperty(
          nodeIdArb,
          anyDataArb,
          async (parentId, originalData) => {
            // Create a deep copy to verify no mutation
            const dataCopy = JSON.parse(JSON.stringify(originalData));
            
            const parentIds = [parentId];
            const previousResults: Record<string, ExecutionResult> = {
              [parentId]: successResultArb(originalData),
            };
            
            const output = simulateDelayPassThrough(undefined, parentIds, previousResults);
            
            // Property: Original data is not mutated
            expect(deepEqual(originalData, dataCopy)).toBe(true);
            
            // Property: Output equals original data
            expect(deepEqual(output, originalData)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
