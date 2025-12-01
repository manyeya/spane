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

export class WorkflowEngine {
  private nodeQueue: Queue<NodeJobData>;
  private workflowQueue: Queue<WorkflowJobData>;
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

    this.nodeQueueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`✗ Node job ${jobId} failed:`, failedReason);
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

    this.nodeWorker.on('failed', (job, err) => {
      console.error(`✗ Node worker failed job ${job?.id}:`, err.message);
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
    
    console.log('✓ Workflow engine shutdown complete');
  }
}