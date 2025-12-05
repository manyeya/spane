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

import { QueueEvents } from 'bullmq';
import { EventEmitter } from 'events';
import type { Redis } from 'ioredis';
import type { IExecutionStateStore } from '../types';
import type {
  WorkflowEvent,
  NodeProgressEvent,
  WorkflowStatusEvent,
  ExecutionStateEvent,
  ProgressPayload,
} from './event-types';

/**
 * Manages event streaming from BullMQ QueueEvents to SSE clients.
 * 
 * Architecture:
 * - Listens to BullMQ 'progress' events from the node-execution queue
 * - Parses ProgressPayload and converts to typed WorkflowEvents
 * - Distributes events to subscribers via internal EventEmitter
 * - Supports filtering by executionId for targeted subscriptions
 */
export class EventStreamManager {
  private queueEvents: QueueEvents;
  private emitter: EventEmitter;
  private subscriptionCount: number = 0;
  private isStarted: boolean = false;

  constructor(
    private redisConnection: Redis,
    private stateStore: IExecutionStateStore
  ) {
    // Initialize QueueEvents for 'node-execution' queue
    this.queueEvents = new QueueEvents('node-execution', {
      connection: redisConnection,
    });

    // Internal event emitter for distributing events to subscribers
    this.emitter = new EventEmitter();
    // Increase max listeners to support many SSE connections
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Start listening to BullMQ events.
   * Sets up the progress event handler to parse and emit typed events.
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // Handle progress events from BullMQ
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

    this.isStarted = true;
    console.log('[EventStreamManager] Started listening to node-execution queue events');
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
   * Removes all listeners and closes the QueueEvents connection.
   */
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    await this.queueEvents.close();
    this.isStarted = false;
    console.log('[EventStreamManager] Closed');
  }
}
