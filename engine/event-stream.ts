/**
 * EventStreamManager - Manages real-time event streaming via BullMQ QueueEvents.
 * 
 * This module provides:
 * - QueueEvents integration for distributed event propagation via Redis Pub/Sub
 * - Subscription management with optional executionId filtering
 * - Initial state retrieval for SSE connection sync
 * 
 * @module engine/event-stream
 */

import { QueueEvents, QueueEventsProducer } from 'bullmq';
import type { QueueEventsListener } from 'bullmq';
import { EventEmitter } from 'events';
import type { Redis } from 'ioredis';
import type { IExecutionStateStore } from '../types';
import type {
  WorkflowEvent,
  NodeProgressEvent,
  WorkflowStatusEvent,
  ExecutionStateEvent,
  ProgressPayload,
  WorkflowStatus,
} from './event-types';

/**
 * Custom event payload for workflow events published via QueueEventsProducer
 */
export interface WorkflowEventPayload {
  executionId: string;
  workflowId: string;
  error?: string;
}

/**
 * Extended QueueEventsListener interface for custom workflow events.
 * These events are published via QueueEventsProducer.publishEvent() and
 * received via QueueEvents listeners.
 */
export interface WorkflowEventsListener extends QueueEventsListener {
  'workflow:started': (args: WorkflowEventPayload, id: string) => void;
  'workflow:completed': (args: WorkflowEventPayload, id: string) => void;
  'workflow:failed': (args: WorkflowEventPayload, id: string) => void;
  'workflow:cancelled': (args: WorkflowEventPayload, id: string) => void;
  'workflow:paused': (args: WorkflowEventPayload, id: string) => void;
}

/**
 * Manages event streaming from BullMQ QueueEvents to SSE clients.
 * 
 * Architecture:
 * - Listens to BullMQ 'progress' events from the node-execution queue
 * - Uses QueueEventsProducer for publishing custom workflow events via Redis Pub/Sub
 * - Parses ProgressPayload and converts to typed WorkflowEvents
 * - Distributes events to subscribers via internal EventEmitter
 * - Supports filtering by executionId for targeted subscriptions
 */
export class EventStreamManager {
  private queueEvents: QueueEvents;
  private workflowQueueEvents: QueueEvents;
  private queueEventsProducer: QueueEventsProducer;
  private emitter: EventEmitter;
  private subscriptionCount: number = 0;
  private isStarted: boolean = false;
  private readonly WORKFLOW_EVENTS_QUEUE = 'workflow-events';

  constructor(
    private redisConnection: Redis,
    private stateStore: IExecutionStateStore
  ) {
    // Initialize QueueEvents for 'node-execution' queue (existing functionality)
    this.queueEvents = new QueueEvents('node-execution', {
      connection: redisConnection,
      prefix: 'spane',
    });

    // Initialize QueueEvents for 'workflow-events' queue (custom events)
    this.workflowQueueEvents = new QueueEvents(this.WORKFLOW_EVENTS_QUEUE, {
      connection: redisConnection,
      prefix: 'spane',
    });

    // Initialize QueueEventsProducer for publishing custom events
    this.queueEventsProducer = new QueueEventsProducer(this.WORKFLOW_EVENTS_QUEUE, {
      connection: redisConnection,
      prefix: '{spane}',
    });

    // Internal event emitter for distributing events to subscribers
    this.emitter = new EventEmitter();
    // Increase max listeners to support many SSE connections
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Start listening to BullMQ events.
   * Sets up the progress event handler to parse and emit typed events,
   * and custom workflow event listeners for direct event emission.
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // Handle progress events from BullMQ (existing node execution events)
    this.queueEvents.on('progress', ({ jobId, data }) => {
      try {
        const payload = data as ProgressPayload;
        const event = this.parseProgressPayload(payload);
        if (event) {
          this.emitter.emit('event', event);
        }
      } catch (error) {
        // Log error but continue streaming - don't let malformed events break the stream
        console.error(`[EventStreamManager] Error parsing progress event from job ${jobId}:`, error);
      }
    });

    // Handle Redis connection errors with logging
    this.queueEvents.on('error', (error) => {
      console.error('[EventStreamManager] QueueEvents error:', error);
    });

    // Setup custom workflow event listeners via BullMQ's native custom events
    this.setupWorkflowEventListeners();

    this.isStarted = true;
    console.log('[EventStreamManager] Started listening to node-execution and workflow-events queues');
  }

  /**
   * Setup listeners for custom workflow events published via QueueEventsProducer.
   * These events are distributed via Redis Pub/Sub to all connected instances.
   */
  private setupWorkflowEventListeners(): void {
    // Helper to create WorkflowStatusEvent from custom event payload
    const createStatusEvent = (status: WorkflowStatus, args: WorkflowEventPayload): WorkflowStatusEvent => ({
      type: 'workflow:status',
      timestamp: Date.now(),
      executionId: args.executionId,
      workflowId: args.workflowId,
      status,
      error: args.error,
    });

    // Listen for workflow:started events using BullMQ's generic type parameter
    this.workflowQueueEvents.on<WorkflowEventsListener>('workflow:started', (args: WorkflowEventPayload) => {
      const event = createStatusEvent('started', args);
      this.emitter.emit('event', event);
    });

    // Listen for workflow:completed events
    this.workflowQueueEvents.on<WorkflowEventsListener>('workflow:completed', (args: WorkflowEventPayload) => {
      const event = createStatusEvent('completed', args);
      this.emitter.emit('event', event);
    });

    // Listen for workflow:failed events
    this.workflowQueueEvents.on<WorkflowEventsListener>('workflow:failed', (args: WorkflowEventPayload) => {
      const event = createStatusEvent('failed', args);
      this.emitter.emit('event', event);
    });

    // Listen for workflow:cancelled events
    this.workflowQueueEvents.on<WorkflowEventsListener>('workflow:cancelled', (args: WorkflowEventPayload) => {
      const event = createStatusEvent('cancelled', args);
      this.emitter.emit('event', event);
    });

    // Listen for workflow:paused events
    this.workflowQueueEvents.on<WorkflowEventsListener>('workflow:paused', (args: WorkflowEventPayload) => {
      const event = createStatusEvent('paused', args);
      this.emitter.emit('event', event);
    });

    // Handle errors on workflow events queue
    this.workflowQueueEvents.on('error', (error) => {
      console.error('[EventStreamManager] WorkflowQueueEvents error:', error);
    });
  }

  /**
   * Emit a workflow event to all subscribers.
   * 
   * This method:
   * 1. Emits to local EventEmitter immediately (for same-instance subscribers)
   * 2. Publishes via QueueEventsProducer for cross-instance distribution via Redis Pub/Sub
   * 
   * @param event - The WorkflowStatusEvent to emit
   */
  async emit(event: WorkflowStatusEvent): Promise<void> {
    // 1. Emit locally immediately (for same-instance subscribers)
    this.emitter.emit('event', event);

    // 2. Publish via BullMQ's QueueEventsProducer for cross-instance distribution
    try {
      const eventName = `workflow:${event.status}` as const;
      const payload: WorkflowEventPayload = {
        executionId: event.executionId,
        workflowId: event.workflowId,
        error: event.error,
      };

      await this.queueEventsProducer.publishEvent({
        eventName,
        ...payload,
      });
    } catch (error) {
      // Log error but don't throw - local emission already succeeded
      console.error('[EventStreamManager] Error publishing event via QueueEventsProducer:', error);
    }
  }

  /**
   * Parse a ProgressPayload into a typed WorkflowEvent.
   */
  private parseProgressPayload(payload: ProgressPayload): WorkflowEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (payload.eventType === 'node') {
      // Node progress event
      const event: NodeProgressEvent = {
        type: 'node:progress',
        timestamp: payload.timestamp,
        executionId: payload.executionId,
        nodeId: payload.nodeId!,
        workflowId: payload.workflowId,
        status: payload.nodeStatus!,
        data: payload.nodeData,
        error: payload.nodeError,
        progress: payload.nodeProgress,
      };
      return event;
    }

    if (payload.eventType === 'workflow') {
      // Workflow status event
      const event: WorkflowStatusEvent = {
        type: 'workflow:status',
        timestamp: payload.timestamp,
        executionId: payload.executionId,
        workflowId: payload.workflowId,
        status: payload.workflowStatus!,
        error: payload.workflowError,
      };
      return event;
    }

    return null;
  }


  /**
   * Subscribe to workflow events with optional executionId filtering.
   * Returns an AsyncIterable that yields WorkflowEvents.
   * 
   * @param executionId - Optional filter to receive only events for this execution
   * @returns AsyncIterable<WorkflowEvent> for streaming events
   */
  subscribe(executionId?: string): AsyncIterable<WorkflowEvent> {
    this.subscriptionCount++;

    // Create an async generator that yields events
    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
        let eventQueue: WorkflowEvent[] = [];
        let resolveNext: ((value: IteratorResult<WorkflowEvent>) => void) | null = null;
        let isDone = false;

        // Event handler that filters and queues events
        const handler = (event: WorkflowEvent) => {
          // Filter by executionId if provided
          if (executionId && 'executionId' in event && event.executionId !== executionId) {
            return;
          }

          if (resolveNext) {
            // If someone is waiting for an event, resolve immediately
            const resolve = resolveNext;
            resolveNext = null;
            resolve({ value: event, done: false });
          } else {
            // Otherwise queue the event
            eventQueue.push(event);
          }
        };

        // Subscribe to events
        self.emitter.on('event', handler);

        return {
          async next(): Promise<IteratorResult<WorkflowEvent>> {
            if (isDone) {
              return { value: undefined, done: true };
            }

            // If there are queued events, return the first one
            if (eventQueue.length > 0) {
              return { value: eventQueue.shift()!, done: false };
            }

            // Wait for the next event
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },

          async return(): Promise<IteratorResult<WorkflowEvent>> {
            // Cleanup when the iterator is closed
            isDone = true;
            self.emitter.off('event', handler);
            eventQueue = [];
            if (resolveNext) {
              resolveNext({ value: undefined, done: true });
              resolveNext = null;
            }
            return { value: undefined, done: true };
          },

          async throw(error: Error): Promise<IteratorResult<WorkflowEvent>> {
            isDone = true;
            self.emitter.off('event', handler);
            eventQueue = [];
            throw error;
          },
        };
      },
    };
  }

  /**
   * Get the current execution state for initial SSE sync.
   * Returns an ExecutionStateEvent with all node results and current status.
   * 
   * @param executionId - The execution ID to fetch state for
   * @returns ExecutionStateEvent or null if execution doesn't exist
   */
  async getExecutionState(executionId: string): Promise<ExecutionStateEvent | null> {
    const execution = await this.stateStore.getExecution(executionId);

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

  /**
   * Get the number of active subscriptions.
   * Useful for monitoring and debugging.
   */
  getSubscriptionCount(): number {
    return this.emitter.listenerCount('event');
  }

  /**
   * Check if the event stream is started.
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Cleanup and close the event stream.
   * Removes all listeners and closes the QueueEvents and QueueEventsProducer connections.
   */
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    await this.queueEvents.close();
    await this.workflowQueueEvents.close();
    await this.queueEventsProducer.close();
    this.isStarted = false;
    console.log('[EventStreamManager] Closed');
  }
}
