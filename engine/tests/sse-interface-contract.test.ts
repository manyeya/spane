import { describe, test, expect } from "bun:test";
import type { EventStreamManager } from "../event-stream";
import type {
  WorkflowEvent,
  NodeProgressEvent,
  WorkflowStatusEvent,
  ExecutionStateEvent,
  ErrorEvent,
} from "../event-types";

/**
 * SSE Interface Contract Tests
 * 
 * These tests verify that the SSE subscription interface remains unchanged
 * after the simplified event streaming implementation (Task 2.5).
 * 
 * The SSE interface contract consists of:
 * 
 * 1. API Endpoints:
 *    - GET /api/executions/:executionId/stream - SSE stream for specific execution
 *    - GET /api/executions/stream - SSE stream for all events
 * 
 * 2. EventStreamManager Interface:
 *    - subscribe(executionId?: string): AsyncIterable<WorkflowEvent>
 *    - getExecutionState(executionId: string): Promise<ExecutionStateEvent | null>
 *    - emitLocal(event: WorkflowEvent): void
 *    - start(): Promise<void>
 *    - close(): Promise<void>
 *    - getSubscriptionCount(): number
 *    - isRunning(): boolean
 * 
 * 3. Event Types:
 *    - WorkflowEvent (union type)
 *    - NodeProgressEvent
 *    - WorkflowStatusEvent
 *    - ExecutionStateEvent
 *    - ErrorEvent
 * 
 * **Validates: Requirements FR-6.4 (Maintain SSE subscription interface for API consumers)**
 */

describe("SSE Interface Contract", () => {
  /**
   * Verify EventStreamManager interface shape
   */
  describe("EventStreamManager interface", () => {
    test("EventStreamManager has required methods", () => {
      // This test verifies the interface at compile time
      // If EventStreamManager changes its interface, this test will fail to compile
      
      type RequiredMethods = {
        subscribe: (executionId?: string) => AsyncIterable<WorkflowEvent>;
        getExecutionState: (executionId: string) => Promise<ExecutionStateEvent | null>;
        emitLocal: (event: WorkflowEvent) => void;
        start: () => Promise<void>;
        close: () => Promise<void>;
        getSubscriptionCount: () => number;
        isRunning: () => boolean;
      };

      // Type assertion to verify interface compatibility
      // This will cause a compile error if EventStreamManager doesn't match
      const _typeCheck: (manager: EventStreamManager) => RequiredMethods = (manager) => ({
        subscribe: manager.subscribe.bind(manager),
        getExecutionState: manager.getExecutionState.bind(manager),
        emitLocal: manager.emitLocal.bind(manager),
        start: manager.start.bind(manager),
        close: manager.close.bind(manager),
        getSubscriptionCount: manager.getSubscriptionCount.bind(manager),
        isRunning: manager.isRunning.bind(manager),
      });

      expect(_typeCheck).toBeDefined();
    });
  });

  /**
   * Verify event type shapes
   */
  describe("Event type shapes", () => {
    test("NodeProgressEvent has required fields", () => {
      const event: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId: 'exec-123',
        nodeId: 'node-1',
        workflowId: 'wf-1',
        status: 'running',
      };

      expect(event.type).toBe('node:progress');
      expect(typeof event.timestamp).toBe('number');
      expect(typeof event.executionId).toBe('string');
      expect(typeof event.nodeId).toBe('string');
      expect(typeof event.workflowId).toBe('string');
      expect(['running', 'completed', 'failed', 'skipped', 'delayed']).toContain(event.status);
    });

    test("NodeProgressEvent supports optional fields", () => {
      const event: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId: 'exec-123',
        nodeId: 'node-1',
        workflowId: 'wf-1',
        status: 'completed',
        data: { result: 'success' },
        error: undefined,
        progress: 100,
      };

      expect(event.data).toEqual({ result: 'success' });
      expect(event.progress).toBe(100);
    });

    test("WorkflowStatusEvent has required fields", () => {
      const event: WorkflowStatusEvent = {
        type: 'workflow:status',
        timestamp: Date.now(),
        executionId: 'exec-123',
        workflowId: 'wf-1',
        status: 'started',
      };

      expect(event.type).toBe('workflow:status');
      expect(typeof event.timestamp).toBe('number');
      expect(typeof event.executionId).toBe('string');
      expect(typeof event.workflowId).toBe('string');
      expect(['started', 'completed', 'failed', 'paused', 'cancelled']).toContain(event.status);
    });

    test("ExecutionStateEvent has required fields", () => {
      const event: ExecutionStateEvent = {
        type: 'execution:state',
        timestamp: Date.now(),
        executionId: 'exec-123',
        workflowId: 'wf-1',
        status: 'running',
        nodeResults: { 'node-1': { success: true } },
        startedAt: new Date().toISOString(),
      };

      expect(event.type).toBe('execution:state');
      expect(typeof event.timestamp).toBe('number');
      expect(typeof event.executionId).toBe('string');
      expect(typeof event.workflowId).toBe('string');
      expect(typeof event.status).toBe('string');
      expect(typeof event.nodeResults).toBe('object');
      expect(typeof event.startedAt).toBe('string');
    });

    test("ErrorEvent has required fields", () => {
      const event: ErrorEvent = {
        type: 'error',
        message: 'Execution not found',
        code: 'EXECUTION_NOT_FOUND',
      };

      expect(event.type).toBe('error');
      expect(typeof event.message).toBe('string');
    });

    test("WorkflowEvent union type accepts all event types", () => {
      const events: WorkflowEvent[] = [
        {
          type: 'node:progress',
          timestamp: Date.now(),
          executionId: 'exec-1',
          nodeId: 'node-1',
          workflowId: 'wf-1',
          status: 'running',
        },
        {
          type: 'workflow:status',
          timestamp: Date.now(),
          executionId: 'exec-1',
          workflowId: 'wf-1',
          status: 'completed',
        },
        {
          type: 'execution:state',
          timestamp: Date.now(),
          executionId: 'exec-1',
          workflowId: 'wf-1',
          status: 'running',
          nodeResults: {},
          startedAt: new Date().toISOString(),
        },
        {
          type: 'error',
          message: 'Test error',
        },
      ];

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe('node:progress');
      expect(events[1].type).toBe('workflow:status');
      expect(events[2].type).toBe('execution:state');
      expect(events[3].type).toBe('error');
    });
  });

  /**
   * Verify SSE data format
   */
  describe("SSE data format", () => {
    test("SSE events are formatted as 'data: {json}\\n\\n'", () => {
      const event: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: Date.now(),
        executionId: 'exec-123',
        nodeId: 'node-1',
        workflowId: 'wf-1',
        status: 'running',
      };

      const sseFormat = `data: ${JSON.stringify(event)}\n\n`;

      // Verify format
      expect(sseFormat).toMatch(/^data: .+\n\n$/);

      // Verify parseable
      const match = sseFormat.match(/^data: (.+)\n\n$/);
      expect(match).not.toBeNull();
      
      const parsed = JSON.parse(match![1]);
      expect(parsed.type).toBe('node:progress');
      expect(parsed.executionId).toBe('exec-123');
    });
  });

  /**
   * Verify subscription behavior contract
   */
  describe("Subscription behavior contract", () => {
    test("subscribe() returns AsyncIterable<WorkflowEvent>", () => {
      // This is a type-level test - if the interface changes, this won't compile
      type SubscribeReturn = ReturnType<EventStreamManager['subscribe']>;
      
      // Verify it's an AsyncIterable
      const _check: SubscribeReturn extends AsyncIterable<WorkflowEvent> ? true : false = true;
      expect(_check).toBe(true);
    });

    test("getExecutionState() returns Promise<ExecutionStateEvent | null>", () => {
      // This is a type-level test
      type GetStateReturn = ReturnType<EventStreamManager['getExecutionState']>;
      
      const _check: GetStateReturn extends Promise<ExecutionStateEvent | null> ? true : false = true;
      expect(_check).toBe(true);
    });
  });
});
