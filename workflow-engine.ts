import { Queue, Worker, Job, QueueEvents, FlowProducer } from 'bullmq';
import { Redis } from 'ioredis';
import type { ExecutionContext, ExecutionResult, IExecutionStateStore, NodeDefinition, WorkflowDefinition } from './types';
import type { NodeRegistry } from './registry';

export interface NodeJobData {
  executionId: string;
  workflowId: string;
  nodeId: string;
  inputData?: any;
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
  private nodeQueueEvents: QueueEvents;
  private workflowQueueEvents: QueueEvents;
  private flowProducer: FlowProducer;
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

    // Initialize queue events for monitoring
    this.nodeQueueEvents = new QueueEvents('node-execution', {
      connection: redisConnection,
    });

    this.workflowQueueEvents = new QueueEvents('workflow-execution', {
      connection: redisConnection,
    });

    // Initialize FlowProducer for managing job flows and dependencies
    this.flowProducer = new FlowProducer({
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

  // Register a workflow definition
  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
  }

  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  // Enqueue a full workflow execution using FlowProducer
  async enqueueWorkflow(workflowId: string, initialData?: any): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const executionId = await this.stateStore.createExecution(workflowId);

    // Build the flow tree structure for BullMQ FlowProducer
    const flowTree = await this.buildFlowTree(workflow, executionId, initialData);

    // Add the flow to BullMQ
    await this.flowProducer.add(flowTree);

    console.log(`🚀 Workflow ${workflowId} enqueued with execution ID: ${executionId}`);
    return executionId;
  }

  // Build a flow tree for FlowProducer based on workflow DAG
  private async buildFlowTree(
    workflow: WorkflowDefinition,
    executionId: string,
    initialData?: any
  ): Promise<any> {
    const nodeMap = new Map<string, NodeDefinition>();
    workflow.nodes.forEach(node => nodeMap.set(node.id, node));

    const buildNodeFlow = (nodeId: string): any => {
      const node = nodeMap.get(nodeId);
      if (!node) return null;

      const jobData: NodeJobData = {
        executionId,
        workflowId: workflow.id,
        nodeId: node.id,
        inputData: nodeId === workflow.entryNodeId ? initialData : undefined,
      };

      // Build children flows recursively
      const children = node.outputs.map(outputId => buildNodeFlow(outputId)).filter(Boolean);

      return {
        name: `node-${nodeId}`,
        queueName: 'node-execution',
        data: jobData,
        opts: {
          jobId: `${executionId}-${nodeId}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
        children: children.length > 0 ? children : undefined,
      };
    };

    // Start with entry node
    return buildNodeFlow(workflow.entryNodeId);
  }

  // Enqueue a single node execution (for manual/direct node execution)
  async enqueueNode(
    executionId: string,
    workflowId: string,
    nodeId: string,
    inputData?: any
  ): Promise<string> {
    const job = await this.nodeQueue.add(
      'run-node',
      { executionId, workflowId, nodeId, inputData },
      {
        jobId: `${executionId}-${nodeId}-manual`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      }
    );

    return job.id!;
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
        return this.processWorkflowJob(job.data, job.id!);
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
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const node = workflow.nodes.find(n => n.id === nodeId);

    if (!node) {
      throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`);
    }

    const executor = this.registry.get(node.type);

    if (!executor) {
      throw new Error(`No executor registered for node type: ${node.type}`);
    }

    // Gather results from upstream nodes (for nodes with dependencies)
    const execution = await this.stateStore.getExecution(executionId);
    const previousResults = execution?.nodeResults || {};

    const context: ExecutionContext = {
      workflowId,
      executionId,
      nodeId,
      inputData,
      previousResults,
    };

    console.log(`▶ Executing node ${nodeId} (type: ${node.type})`);
    await job.updateProgress(50);

    // Execute the node
    const result = await executor.execute(context);

    // Save result to state store
    await this.stateStore.updateNodeResult(executionId, nodeId, result);

    // Check if workflow is complete
    await this.checkWorkflowCompletion(executionId, workflowId);

    return result;
  }

  // Process a full workflow job (legacy, FlowProducer handles this now)
  private async processWorkflowJob(data: WorkflowJobData, executionId: string): Promise<void> {
    const { workflowId, initialData } = data;
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // This is now handled by FlowProducer, but kept for backward compatibility
    console.log(`⚠️  Legacy workflow job - consider using FlowProducer instead`);
    await this.enqueueNode(executionId, workflowId, workflow.entryNodeId, initialData);
  }

  // Check if all nodes in the workflow have completed
  private async checkWorkflowCompletion(executionId: string, workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    const execution = await this.stateStore.getExecution(executionId);

    if (!workflow || !execution) return;

    const allNodesExecuted = workflow.nodes.every(
      node => execution.nodeResults[node.id] !== undefined
    );

    if (allNodesExecuted) {
      const anyFailed = Object.values(execution.nodeResults).some(r => !r.success);
      const newStatus = anyFailed ? 'failed' : 'completed';
      await this.stateStore.setExecutionStatus(executionId, newStatus);

      console.log(`🏁 Workflow ${workflowId} (execution: ${executionId}) ${newStatus}`);
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

  // Graceful shutdown
  async close(): Promise<void> {
    console.log('🛑 Shutting down workflow engine...');

    await this.nodeWorker?.close();
    await this.workflowWorker?.close();
    await this.nodeQueueEvents.close();
    await this.workflowQueueEvents.close();
    await this.flowProducer.close();
    await this.nodeQueue.close();
    await this.workflowQueue.close();
    await this.dlqQueue.close();

    console.log('✓ Workflow engine shutdown complete');
  }
}