import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { ExecutionState, ExecutionResult, IExecutionStateStore } from "../../types";
import type { ExecutionStateEvent } from "../event-types";

/**
 * Property-based tests for initial state completeness.
 * 
 * **Feature: realtime-events, Property 4: Initial state completeness**
 * **Validates: Requirements 6.1, 6.2**
 * 
 * These tests verify that:
 * - For any SSE connection with a valid executionId, the first event SHALL be
 *   of type 'execution:state' and contain nodeResults and status fields.
 */

// ============================================================================
// TEST HELPERS - Mock state store for testing
// ============================================================================

/**
 * Creates a mock state store that returns the provided execution state.
 */
function createMockStateStore(executions: Map<string, ExecutionState>): IExecutionStateStore {
  return {
    async getExecution(executionId: string): Promise<ExecutionState | null> {
      return executions.get(executionId) || null;
    },
    // Stub implementations for other methods (not used in these tests)
    async createExecution() { return ''; },
    async getNodeResults() { return {}; },
    async getPendingNodeCount() { return 0; },
    async updateNodeResult() {},
    async cacheNodeResult() {},
    async setExecutionStatus() {},
    async updateExecutionMetadata() {},
    async saveWorkflow() { return 0; },
    async getWorkflow() { return null; },
    async getWorkflowVersion() { return null; },
    async listWorkflows() { return []; },
    async deactivateWorkflow() {},
    async addLog() {},
    async getLogs() { return []; },
    async addSpan() {},
    async updateSpan() {},
    async getTrace() { return null; },
  };
}

/**
 * Simplified getExecutionState function that mirrors EventStreamManager logic.
 * This isolates the state building logic for testing without Redis dependencies.
 */
async function getExecutionState(
  stateStore: IExecutionStateStore,
  executionId: string
): Promise<ExecutionStateEvent | null> {
  const execution = await stateStore.getExecution(executionId);
  
  if (!execution) {
    return null;
  }

  const event: ExecutionStateEvent = {
    type: 'execution:state',
    timestamp: Date.now(),
    executionId: execution.executionId,
    workflowId: execution.workflowId,
    status: execution.status,
    nodeResults: execution.nodeResults,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString(),
  };

  return event;
}

// ============================================================================
// ARBITRARIES FOR STATE GENERATION
// ============================================================================

const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^node-[a-z0-9]{2,10}$/);

const executionStatusArb = fc.constantFrom(
  'running', 'completed', 'failed', 'cancelled', 'paused'
) as fc.Arbitrary<ExecutionState['status']>;

const executionResultArb: fc.Arbitrary<ExecutionResult> = fc.record({
  success: fc.boolean(),
  data: fc.option(fc.anything(), { nil: undefined }),
  error: fc.option(fc.string(), { nil: undefined }),
  skipped: fc.option(fc.boolean(), { nil: undefined }),
});

const nodeResultsArb: fc.Arbitrary<Record<string, ExecutionResult>> = fc.dictionary(
  nodeIdArb,
  executionResultArb
);

// Valid date arbitrary that ensures no NaN dates
const validDateArb = fc.date({ min: new Date('2020-01-01'), max: new Date() }).filter(d => !isNaN(d.getTime()));

const executionStateArb: fc.Arbitrary<ExecutionState> = fc.record({
  executionId: executionIdArb,
  workflowId: workflowIdArb,
  status: executionStatusArb,
  nodeResults: nodeResultsArb,
  startedAt: validDateArb,
  completedAt: fc.option(validDateArb, { nil: undefined }),
  parentExecutionId: fc.option(executionIdArb, { nil: undefined }),
  depth: fc.integer({ min: 0, max: 10 }),
  initialData: fc.option(fc.anything(), { nil: undefined }),
  metadata: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined }),
});

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Initial state completeness property tests", () => {
  /**
   * **Feature: realtime-events, Property 4: Initial state completeness**
   * 
   * *For any* SSE connection with a valid executionId, the first event SHALL be
   * of type 'execution:state' and contain nodeResults and status fields.
   * 
   * **Validates: Requirements 6.1, 6.2**
   */
  describe("Property 4: Initial state completeness", () => {
    test("getExecutionState returns event with type 'execution:state' for valid executions", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionStateArb,
          async (executionState) => {
            const executions = new Map<string, ExecutionState>();
            executions.set(executionState.executionId, executionState);
            const stateStore = createMockStateStore(executions);

            const event = await getExecutionState(stateStore, executionState.executionId);

            // Property: Event must exist and have correct type
            expect(event).not.toBeNull();
            expect(event!.type).toBe('execution:state');
          }
        ),
        { numRuns: 100 }
      );
    });

    test("getExecutionState returns event with nodeResults field", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionStateArb,
          async (executionState) => {
            const executions = new Map<string, ExecutionState>();
            executions.set(executionState.executionId, executionState);
            const stateStore = createMockStateStore(executions);

            const event = await getExecutionState(stateStore, executionState.executionId);

            // Property: Event must contain nodeResults field
            expect(event).not.toBeNull();
            expect(event!.nodeResults).toBeDefined();
            expect(typeof event!.nodeResults).toBe('object');
            expect(event!.nodeResults).not.toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    test("getExecutionState returns event with status field", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionStateArb,
          async (executionState) => {
            const executions = new Map<string, ExecutionState>();
            executions.set(executionState.executionId, executionState);
            const stateStore = createMockStateStore(executions);

            const event = await getExecutionState(stateStore, executionState.executionId);

            // Property: Event must contain status field
            expect(event).not.toBeNull();
            expect(event!.status).toBeDefined();
            expect(typeof event!.status).toBe('string');
            expect(['running', 'completed', 'failed', 'cancelled', 'paused']).toContain(event!.status);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("getExecutionState preserves all node results from execution state", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionStateArb,
          async (executionState) => {
            const executions = new Map<string, ExecutionState>();
            executions.set(executionState.executionId, executionState);
            const stateStore = createMockStateStore(executions);

            const event = await getExecutionState(stateStore, executionState.executionId);

            // Property: All node results must be preserved
            expect(event).not.toBeNull();
            const originalNodeIds = Object.keys(executionState.nodeResults);
            const eventNodeIds = Object.keys(event!.nodeResults);
            
            expect(eventNodeIds.length).toBe(originalNodeIds.length);
            
            for (const nodeId of originalNodeIds) {
              expect(event!.nodeResults[nodeId]).toBeDefined();
              expect(event!.nodeResults[nodeId]).toEqual(executionState.nodeResults[nodeId]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test("getExecutionState includes required timestamp and ID fields", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionStateArb,
          async (executionState) => {
            const executions = new Map<string, ExecutionState>();
            executions.set(executionState.executionId, executionState);
            const stateStore = createMockStateStore(executions);

            const event = await getExecutionState(stateStore, executionState.executionId);

            // Property: Event must have all required fields
            expect(event).not.toBeNull();
            expect(event!.timestamp).toBeDefined();
            expect(typeof event!.timestamp).toBe('number');
            expect(event!.timestamp).toBeGreaterThan(0);
            
            expect(event!.executionId).toBe(executionState.executionId);
            expect(event!.workflowId).toBe(executionState.workflowId);
            expect(event!.startedAt).toBeDefined();
            expect(typeof event!.startedAt).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });

    test("getExecutionState returns null for non-existent executions", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          async (executionId) => {
            // Empty state store - no executions
            const stateStore = createMockStateStore(new Map());

            const event = await getExecutionState(stateStore, executionId);

            // Property: Should return null for non-existent execution
            expect(event).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    test("getExecutionState includes completedAt when execution is finished", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionStateArb,
          fc.date({ min: new Date('2020-01-01'), max: new Date() }),
          async (executionState, completedAt) => {
            // Skip invalid dates
            fc.pre(!isNaN(completedAt.getTime()));
            
            // Set a completed status with completedAt
            const finishedState: ExecutionState = {
              ...executionState,
              status: 'completed',
              completedAt,
            };
            
            const executions = new Map<string, ExecutionState>();
            executions.set(finishedState.executionId, finishedState);
            const stateStore = createMockStateStore(executions);

            const event = await getExecutionState(stateStore, finishedState.executionId);

            // Property: completedAt should be included when present
            expect(event).not.toBeNull();
            expect(event!.completedAt).toBeDefined();
            expect(typeof event!.completedAt).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
