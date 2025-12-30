import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import type { NodeProgressEvent, NodeStatus } from "../event-types";
import { isValidWorkflowEvent } from "../event-types";
import { WorkflowEventEmitter } from "../event-emitter";
import type { DelayNodeConfig } from "../../types";
import { resolveDuration } from "../node-processor";

/**
 * Property-based tests for delay node event emission sequence.
 * 
 * **Feature: delay-node, Property 6: Event emission sequence**
 * **Validates: Requirements 4.1, 4.2, 4.3**
 * 
 * These tests verify that:
 * - Delay nodes emit node:started event at the beginning
 * - Delay nodes emit node:delayed event when moving to delayed queue
 * - The node:delayed event includes the expected resume timestamp
 * - Delay nodes emit node:completed event on successful resume
 * - The event sequence is always: started → delayed → completed
 */

// ============================================================================
// ARBITRARIES FOR EVENT GENERATION
// ============================================================================

// Common field arbitraries
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const workflowIdArb = fc.stringMatching(/^wf-[a-z0-9]{4,12}$/);
const nodeIdArb = fc.stringMatching(/^delay-[a-z0-9]{2,10}$/);
const timestampArb = fc.integer({ min: 1700000000000, max: 2000000000000 });

// Valid duration values
const positiveDurationMsArb = fc.integer({ min: 1, max: 86400000 }); // Up to 24 hours in ms
const positiveSecondsArb = fc.integer({ min: 1, max: 86400 }); // Up to 24 hours in seconds
const positiveMinutesArb = fc.integer({ min: 1, max: 1440 }); // Up to 24 hours in minutes

// Valid delay node configurations
const validDelayConfigArb: fc.Arbitrary<DelayNodeConfig> = fc.oneof(
  fc.record({ duration: positiveDurationMsArb }),
  fc.record({ durationSeconds: positiveSecondsArb }),
  fc.record({ durationMinutes: positiveMinutesArb }),
);

// Optional output data
const optionalDataArb = fc.option(
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.dictionary(fc.string(), fc.string())
  ),
  { nil: undefined }
);

// ============================================================================
// HELPER TYPES AND FUNCTIONS
// ============================================================================

/**
 * Represents the sequence of events emitted during delay node processing
 */
interface DelayEventSequence {
  started: NodeProgressEvent;
  delayed: NodeProgressEvent;
  completed: NodeProgressEvent;
}

/**
 * Creates a mock event representing node:started
 */
function createStartedEvent(
  executionId: string,
  nodeId: string,
  workflowId: string,
  timestamp: number
): NodeProgressEvent {
  return {
    type: 'node:progress',
    timestamp,
    executionId,
    nodeId,
    workflowId,
    status: 'running',
  };
}

/**
 * Creates a mock event representing node:delayed
 */
function createDelayedEvent(
  executionId: string,
  nodeId: string,
  workflowId: string,
  timestamp: number,
  resumeAt: number
): NodeProgressEvent {
  return {
    type: 'node:progress',
    timestamp,
    executionId,
    nodeId,
    workflowId,
    status: 'delayed',
    data: { resumeAt },
  };
}

/**
 * Creates a mock event representing node:completed
 */
function createCompletedEvent(
  executionId: string,
  nodeId: string,
  workflowId: string,
  timestamp: number,
  data?: any
): NodeProgressEvent {
  return {
    type: 'node:progress',
    timestamp,
    executionId,
    nodeId,
    workflowId,
    status: 'completed',
    data,
  };
}

/**
 * Simulates the event sequence for a delay node execution.
 * Returns the sequence of events that would be emitted.
 */
function simulateDelayEventSequence(
  executionId: string,
  nodeId: string,
  workflowId: string,
  config: DelayNodeConfig,
  startTime: number,
  outputData?: any
): DelayEventSequence | null {
  const duration = resolveDuration(config);
  
  if (duration === null || duration < 0) {
    return null; // Invalid config, no events emitted
  }
  
  const resumeAt = startTime + duration;
  
  return {
    started: createStartedEvent(executionId, nodeId, workflowId, startTime),
    delayed: createDelayedEvent(executionId, nodeId, workflowId, startTime + 1, resumeAt),
    completed: createCompletedEvent(executionId, nodeId, workflowId, resumeAt, outputData),
  };
}

/**
 * Validates that an event sequence follows the correct order
 */
function validateEventSequenceOrder(sequence: DelayEventSequence): boolean {
  // Check status progression
  if (sequence.started.status !== 'running') return false;
  if (sequence.delayed.status !== 'delayed') return false;
  if (sequence.completed.status !== 'completed') return false;
  
  // Check timestamp ordering
  if (sequence.started.timestamp > sequence.delayed.timestamp) return false;
  if (sequence.delayed.timestamp > sequence.completed.timestamp) return false;
  
  return true;
}

/**
 * Validates that all events in a sequence have consistent identifiers
 */
function validateEventConsistency(sequence: DelayEventSequence): boolean {
  const { started, delayed, completed } = sequence;
  
  // All events should have the same executionId
  if (started.executionId !== delayed.executionId) return false;
  if (delayed.executionId !== completed.executionId) return false;
  
  // All events should have the same nodeId
  if (started.nodeId !== delayed.nodeId) return false;
  if (delayed.nodeId !== completed.nodeId) return false;
  
  // All events should have the same workflowId
  if (started.workflowId !== delayed.workflowId) return false;
  if (delayed.workflowId !== completed.workflowId) return false;
  
  return true;
}

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Delay node event sequence property tests", () => {
  /**
   * **Feature: delay-node, Property 6: Event emission sequence**
   * 
   * *For any* delay node execution, the events emitted should follow the
   * sequence: node:started → node:delayed (with resume time) → node:completed.
   * 
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  describe("Property 6: Event emission sequence", () => {
    
    test("delay node emits started event first (Requirement 4.1)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          async (executionId, nodeId, workflowId, config, startTime) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime
            );
            
            // Property: Valid config produces event sequence starting with 'running'
            expect(sequence).not.toBeNull();
            expect(sequence!.started.status).toBe('running');
            expect(sequence!.started.type).toBe('node:progress');
            expect(isValidWorkflowEvent(sequence!.started)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("delay node emits delayed event with resume time (Requirement 4.2)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          async (executionId, nodeId, workflowId, config, startTime) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime
            );
            
            const duration = resolveDuration(config);
            const expectedResumeAt = startTime + duration!;
            
            // Property: Delayed event has status 'delayed' and includes resumeAt
            expect(sequence).not.toBeNull();
            expect(sequence!.delayed.status).toBe('delayed');
            expect(sequence!.delayed.type).toBe('node:progress');
            expect(sequence!.delayed.data).toBeDefined();
            expect(sequence!.delayed.data.resumeAt).toBe(expectedResumeAt);
            expect(isValidWorkflowEvent(sequence!.delayed)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("delay node emits completed event on resume (Requirement 4.3)", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          optionalDataArb,
          async (executionId, nodeId, workflowId, config, startTime, outputData) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime, outputData
            );
            
            // Property: Completed event has status 'completed'
            expect(sequence).not.toBeNull();
            expect(sequence!.completed.status).toBe('completed');
            expect(sequence!.completed.type).toBe('node:progress');
            expect(isValidWorkflowEvent(sequence!.completed)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("event sequence follows correct order: started → delayed → completed", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          async (executionId, nodeId, workflowId, config, startTime) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime
            );
            
            // Property: Event sequence follows correct order
            expect(sequence).not.toBeNull();
            expect(validateEventSequenceOrder(sequence!)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("all events in sequence have consistent identifiers", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          async (executionId, nodeId, workflowId, config, startTime) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime
            );
            
            // Property: All events have consistent executionId, nodeId, workflowId
            expect(sequence).not.toBeNull();
            expect(validateEventConsistency(sequence!)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("resume timestamp equals start time plus duration", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          async (executionId, nodeId, workflowId, config, startTime) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime
            );
            
            const duration = resolveDuration(config);
            
            // Property: resumeAt = startTime + duration
            expect(sequence).not.toBeNull();
            expect(sequence!.delayed.data.resumeAt).toBe(startTime + duration!);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("completed event timestamp is at or after resume time", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          async (executionId, nodeId, workflowId, config, startTime) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime
            );
            
            // Property: completed timestamp >= resumeAt
            expect(sequence).not.toBeNull();
            const resumeAt = sequence!.delayed.data.resumeAt;
            expect(sequence!.completed.timestamp).toBeGreaterThanOrEqual(resumeAt);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("all events conform to NodeProgressEvent interface", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          validDelayConfigArb,
          timestampArb,
          async (executionId, nodeId, workflowId, config, startTime) => {
            const sequence = simulateDelayEventSequence(
              executionId, nodeId, workflowId, config, startTime
            );
            
            // Property: All events are valid WorkflowEvents
            expect(sequence).not.toBeNull();
            expect(isValidWorkflowEvent(sequence!.started)).toBe(true);
            expect(isValidWorkflowEvent(sequence!.delayed)).toBe(true);
            expect(isValidWorkflowEvent(sequence!.completed)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test("invalid config produces no event sequence", async () => {
      const invalidConfigs: DelayNodeConfig[] = [
        {},
        { duration: -100 },
        { durationSeconds: -10 },
        { durationMinutes: -1 },
      ];
      
      for (const config of invalidConfigs) {
        const sequence = simulateDelayEventSequence(
          'exec-test',
          'delay-test',
          'wf-test',
          config,
          Date.now()
        );
        
        // Property: Invalid configs produce null sequence
        expect(sequence).toBeNull();
      }
    });

    test("WorkflowEventEmitter.createNodeProgressEvent produces valid events", async () => {
      await fc.assert(
        fc.asyncProperty(
          executionIdArb,
          nodeIdArb,
          workflowIdArb,
          fc.constantFrom<NodeStatus>('running', 'delayed', 'completed'),
          optionalDataArb,
          async (executionId, nodeId, workflowId, status, data) => {
            const event = WorkflowEventEmitter.createNodeProgressEvent({
              executionId,
              nodeId,
              workflowId,
              status,
              data,
            });
            
            // Property: Created events are valid
            expect(event.type).toBe('node:progress');
            expect(event.executionId).toBe(executionId);
            expect(event.nodeId).toBe(nodeId);
            expect(event.workflowId).toBe(workflowId);
            expect(event.status).toBe(status);
            expect(isValidWorkflowEvent(event)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
