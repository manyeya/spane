import { Queue, Worker, Job, QueueEvents, DelayedError, FlowProducer, WaitingChildrenError } from 'bullmq';
import { Redis } from 'ioredis';
import type { ExecutionContext, ExecutionResult, IExecutionStateStore, WorkflowDefinition } from './types';
import type { NodeRegistry } from './registry';

export interface NodeJobData {
  executionId: string;
  workflowId: string;
  nodeId: string;
  inputData?: any;
  // Sub-workflow execution state
  subWorkflowStep?: 'initial' | 'waiting-children' | 'complete';
  childExecutionId?: string;
}

export interface WorkflowJobData {
  workflowId: string;
  initialData?: any;
}

export interface DLQItem {
  jobId: string;
  data: NodeJobData;
  failedReason: string;
  timestamp: number;
  stacktrace?: string[];
}

export class WorkflowEngine {
  private nodeQueue: Queue<NodeJobData>;
  private workflowQueue: Queue<WorkflowJobData>;
  private dlqQueue: Queue<DLQItem>; // Dead Letter Queue
  private flowProducer: FlowProducer; // For parent-child job dependencies
  private nodeQueueEvents: QueueEvents;
  private workflowQueueEvents: QueueEvents;
  private nodeWorker?: Worker<NodeJobData>;
  private workflowWorker?: Worker<WorkflowJobData>;
  private workflows: Map<string, WorkflowDefinition> = new Map();

  constructor(
    private registry: NodeRegistry,
    private stateStore: IExecutionStateStore,
    private redisConnection: Redis
  ) {
    // Initialize queues
    this.nodeQueue = new Queue<NodeJobData>('node-execution', {
      connection: redisConnection,
    });

    this.workflowQueue = new Queue<WorkflowJobData>('workflow-execution', {
      connection: redisConnection,
    });

    this.dlqQueue = new Queue<DLQItem>('dlq-execution', {
      connection: redisConnection,
    });

    // Initialize FlowProducer for parent-child job dependencies
    this.flowProducer = new FlowProducer({
      connection: redisConnection,
    });

    // Initialize queue events for monitoring
    this.nodeQueueEvents = new QueueEvents('node-execution', {
      connection: redisConnection,
    });

    this.workflowQueueEvents = new QueueEvents('workflow-execution', {
      connection: redisConnection,
    });

    this.setupQueueEventListeners();
  }

  // Setup event listeners for queue monitoring
  private setupQueueEventListeners(): void {
    this.nodeQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`✓ Node job ${jobId} completed with result:`, returnvalue);
    });

    this.nodeQueueEvents.on('failed', async ({ jobId, failedReason }) => {
      console.error(`✗ Node job ${jobId} failed:`, failedReason);

      // Handle permanent failure (after retries are exhausted)
      // Note: QueueEvents 'failed' is emitted when a job fails, but we need to check if it's a permanent failure
      // However, BullMQ emits 'failed' for every attempt failure. 
      // To properly handle DLQ, we should rely on the worker's 'failed' event or check job status.
      // But since we are in a separate process context potentially (or just want centralized monitoring),
      // we can try to fetch the job and check if it has exhausted retries.
      // A simpler approach for this implementation is to handle DLQ logic in the worker's 'failed' handler
      // or here if we can access the job.

      // Let's handle it in the worker listeners for better access to job object, 
      // but we can also do some global logging here.
    });

    this.nodeQueueEvents.on('progress', ({ jobId, data }) => {
      console.log(`⟳ Node job ${jobId} progress:`, data);
    });

    this.workflowQueueEvents.on('completed', ({ jobId }) => {
      console.log(`✓ Workflow job ${jobId} completed`);
    });

    this.workflowQueueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`✗ Workflow job ${jobId} failed:`, failedReason);
    });
  }

  // Helper to log to both console and state store
  private async log(executionId: string, nodeId: string | undefined, level: 'info' | 'warn' | 'error' | 'debug', message: string, metadata?: any): Promise<void> {
    // Console log
    const prefix = `[${level.toUpperCase()}] [${executionId}]${nodeId ? ` [${nodeId}]` : ''}`;
    if (level === 'error') console.error(`${prefix} ${message}`);
    else if (level === 'warn') console.warn(`${prefix} ${message}`);
    else console.log(`${prefix} ${message}`);

    // Store log
    await this.stateStore.addLog({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      executionId,
      nodeId,
      level,
      message,
      timestamp: new Date(),
      metadata
    });
  }

  // Register a workflow definition
  async registerWorkflow(workflow: WorkflowDefinition): Promise<void> {
    this.workflows.set(workflow.id, workflow);

    // Handle Schedule Triggers
    if (workflow.triggers) {
      for (const trigger of workflow.triggers) {
        if (trigger.type === 'schedule') {
          const jobId = `schedule:${workflow.id}:${trigger.config.cron}`;

          try {
            // Remove existing job to make registration idempotent
            const existingJobs = await this.workflowQueue.getRepeatableJobs();
            const existingJob = existingJobs.find(job => job.id === jobId);
            if (existingJob) {
              await this.workflowQueue.removeRepeatableByKey(existingJob.key);
              console.log(`🔄 Removed existing schedule for workflow ${workflow.id}`);
            }

            // Add new repeatable job
            await this.workflowQueue.add(
              'workflow-execution',
              { workflowId: workflow.id },
              {
                jobId,
                repeat: {
                  pattern: trigger.config.cron,
                  ...(trigger.config.timezone && { tz: trigger.config.timezone }),
                } as any, // BullMQ RepeatOptions type may not include tz in all versions
              }
            );
            console.log(`⏰ Registered schedule for workflow ${workflow.id}: ${trigger.config.cron}`);
          } catch (error) {
            const errorMsg = `Failed to register schedule trigger for workflow ${workflow.id}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(`❌ ${errorMsg}`);
            throw new Error(errorMsg);
          }
        }
      }
    }
  }

  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  // Enqueue a full workflow execution
  async enqueueWorkflow(
    workflowId: string,
    initialData?: any,
    parentExecutionId?: string,
    depth: number = 0,
    parentJobId?: string,
    options?: {
      priority?: number;
      delay?: number;
      jobId?: string;
    }
  ): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Depth limit to prevent infinite recursion
    const MAX_DEPTH = 10;
    if (depth >= MAX_DEPTH) {
      throw new Error(`Maximum sub-workflow depth (${MAX_DEPTH}) exceeded`);
    }

    const executionId = await this.stateStore.createExecution(workflowId, parentExecutionId, depth, initialData);

    // Find all entry nodes (nodes with no inputs)
    const entryNodes = workflow.nodes.filter(node => node.inputs.length === 0);

    // Enqueue all entry nodes, passing parent job reference if this is a sub-workflow
    // Also pass priority and delay options to each node
    for (const node of entryNodes) {
      await this.enqueueNode(executionId, workflowId, node.id, initialData, parentJobId, options);
    }

    await this.log(executionId, undefined, 'info', `Workflow ${workflowId} started (Execution ID: ${executionId})`);
    return executionId;
  }

  // Trigger workflows via webhook path
  async triggerWebhook(path: string, method: string, data: any): Promise<string[]> {
    const triggeredExecutionIds: string[] = [];

    for (const workflow of this.workflows.values()) {
      if (workflow.triggers) {
        for (const trigger of workflow.triggers) {
          if (trigger.type === 'webhook' && trigger.config.path === path) {
            // Check method if specified
            if (trigger.config.method && trigger.config.method !== method) {
              continue;
            }

            console.log(`🔗 Webhook triggered workflow ${workflow.id} (path: ${path})`);
            const executionId = await this.enqueueWorkflow(workflow.id, data);
            triggeredExecutionIds.push(executionId);
          }
        }
      }
    }

    return triggeredExecutionIds;
  }

  // Replay a past execution
  async replayWorkflow(executionId: string): Promise<string> {
    const execution = await this.stateStore.getExecution(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Retrieve initialData from the original execution state
    const initialData = execution.initialData;

    // Start new execution
    const newExecutionId = await this.enqueueWorkflow(execution.workflowId, initialData);

    // Link to original execution
    await this.stateStore.updateExecutionMetadata(newExecutionId, {
      replayedFrom: executionId,
      ...execution.metadata
    });

    await this.log(newExecutionId, undefined, 'info', `Replay of execution ${executionId}`);

    return newExecutionId;
  }

  // Enqueue a single node execution (for manual/direct node execution)
  async enqueueNode(
    executionId: string,
    workflowId: string,
    nodeId: string,
    inputData?: any,
    parentJobId?: string,
    options?: {
      priority?: number;
      delay?: number;
      jobId?: string;
    }
  ): Promise<string> {
    const jobOpts: any = {
      jobId: options?.jobId || `${executionId}-${nodeId}-manual`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    };

    // Add priority if specified (1-10, higher = more important)
    if (options?.priority !== undefined) {
      jobOpts.priority = options.priority;
    }

    // Add delay if specified (in milliseconds)
    if (options?.delay !== undefined) {
      jobOpts.delay = options.delay;
    }

    // Add parent reference if provided (for BullMQ dependencies)
    if (parentJobId) {
      jobOpts.parent = {
        id: parentJobId,
        queue: 'node-execution',
      };
    }

    const job = await this.nodeQueue.add(
      'run-node',
      { executionId, workflowId, nodeId, inputData },
      jobOpts
    );

    return job.id!;
  }

  // Execute a sub-workflow using Checkpoint & Resume pattern (fully non-blocking)
  // 
  // Pattern:
  // 1. Initial step: Save checkpoint, enqueue child workflow, return immediately
  // 2. Parent job completes and frees worker (no blocking!)
  // 3. When child workflow completes, workflow completion hook re-enqueues parent node
  // 4. Parent node job runs again with 'complete' step, aggregates results
  private async executeSubWorkflow(
    parentExecutionId: string,
    parentWorkflowId: string,
    parentNodeId: string,
    parentJobId: string,
    config: { workflowId: string; inputMapping?: Record<string, string>; outputMapping?: Record<string, string> },
    inputData: any,
    depth: number,
    step: 'initial' | 'waiting-children' | 'complete',
    childExecutionId?: string
  ): Promise<ExecutionResult & { checkpoint?: boolean; childExecutionId?: string }> {
    const { workflowId, inputMapping, outputMapping } = config;

    // Validate sub-workflow exists
    if (!this.workflows.has(workflowId)) {
      return {
        success: false,
        error: `Sub-workflow '${workflowId}' not found`
      };
    }

    try {
      // Step 1: Initial - start child and checkpoint immediately (NO WAITING)
      if (step === 'initial') {
        // Apply input mapping
        let mappedInput = inputData;
        if (inputMapping && typeof inputData === 'object' && inputData !== null) {
          mappedInput = {};
          for (const [targetKey, sourceKey] of Object.entries(inputMapping)) {
            if (sourceKey in inputData) {
              mappedInput[targetKey] = inputData[sourceKey];
            }
          }
        }

        console.log(`🔀 Sub-workflow ${workflowId} starting (parent: ${parentExecutionId}, depth: ${depth + 1})`);

        // Start child workflow (normal enqueue, no parent reference needed)
        const newChildExecutionId = await this.enqueueWorkflow(
          workflowId,
          mappedInput,
          parentExecutionId,
          depth + 1
        );

        // CRITICAL: Store parent node info in execution metadata for resume callback
        // This will be used by the completion hook to re-enqueue the parent node
        const metadata = {
          parentNodeId,
          parentWorkflowId
        };
        await this.stateStore.updateExecutionMetadata(newChildExecutionId, metadata);

        console.log(`✅ Sub-workflow checkpoint: ${workflowId} started, parent node will resume when child completes`);

        // Return with checkpoint flag - parent job will complete and free the worker!
        return {
          success: true,
          checkpoint: true,
          childExecutionId: newChildExecutionId,
          data: { childExecutionId: newChildExecutionId }
        };
      }

      // Step 2: Resume/Complete - child finished, aggregate results
      if (step === 'complete' && childExecutionId) {
        const childExecution = await this.stateStore.getExecution(childExecutionId);

        if (!childExecution) {
          return {
            success: false,
            error: `Sub-workflow execution ${childExecutionId} not found`
          };
        }

        if (childExecution.status === 'completed') {
          // Aggregate results from final nodes
          const workflow = this.workflows.get(workflowId)!;
          const finalNodes = workflow.nodes.filter(node => node.outputs.length === 0);

          let aggregatedResult: any = {};

          if (finalNodes.length === 1 && finalNodes[0]) {
            const finalNodeId = finalNodes[0].id;
            const result = childExecution.nodeResults[finalNodeId];
            aggregatedResult = result?.data;
          } else if (finalNodes.length > 1) {
            for (const node of finalNodes) {
              const result = childExecution.nodeResults[node.id];
              if (result?.success && result.data !== undefined) {
                aggregatedResult[node.id] = result.data;
              }
            }
          }

          // Apply output mapping
          let mappedOutput = aggregatedResult;
          if (outputMapping && typeof aggregatedResult === 'object' && aggregatedResult !== null) {
            mappedOutput = {};
            for (const [targetKey, sourceKey] of Object.entries(outputMapping)) {
              if (sourceKey in aggregatedResult) {
                mappedOutput[targetKey] = aggregatedResult[sourceKey];
              }
            }
          }

          console.log(`✅ Sub-workflow ${workflowId} completed (execution: ${childExecutionId})`);
          return {
            success: true,
            data: mappedOutput
          };
        }

        if (childExecution.status === 'failed') {
          console.error(`❌ Sub-workflow ${workflowId} failed (execution: ${childExecutionId})`);
          return {
            success: false,
            error: `Sub-workflow '${workflowId}' failed`,
            data: childExecution.nodeResults
          };
        }

        if (childExecution.status === 'cancelled') {
          console.log(`🚫 Sub-workflow ${workflowId} cancelled (execution: ${childExecutionId})`);
          return {
            success: false,
            error: `Sub-workflow '${workflowId}' was cancelled`
          };
        }

        // Child still running - this shouldn't happen in checkpoint-resume
        // but if it does, just return success and it will be retried
        console.log(`⏳ Sub-workflow ${workflowId} still running, will check again`);
        return {
          success: true,
          checkpoint: true,
          childExecutionId,
          data: { status: 'waiting' }
        };
      }

      return {
        success: false,
        error: 'Invalid sub-workflow execution step'
      };

    } catch (error) {
      console.error(`❌ Sub-workflow ${workflowId} error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Start worker processes
  startWorkers(concurrency: number = 5): void {
    // Worker for individual node execution
    this.nodeWorker = new Worker<NodeJobData>(
      'node-execution',
      async (job: Job<NodeJobData>) => {
        await job.updateProgress(0);
        const result = await this.processNodeJob(job.data, job);
        await job.updateProgress(100);
        return result;
      },
      {
        connection: this.redisConnection,
        concurrency,
      }
    );

    // Worker for workflow orchestration (if needed for non-flow workflows)
    this.workflowWorker = new Worker<WorkflowJobData>(
      'workflow-execution',
      async (job: Job<WorkflowJobData>) => {
        console.log(`⏰ Processing workflow job ${job.id} for ${job.data.workflowId}`);
        // Start a new execution for this workflow
        await this.enqueueWorkflow(job.data.workflowId, job.data.initialData);
      },
      {
        connection: this.redisConnection,
        concurrency: Math.max(1, Math.floor(concurrency / 2)),
      }
    );

    this.nodeWorker.on('completed', (job) => {
      console.log(`✓ Node worker completed job ${job.id}`);
    });

    this.nodeWorker.on('failed', async (job, err) => {
      console.error(`✗ Node worker failed job ${job?.id}:`, err.message);

      if (job) {
        // Check if we have exhausted all attempts
        if (job.attemptsMade >= (job.opts.attempts || 1)) {
          console.log(`💀 Job ${job.id} has exhausted all retries. Moving to DLQ.`);

          try {
            await this.moveToDLQ(job, err);

            // Propagate error to workflow status
            const { executionId, nodeId } = job.data;
            await this.stateStore.updateNodeResult(executionId, nodeId, {
              success: false,
              error: err.message
            });
            await this.stateStore.setExecutionStatus(executionId, 'failed');
          } catch (dlqError) {
            console.error(`CRITICAL: Failed to process DLQ/State update for job ${job.id} (Execution: ${job.data.executionId}):`, dlqError);
            // Do not rethrow to prevent crashing the worker listener
          }
        }
      }
    });

    this.nodeWorker.on('progress', (job, progress) => {
      console.log(`⟳ Node job ${job.id} at ${progress}%`);
    });

    this.workflowWorker.on('completed', (job) => {
      console.log(`✓ Workflow worker completed job ${job.id}`);
    });

    this.workflowWorker.on('failed', (job, err) => {
      console.error(`✗ Workflow worker failed job ${job?.id}:`, err.message);
    });

    console.log(`👷 Workers started with concurrency: ${concurrency}`);
  }

  // Move failed job to Dead Letter Queue
  private async moveToDLQ(job: Job<NodeJobData>, error: Error): Promise<void> {
    const dlqItem: DLQItem = {
      jobId: job.id!,
      data: job.data,
      failedReason: error.message,
      timestamp: Date.now(),
      stacktrace: job.stacktrace,
    };

    await this.dlqQueue.add('dlq-item', dlqItem);
  }

  // Get items from DLQ
  async getDLQItems(start: number = 0, end: number = 10): Promise<DLQItem[]> {
    // BullMQ doesn't store job data in the queue directly in a way that we can list easily without fetching jobs
    // But since we are adding 'dlq-item' jobs to dlqQueue, we can fetch them.
    const jobs = await this.dlqQueue.getJobs(['waiting', 'active', 'delayed', 'paused'], start, end);
    return jobs.map(j => j.data);
  }

  // Retry a job from DLQ
  async retryDLQItem(dlqJobId: string): Promise<boolean> {
    const dlqJob = await this.dlqQueue.getJob(dlqJobId);
    if (!dlqJob) return false;

    const { data } = dlqJob.data;

    // Re-queue the original job
    await this.nodeQueue.add('run-node', data, {
      jobId: data.executionId + '-' + data.nodeId + '-retry-' + Date.now(), // New Job ID to avoid collision
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    // Remove from DLQ
    await dlqJob.remove();
    return true;
  }

  // Process a single node job
  private async processNodeJob(data: NodeJobData, job: Job): Promise<ExecutionResult> {
    const { executionId, workflowId, nodeId, inputData } = data;

    // Handle virtual root node (for workflows with multiple entry points)
    if (nodeId === '__root__') {
      return { success: true, data: { message: 'Virtual root node' } };
    }

    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const node = workflow.nodes.find(n => n.id === nodeId);

    if (!node) {
      throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`);
    }

    // Special handling for sub-workflow node type (before regular execution checks)
    if (node.type === 'sub-workflow') {
      // Gather results from upstream nodes
      const execution = await this.stateStore.getExecution(executionId);
      const previousResults = execution?.nodeResults || {};

      const config = node.config as { workflowId: string; inputMapping?: Record<string, string>; outputMapping?: Record<string, string> };

      if (!config.workflowId) {
        return {
          success: false,
          error: 'Sub-workflow node missing workflowId in config'
        };
      }

      // Process input data for sub-workflow (same logic as regular nodes)
      let processedInputData: any = inputData;

      if (node.inputs.length === 1) {
        const parentId = node.inputs[0];
        if (parentId) {
          const parentResult = previousResults[parentId];
          if (parentResult?.success && parentResult.data !== undefined) {
            processedInputData = parentResult.data;
          } else {
            processedInputData = undefined;
          }
        }
      } else if (node.inputs.length > 1) {
        const mergedData: Record<string, any> = {};
        for (const parentId of node.inputs) {
          const parentResult = previousResults[parentId];
          if (parentResult?.success && parentResult.data !== undefined) {
            mergedData[parentId] = parentResult.data;
          }
        }
        processedInputData = mergedData;
      }

      // Determine execution step based on job data
      const currentStep = data.subWorkflowStep || 'initial';
      const existingChildExecutionId = data.childExecutionId;

      // Execute sub-workflow with step-based approach
      const result = await this.executeSubWorkflow(
        executionId,
        workflowId,
        nodeId,
        job.id!,
        config,
        processedInputData,
        execution?.depth || 0,
        currentStep,
        existingChildExecutionId
      );

      // If checkpoint requested, parent job completes immediately (non-blocking!)
      if (result.checkpoint) {
        // Save checkpoint state with child execution ID
        // The completion hook will detect when child finishes and re-enqueue this node
        await this.stateStore.updateNodeResult(executionId, nodeId, {
          success: true,
          data: {
            checkpointed: true,
            childExecutionId: result.childExecutionId,
            subWorkflowStep: 'waiting-children'
          }
        });

        console.log(`💾 Checkpoint saved: Node ${nodeId} waiting for child ${result.childExecutionId}`);

        // Return success - job completes and frees the worker!
        return {
          success: true,
          data: {
            checkpointed: true,
            childExecutionId: result.childExecutionId
          }
        };
      }

      // If no checkpoint (or resumed from checkpoint), save and return result
      await this.stateStore.updateNodeResult(executionId, nodeId, result);
      return result;
    }

    // Regular node execution
    const executor = this.registry.get(node.type);

    if (!executor) {
      throw new Error(`No executor registered for node type: ${node.type}`);
    }

    // Gather results from upstream nodes (for nodes with dependencies)
    const execution = await this.stateStore.getExecution(executionId);
    const previousResults = execution?.nodeResults || {};

    // Check execution status before running
    if (execution?.status === 'cancelled') {
      console.log(`🚫 Execution ${executionId} is cancelled. Skipping node ${nodeId}.`);
      return { success: false, error: 'Workflow execution cancelled' };
    }

    if (execution?.status === 'paused') {
      console.log(`⏸️ Execution ${executionId} is paused. Moving to delayed queue.`);
      await job.moveToDelayed(Date.now() + 5000, job.token); // Retry in 5 seconds
      throw new DelayedError();
    }

    // --- Rate Limiting Check ---
    const rateLimit = this.registry.getRateLimit(node.type);
    if (rateLimit) {
      const key = `rate-limit:${node.type}:${Math.floor(Date.now() / 1000)}`;
      const current = await this.redisConnection.incr(key);
      if (current === 1) {
        await this.redisConnection.expire(key, 2); // Expire after 2 seconds to be safe
      }

      if (current > rateLimit) {
        console.log(`⏳ Rate limit exceeded for ${node.type}. Re-queueing.`);
        await job.moveToDelayed(Date.now() + 1000, job.token);
        throw new DelayedError();
      }
    }

    // --- Concurrency Check ---
    const maxConcurrency = workflow.maxConcurrency;
    if (maxConcurrency) {
      const activeKey = `workflow:active:${executionId}`;
      const luaScript = `
        local added = redis.call('SADD', KEYS[1], ARGV[1])
        local count = redis.call('SCARD', KEYS[1])
        if count > tonumber(ARGV[2]) then
          redis.call('SREM', KEYS[1], ARGV[1])
          return 0
        end
        return 1
      `;
      const allowed = await this.redisConnection.eval(luaScript, 1, activeKey, job.id!, maxConcurrency);

      if (allowed === 0) {
        console.log(`🚦 Max concurrency (${maxConcurrency}) reached for workflow ${executionId}. Re-queueing.`);
        await job.moveToDelayed(Date.now() + 2000, job.token);
        throw new DelayedError();
      }
    }

    try {

      // Process input data based on parent nodes
      let processedInputData: any = inputData;

      if (node.inputs.length === 1) {
        // Single parent: fetch parent's output data
        const parentId = node.inputs[0];
        if (!parentId) {
          processedInputData = undefined;
        } else {
          const parentResult = previousResults[parentId];

          if (parentResult?.success && parentResult.data !== undefined) {
            processedInputData = parentResult.data;
            console.log(`📥 Node ${nodeId} receiving data from parent ${parentId}`);
          } else {
            console.log(`⚠️  Node ${nodeId}: Parent ${parentId} has no output data`);
            processedInputData = undefined;
          }
        }
      } else if (node.inputs.length > 1) {
        // Multiple parents: merge parent outputs into object
        const mergedData: Record<string, any> = {};

        for (const parentId of node.inputs) {
          const parentResult = previousResults[parentId];
          if (parentResult?.success && parentResult.data !== undefined) {
            mergedData[parentId] = parentResult.data;
          }
        }

        processedInputData = mergedData;
        console.log(`📥 Node ${nodeId} receiving merged data from ${node.inputs.length} parents`);
      }
      // If node has no inputs, use the provided inputData (for entry nodes)

      const context: ExecutionContext = {
        workflowId,
        executionId,
        nodeId,
        inputData: processedInputData,
        previousResults,
        parentExecutionId: execution?.parentExecutionId,
        depth: execution?.depth || 0,
      };

      await this.log(executionId, nodeId, 'info', `Executing node ${nodeId} (type: ${node.type})`);

      const spanId = `${executionId}-${nodeId}-${Date.now()}`;
      await this.stateStore.addSpan(executionId, {
        id: spanId,
        nodeId,
        name: `Execute ${node.type}`,
        startTime: Date.now(),
        status: 'running',
        metadata: { inputData: processedInputData }
      });

      await job.updateProgress(50);

      // Execute the node with timeout if configured
      let result: ExecutionResult;
      const timeoutMs = node.config?.timeout;

      try {
        if (timeoutMs) {
          let timer: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<ExecutionResult>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Node execution timed out after ${timeoutMs}ms`)), timeoutMs);
          });

          result = await Promise.race([
            executor.execute(context).finally(() => clearTimeout(timer)),
            timeoutPromise
          ]);
        } else {
          result = await executor.execute(context);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.stateStore.updateSpan(executionId, spanId, {
          endTime: Date.now(),
          status: 'failed',
          error: errorMsg
        });
        await this.log(executionId, nodeId, 'error', `Node execution failed: ${errorMsg}`);
        throw err;
      }

      await this.stateStore.updateSpan(executionId, spanId, {
        endTime: Date.now(),
        status: result.success ? 'completed' : 'failed',
        error: result.error,
        metadata: { result }
      });

      if (result.success) {
        await this.log(executionId, nodeId, 'info', `Node execution completed successfully`);
      } else {
        await this.log(executionId, nodeId, 'error', `Node execution failed: ${result.error}`);
      }

      // Save result to state store
      await this.stateStore.updateNodeResult(executionId, nodeId, result);

      // If this node succeeded, check and enqueue/skip its children
      if (result.success && node.outputs.length > 0) {
        console.log(`📤 Node ${nodeId} completed successfully, checking ${node.outputs.length} children`);

        // Determine which children to execute and which to skip
        const nextNodes = result.nextNodes || node.outputs;
        const nodesToSkip = node.outputs.filter(id => !nextNodes.includes(id));

        // 1. Handle skipped nodes
        for (const skippedNodeId of nodesToSkip) {
          console.log(`⏭️ Skipping branch starting at ${skippedNodeId}`);
          await this.skipNode(executionId, workflowId, skippedNodeId);
        }

        // 2. Handle next nodes
        for (const childNodeId of nextNodes) {
          // Check if all parents of this child have completed (or been skipped)
          const childNode = workflow.nodes.find(n => n.id === childNodeId);
          if (!childNode) continue;

          const execution = await this.stateStore.getExecution(executionId);

          // A parent is "resolved" if it has a result (success, failed, or skipped)
          // We only care about success/skipped for flow control here.
          // If a parent failed, the flow usually stops anyway unless we have error handling paths (future).
          const allParentsResolved = childNode.inputs.every(parentId => {
            const res = execution?.nodeResults[parentId];
            return res !== undefined && (res.success || res.skipped);
          });

          if (allParentsResolved) {
            // Check if we should run this child or skip it based on parents
            // Rule: Run if AT LEAST ONE parent succeeded (and wasn't skipped)
            // Rule: Skip if ALL parents were skipped

            const anyParentSucceeded = childNode.inputs.some(parentId => {
              const res = execution?.nodeResults[parentId];
              return res?.success && !res.skipped;
            });

            if (anyParentSucceeded) {
              console.log(`✅ All parents of ${childNodeId} resolved, enqueueing`);
              await this.enqueueNode(executionId, workflowId, childNodeId);
            } else {
              console.log(`⏭️ All parents of ${childNodeId} were skipped, skipping this node too`);
              await this.skipNode(executionId, workflowId, childNodeId);
            }
          } else {
            console.log(`⏳ Waiting for other parents of ${childNodeId} to complete`);
          }
        }
      }

      // Check if workflow is complete
      await this.checkWorkflowCompletion(executionId, workflowId);

      return result;
    } finally {
      // --- Concurrency Cleanup ---
      if (workflow.maxConcurrency) {
        const activeKey = `workflow:active:${executionId}`;
        await this.redisConnection.srem(activeKey, job.id!);
      }
    }
  }


  // Cancel a running workflow
  async cancelWorkflow(executionId: string): Promise<void> {
    const execution = await this.stateStore.getExecution(executionId);
    if (!execution || execution.status === 'completed' || execution.status === 'failed') {
      return;
    }

    await this.stateStore.setExecutionStatus(executionId, 'cancelled');
    console.log(`🚫 Workflow execution ${executionId} cancelled`);
  }

  // Pause a running workflow
  async pauseWorkflow(executionId: string): Promise<void> {
    const execution = await this.stateStore.getExecution(executionId);
    if (!execution || execution.status !== 'running') {
      return;
    }

    await this.stateStore.setExecutionStatus(executionId, 'paused');
    console.log(`⏸️ Workflow execution ${executionId} paused`);
  }

  // Resume a paused workflow
  async resumeWorkflow(executionId: string): Promise<void> {
    const execution = await this.stateStore.getExecution(executionId);
    if (!execution || execution.status !== 'paused') {
      return;
    }

    await this.stateStore.setExecutionStatus(executionId, 'running');
    console.log(`▶️ Workflow execution ${executionId} resumed`);
  }

  // Skip a node and recursively skip its children if needed
  private async skipNode(executionId: string, workflowId: string, nodeId: string): Promise<void> {
    // Mark as skipped in state store
    await this.stateStore.updateNodeResult(executionId, nodeId, {
      success: true,
      skipped: true
    });

    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Propagate skip to children
    for (const childNodeId of node.outputs) {
      const childNode = workflow.nodes.find(n => n.id === childNodeId);
      if (!childNode) continue;

      const execution = await this.stateStore.getExecution(executionId);

      // Check if all parents are resolved (completed or skipped)
      const allParentsResolved = childNode.inputs.every(parentId => {
        const res = execution?.nodeResults[parentId];
        return res !== undefined && (res.success || res.skipped);
      });

      if (allParentsResolved) {
        // If all parents are resolved, check if we should skip this child too
        // We skip if ALL parents are skipped
        const allParentsSkipped = childNode.inputs.every(parentId => {
          const res = execution?.nodeResults[parentId];
          return res?.skipped;
        });

        if (allParentsSkipped) {
          console.log(`⏭️ All parents of ${childNodeId} skipped, skipping recursively`);
          await this.skipNode(executionId, workflowId, childNodeId);
        } else {
          // If some parents succeeded (and weren't skipped), we might need to run this node!
          // This handles the "Join" case where one branch was skipped but another succeeded.
          console.log(`✅ Node ${childNodeId} has active parents, enqueueing despite skip from ${nodeId}`);
          await this.enqueueNode(executionId, workflowId, childNodeId);
        }
      }
    }

    // Check for workflow completion even after skipping
    await this.checkWorkflowCompletion(executionId, workflowId);
  }

  // Check if all nodes in the workflow have completed
  private async checkWorkflowCompletion(executionId: string, workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    const execution = await this.stateStore.getExecution(executionId);

    if (!workflow || !execution) return;

    // If cancelled, don't mark as completed/failed based on nodes
    if (execution.status === 'cancelled') return;

    const allNodesExecuted = workflow.nodes.every(
      node => execution.nodeResults[node.id] !== undefined
    );

    if (allNodesExecuted) {
      const anyFailed = Object.values(execution.nodeResults).some(r => !r.success);
      const newStatus = anyFailed ? 'failed' : 'completed';
      await this.stateStore.setExecutionStatus(executionId, newStatus);

      console.log(`🏁 Workflow ${workflowId} (execution: ${executionId}) ${newStatus}`);

      // CHECKPOINT-RESUME: Check if this is a child workflow that needs to resume parent
      // Fallback to legacy properties for backward compatibility with in-flight executions
      const parentNodeId = execution.metadata?.parentNodeId || (execution as any).parentNodeId;
      const parentWorkflowId = execution.metadata?.parentWorkflowId || (execution as any).parentWorkflowId;

      if (parentNodeId && parentWorkflowId && execution.parentExecutionId) {
        console.log(`🔄 Child workflow completed, resuming parent node: ${parentNodeId}`);

        // Re-enqueue parent node with 'complete' step to aggregate results
        await this.enqueueNode(
          execution.parentExecutionId,
          parentWorkflowId,
          parentNodeId,
          {
            subWorkflowStep: 'complete',
            childExecutionId: executionId
          }
        );
      }
    }
  }

  // Get queue metrics and statistics
  async getQueueStats() {
    const [nodeWaiting, nodeActive, nodeCompleted, nodeFailed] = await Promise.all([
      this.nodeQueue.getWaitingCount(),
      this.nodeQueue.getActiveCount(),
      this.nodeQueue.getCompletedCount(),
      this.nodeQueue.getFailedCount(),
    ]);

    const [workflowWaiting, workflowActive, workflowCompleted, workflowFailed] = await Promise.all([
      this.workflowQueue.getWaitingCount(),
      this.workflowQueue.getActiveCount(),
      this.workflowQueue.getCompletedCount(),
      this.workflowQueue.getFailedCount(),
    ]);

    const [dlqWaiting] = await Promise.all([
      this.dlqQueue.getWaitingCount()
    ]);

    return {
      nodeQueue: {
        waiting: nodeWaiting,
        active: nodeActive,
        completed: nodeCompleted,
        failed: nodeFailed,
      },
      workflowQueue: {
        waiting: workflowWaiting,
        active: workflowActive,
        completed: workflowCompleted,
        failed: workflowFailed,
      },
      dlqQueue: {
        waiting: dlqWaiting
      }
    };
  }

  // Schedule a workflow to execute at a specific time
  async scheduleWorkflow(
    workflowId: string,
    initialData: any,
    executeAt: Date
  ): Promise<string> {
    const delay = executeAt.getTime() - Date.now();
    if (delay < 0) {
      throw new Error('Cannot schedule workflow in the past');
    }

    return this.enqueueWorkflow(workflowId, initialData, undefined, 0, undefined, { delay });
  }

  // Check if a job with the given ID exists (for deduplication)
  async getJobStatus(jobId: string): Promise<{
    exists: boolean;
    status?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
  }> {
    // Check in node queue
    const nodeJob = await this.nodeQueue.getJob(jobId);
    if (nodeJob) {
      const state = await nodeJob.getState();
      return { exists: true, status: state as any };
    }

    // Check in workflow queue
    const workflowJob = await this.workflowQueue.getJob(jobId);
    if (workflowJob) {
      const state = await workflowJob.getState();
      return { exists: true, status: state as any };
    }

    return { exists: false };
  }

  // Enqueue multiple workflows in bulk
  async enqueueBulkWorkflows(workflows: Array<{
    workflowId: string;
    initialData?: any;
    priority?: number;
    delay?: number;
    jobId?: string;
  }>): Promise<string[]> {
    const executionIds: string[] = [];

    // Process all workflows
    for (const wf of workflows) {
      const executionId = await this.enqueueWorkflow(
        wf.workflowId,
        wf.initialData,
        undefined,
        0,
        undefined,
        {
          priority: wf.priority,
          delay: wf.delay,
          jobId: wf.jobId
        }
      );
      executionIds.push(executionId);
    }

    console.log(`📦 Bulk enqueued ${workflows.length} workflows`);
    return executionIds;
  }

  // Cancel multiple workflows in bulk
  async cancelBulkWorkflows(executionIds: string[]): Promise<void> {
    await Promise.all(executionIds.map(id => this.cancelWorkflow(id)));
    console.log(`🚫 Bulk cancelled ${executionIds.length} workflows`);
  }

  // Pause multiple workflows in bulk
  async pauseBulkWorkflows(executionIds: string[]): Promise<void> {
    await Promise.all(executionIds.map(id => this.pauseWorkflow(id)));
    console.log(`⏸️ Bulk paused ${executionIds.length} workflows`);
  }

  // Resume multiple workflows in bulk
  async resumeBulkWorkflows(executionIds: string[]): Promise<void> {
    await Promise.all(executionIds.map(id => this.resumeWorkflow(id)));
    console.log(`▶️ Bulk resumed ${executionIds.length} workflows`);
  }

  // Graceful shutdown
  async close(): Promise<void> {
    console.log('🛑 Shutting down workflow engine...');

    await this.flowProducer.close();
    await this.nodeWorker?.close();
    await this.workflowWorker?.close();
    await this.nodeQueueEvents.close();
    await this.workflowQueueEvents.close();
    await this.nodeQueue.close();
    await this.workflowQueue.close();
    await this.dlqQueue.close();

    console.log('✓ Workflow engine shutdown complete');
  }
}
