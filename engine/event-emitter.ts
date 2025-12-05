/**
 * WorkflowEventEmitter - Static helper methods for emitting workflow events.
 * 
 * Uses BullMQ's job.updateProgress() to emit events through QueueEvents,
 * enabling distributed event propagation via Redis Pub/Sub.
 * 
 * @module engine/event-emitter
 */

import type { Job } from 'bullmq';
import type { NodeProgressEvent, WorkflowStatusEvent, ProgressPayload, NodeStatus, WorkflowStatus } from './event-types';

/**
 * Static helper class for emitting workflow events via BullMQ job progress.
 * 
 * All events are emitted using job.updateProgress(), which triggers QueueEvents
 * listeners across all connected API instances via Redis Pub/Sub.
 */
export class WorkflowEventEmitter {
  /**
   * Emit a node progress event via BullMQ job.
   * 
   * @param job - The BullMQ job instance
   * @param event - Node progress event data (without type and timestamp)
   */
  static async emitNodeProgress(
    job: Job,
    event: Omit<NodeProgressEvent, 'type' | 'timestamp'>
  ): Promise<void> {
    const payload: ProgressPayload = {
      eventType: 'node',
      executionId: event.executionId,
      workflowId: event.workflowId,
      timestamp: Date.now(),
      nodeId: event.nodeId,
      nodeStatus: event.status,
      nodeData: event.data,
      nodeError: event.error,
      nodeProgress: event.progress,
    };

    await job.updateProgress(payload);
  }

  /**
   * Emit a workflow status event via BullMQ job.
   * 
   * @param job - The BullMQ job instance
   * @param event - Workflow status event data (without type and timestamp)
   */
  static async emitWorkflowStatus(
    job: Job,
    event: Omit<WorkflowStatusEvent, 'type' | 'timestamp'>
  ): Promise<void> {
    const payload: ProgressPayload = {
      eventType: 'workflow',
      executionId: event.executionId,
      workflowId: event.workflowId,
      timestamp: Date.now(),
      workflowStatus: event.status,
      workflowError: event.error,
    };

    await job.updateProgress(payload);
  }

  /**
   * Emit a 'running' event when a node starts processing.
   * 
   * @param job - The BullMQ job instance
   * @param nodeId - The node identifier
   * @param workflowId - The workflow identifier
   * @param executionId - The execution identifier
   */
  static async emitNodeStarted(
    job: Job,
    nodeId: string,
    workflowId: string,
    executionId: string
  ): Promise<void> {
    await WorkflowEventEmitter.emitNodeProgress(job, {
      executionId,
      nodeId,
      workflowId,
      status: 'running',
    });
  }

  /**
   * Emit a 'completed' event when a node finishes successfully.
   * 
   * @param job - The BullMQ job instance
   * @param nodeId - The node identifier
   * @param workflowId - The workflow identifier
   * @param executionId - The execution identifier
   * @param data - Optional output data from the node
   */
  static async emitNodeCompleted(
    job: Job,
    nodeId: string,
    workflowId: string,
    executionId: string,
    data?: any
  ): Promise<void> {
    await WorkflowEventEmitter.emitNodeProgress(job, {
      executionId,
      nodeId,
      workflowId,
      status: 'completed',
      data,
    });
  }

  /**
   * Emit a 'failed' event when a node execution fails.
   * 
   * @param job - The BullMQ job instance
   * @param nodeId - The node identifier
   * @param workflowId - The workflow identifier
   * @param executionId - The execution identifier
   * @param error - Error message describing the failure
   */
  static async emitNodeFailed(
    job: Job,
    nodeId: string,
    workflowId: string,
    executionId: string,
    error: string
  ): Promise<void> {
    await WorkflowEventEmitter.emitNodeProgress(job, {
      executionId,
      nodeId,
      workflowId,
      status: 'failed',
      error,
    });
  }

  /**
   * Emit a 'skipped' event when a node is skipped due to conditional branching.
   * 
   * @param job - The BullMQ job instance
   * @param nodeId - The node identifier
   * @param workflowId - The workflow identifier
   * @param executionId - The execution identifier
   */
  static async emitNodeSkipped(
    job: Job,
    nodeId: string,
    workflowId: string,
    executionId: string
  ): Promise<void> {
    await WorkflowEventEmitter.emitNodeProgress(job, {
      executionId,
      nodeId,
      workflowId,
      status: 'skipped',
    });
  }

  /**
   * Create a NodeProgressEvent object from the given parameters.
   * Useful for testing and validation.
   * 
   * @param params - Event parameters
   * @returns A complete NodeProgressEvent object
   */
  static createNodeProgressEvent(params: {
    executionId: string;
    nodeId: string;
    workflowId: string;
    status: NodeStatus;
    data?: any;
    error?: string;
    progress?: number;
  }): NodeProgressEvent {
    return {
      type: 'node:progress',
      timestamp: Date.now(),
      executionId: params.executionId,
      nodeId: params.nodeId,
      workflowId: params.workflowId,
      status: params.status,
      data: params.data,
      error: params.error,
      progress: params.progress,
    };
  }

  /**
   * Create a WorkflowStatusEvent object from the given parameters.
   * Useful for testing and validation.
   * 
   * @param params - Event parameters
   * @returns A complete WorkflowStatusEvent object
   */
  static createWorkflowStatusEvent(params: {
    executionId: string;
    workflowId: string;
    status: WorkflowStatus;
    error?: string;
  }): WorkflowStatusEvent {
    return {
      type: 'workflow:status',
      timestamp: Date.now(),
      executionId: params.executionId,
      workflowId: params.workflowId,
      status: params.status,
      error: params.error,
    };
  }
}
