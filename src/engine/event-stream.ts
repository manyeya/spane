/**
 * EventStreamManager - Manages real-time event streaming via BullMQ QueueEvents.
 * 
 * This module provides:
 * - QueueEvents integration for listening to job progress events
 * - Subscription management with optional executionId filtering
 * - Initial state retrieval for SSE connection sync
 * - Local event emission for workflow status events
 * 
 * Simplified architecture (no QueueEventsProducer):
 * - Node events flow through job.updateProgress() → QueueEvents.on('progress')
 * - Native completed/failed events provide job completion status
 * - Workflow status events are emitted locally via emitLocal() (single-instance only)
 * - Cross-instance event propagation relies on job progress events
 * 
 * @module engine/event-stream
 */

import { QueueEvents, Queue } from 'bullmq';
import { EventEmitter } from 'events';
import type { Redis } from 'ioredis';
import type { IExecutionStateStore } from '../types';
import type { NodeJobData } from './types';
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
 * Simplified Architecture (no QueueEventsProducer):
 * - Listens to BullMQ 'progress' events from the node-execution queue
 * - Listens to native 'completed' and 'failed' events for job status
 * - Parses ProgressPayload and converts to typed WorkflowEvents
 * - Distributes events to subscribers via internal EventEmitter
 * - Supports filtering by executionId for targeted subscriptions
 * - Workflow status events are emitted locally only (no cross-instance pub/sub)
 */
export class EventStreamManager {
  private queueEvents: QueueEvents;
  private nodeQueue: Queue<NodeJobData>;
  private emitter: EventEmitter;
  private subscriptionCount: number = 0;
  private isStarted: boolean = false;

  constructor(
    redisConnection: Redis,
    private stateStore: IExecutionStateStore
  ) {
    // Initialize QueueEvents for 'node-execution' queue
    this.queueEvents = new QueueEvents('node-execution', {
      connection: redisConnection,
      prefix: 'spane',
    });

    // Initialize Queue reference for fetching job data on completed/failed events
    this.nodeQueue = new Queue<NodeJobData>('node-execution', {
      connection: redisConnection,
      prefix: 'spane',
    });

    // Internal event emitter for distributing events to subscribers
    this.emitter = new EventEmitter();
    // Increase max listeners to support many SSE connections
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Start listening to BullMQ events.
   * Sets up handlers for progress, completed, and failed events.
   * 
   * Simplified architecture - listens only to native QueueEvents:
   * - 'progress': Node execution progress updates via job.updateProgress()
   * - 'completed': Native job completion events
   * - 'failed': Native job failure events
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // Handle progress events from BullMQ (node execution events)
    this.queueEvents.on('progress', async ({ jobId, data }) => {
      try {
        const payload = data as ProgressPayload;
        
        // Fetch job data to supplement payload if needed (new simplified format)
        let jobData: NodeJobData | undefined;
        if (!payload.executionId || !payload.workflowId) {
          const job = await this.nodeQueue.getJob(jobId);
          jobData = job?.data;
        }
        
        const event = this.parseProgressPayload(payload, jobData);
        if (event) {
          this.emitter.emit('event', event);
        }
      } catch (error) {
        // Log error but continue streaming - don't let malformed events break the stream
        console.error(`[EventStreamManager] Error parsing progress event from job ${jobId}:`, error);
      }
    });

    // Handle native completed events from BullMQ
    this.queueEvents.on('completed', async ({ jobId, returnvalue }) => {
      try {
        const job = await this.nodeQueue.getJob(jobId);
        if (job && job.data) {
          const { executionId, workflowId, nodeId } = job.data;
          
          // Parse return value - BullMQ may return it as string from Redis
          const result = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
          
          // Skip emitting 'completed' for delay node initial step.
          // When a delay node first processes, it returns { success: true, data: { delayed: true, ... } }
          // and enqueues a resumed job. We should NOT emit 'completed' for this intermediate result
          // because the actual completion happens when the resumed job runs after the delay expires.
          // The delay node emits its own 'delayed' event via job.updateProgress() which is handled
          // by the 'progress' event handler above.
          if (result?.data?.delayed === true) {
            return;
          }
          
          const event: NodeProgressEvent = {
            type: 'node:progress',
            timestamp: Date.now(),
            executionId,
            nodeId,
            workflowId,
            status: 'completed',
            data: result?.data,
          };
          this.emitter.emit('event', event);
        }
      } catch (error) {
        console.error(`[EventStreamManager] Error handling completed event for job ${jobId}:`, error);
      }
    });

    // Handle native failed events from BullMQ
    this.queueEvents.on('failed', async ({ jobId, failedReason }) => {
      try {
        const job = await this.nodeQueue.getJob(jobId);
        if (job && job.data) {
          const { executionId, workflowId, nodeId } = job.data;
          
          const event: NodeProgressEvent = {
            type: 'node:progress',
            timestamp: Date.now(),
            executionId,
            nodeId,
            workflowId,
            status: 'failed',
            error: failedReason,
          };
          this.emitter.emit('event', event);
        }
      } catch (error) {
        console.error(`[EventStreamManager] Error handling failed event for job ${jobId}:`, error);
      }
    });

    // Handle Redis connection errors with logging
    this.queueEvents.on('error', (error) => {
      console.error('[EventStreamManager] QueueEvents error:', error);
    });

    this.isStarted = true;
    console.log('[EventStreamManager] Started listening to node-execution queue (progress, completed, failed)');
  }

  /**
   * Emit a workflow event to local subscribers only.
   * 
   * Primary use case: workflow-level status events (started, cancelled, paused)
   * that occur outside of job processing context. These events cannot flow through
   * job.updateProgress() because there is no active job at the time of emission.
   * 
   * Architecture note:
   * - Node events: flow through job.updateProgress() → QueueEvents.on('progress')
   * - Workflow status events: emitted locally via this method (single-instance only)
   * 
   * For cross-instance workflow status propagation, consider using a dedicated
   * event job or Redis pub/sub mechanism.
   * 
   * @param event - The WorkflowEvent to emit locally (typically WorkflowStatusEvent)
   */
  emitLocal(event: WorkflowEvent): void {
    this.emitter.emit('event', event);
  }

  /**
   * Parse a ProgressPayload into a typed WorkflowEvent.
   * 
   * Supports both the full ProgressPayload format and the simplified format
   * where executionId/workflowId/nodeId come from job data instead of the payload.
   * 
   * New simplified format (from design doc):
   * ```typescript
   * await job.updateProgress({
   *   eventType: 'node',
   *   nodeStatus: 'running',
   *   timestamp: Date.now(),
   * });
   * ```
   * 
   * @param payload - The progress payload from job.updateProgress()
   * @param jobData - Optional job data to supplement missing fields in simplified format
   * @returns Typed WorkflowEvent or null if payload is invalid
   */
  private parseProgressPayload(
    payload: ProgressPayload | Partial<ProgressPayload>,
    jobData?: NodeJobData
  ): WorkflowEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    // Extract fields from payload, falling back to job data for simplified format
    const executionId = payload.executionId || jobData?.executionId;
    const workflowId = payload.workflowId || jobData?.workflowId;
    const nodeId = payload.nodeId || jobData?.nodeId;
    const timestamp = payload.timestamp || Date.now();

    if (payload.eventType === 'node') {
      // Validate required fields for node events
      if (!executionId || !workflowId || !nodeId) {
        console.warn('[EventStreamManager] Missing required fields for node event:', {
          hasExecutionId: !!executionId,
          hasWorkflowId: !!workflowId,
          hasNodeId: !!nodeId,
        });
        return null;
      }

      // Node progress event
      const event: NodeProgressEvent = {
        type: 'node:progress',
        timestamp,
        executionId,
        nodeId,
        workflowId,
        status: payload.nodeStatus!,
        data: payload.nodeData,
        error: payload.nodeError,
        progress: payload.nodeProgress,
      };
      return event;
    }

    if (payload.eventType === 'workflow') {
      // Validate required fields for workflow events
      if (!executionId || !workflowId) {
        console.warn('[EventStreamManager] Missing required fields for workflow event:', {
          hasExecutionId: !!executionId,
          hasWorkflowId: !!workflowId,
        });
        return null;
      }

      // Workflow status event
      const event: WorkflowStatusEvent = {
        type: 'workflow:status',
        timestamp,
        executionId,
        workflowId,
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
   * Removes all listeners and closes the QueueEvents and Queue connections.
   */
  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    await this.queueEvents.close();
    await this.nodeQueue.close();
    this.isStarted = false;
    console.log('[EventStreamManager] Closed');
  }
}
