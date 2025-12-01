import { Queue, Worker, Job, QueueEvents, FlowProducer } from 'bullmq';
import { Redis } from 'ioredis';
import type { ExecutionContext, ExecutionResult, IExecutionStateStore, NodeDefinition, WorkflowDefinition, ErrorRecoveryOptions, DLQJobData, NodeJobData, WorkflowJobData } from './types';
import type { NodeRegistry } from './registry';
import { DeadLetterQueueManager } from './dead-letter-queue';

export class WorkflowEngine {
  private nodeQueue: Queue<NodeJobData>;
  private workflowQueue: Queue<WorkflowJobData>;
  private nodeQueueEvents: QueueEvents;
  private workflowQueueEvents: QueueEvents;
  private flowProducer: FlowProducer;
  private nodeWorker?: Worker<NodeJobData>;
  private workflowWorker?: Worker<WorkflowJobData>;
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private dlqManager: DeadLetterQueueManager;
  private errorRecoveryOptions: ErrorRecoveryOptions;

  constructor(
    private registry: NodeRegistry,
    private stateStore: IExecutionStateStore,
    private redisConnection: Redis,
    errorRecoveryOptions?: Partial<ErrorRecoveryOptions>
  ) {
    // Set default error recovery options
    this.errorRecoveryOptions = {
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 30000,
      },
      deadLetterQueue: true,
      errorPropagation: true,
      timeoutMs: 30000,
      ...errorRecoveryOptions,
    };

    // Initialize queues
    this.nodeQueue = new Queue<NodeJobData>('node-execution', {
      connection: redisConnection,
    });

    this.workflowQueue = new Queue<WorkflowJobData>('workflow-execution', {
      connection: redisConnection,
    });

    // Initialize DLQ manager
    this.dlqManager = new DeadLetterQueueManager(
      this.redisConnection,
      this.errorRecoveryOptions.retryPolicy,
      this.nodeQueue
    );

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
      await this.handleNodeFailure(jobId, failedReason);
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
          attempts: 1, // Let our error recovery system handle retries
          // removeOnFail: true, // Let DLQ handle failed jobs
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

    // Execute the node with timeout handling
    let result: ExecutionResult;
    
    try {
      if (this.errorRecoveryOptions.timeoutMs) {
        result = await this.executeWithTimeout(
          () => executor.execute(context),
          this.errorRecoveryOptions.timeoutMs,
          nodeId
        );
      } else {
        result = await executor.execute(context);
      }

      // Ensure result has required fields
      if (!result.hasOwnProperty('success')) {
        result = { ...result, success: true };
      }

      if (!result.hasOwnProperty('retryable')) {
        result.retryable = true;
      }

      // If the node execution failed, throw an error to trigger BullMQ failure handling
      if (!result.success) {
        const error = new Error(result.error || `Node ${nodeId} execution failed`);
        (error as any).nodeResult = result; // Attach result for error handler
        throw error;
      }

    } catch (error) {
      // If this is a timeout or other execution error, create failure result
      if (!(error as any).nodeResult) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: true,
          failureReason: 'error',
        };
        (error as any).nodeResult = result;
      }
      throw error; // Re-throw to trigger BullMQ failure handling
    }

    // Save result to state store
    await this.stateStore.updateNodeResult(executionId, nodeId, result);

    // Check if workflow is complete
    await this.checkWorkflowCompletion(executionId, workflowId);

    return result;
  }

  /**
   * Execute a function with timeout.
   *
   * IMPORTANT: This method rejects on timeout but does NOT cancel the underlying operation.
   * The operation (fn) will continue running in the background, potentially causing resource leaks.
   *
   * To properly support cancellation, the INodeExecutor interface would need to be updated
   * to accept an AbortSignal, but this would be a breaking change for existing implementations.
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    nodeId: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`Node ${nodeId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Note: fn() is called without the AbortSignal since the interface doesn't support it yet.
      // This means the underlying operation cannot be cancelled, only the timeout promise rejects.
      fn()
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
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

    const dlqStats = await this.dlqManager.getDLQStats();

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
      deadLetterQueue: dlqStats,
    };
  }

  // Handle node failure with error recovery
  private async handleNodeFailure(jobId: string, failedReason: string): Promise<void> {
    try {
      const job = await this.nodeQueue.getJob(jobId);
      if (!job) return;

      const jobData = job.data as NodeJobData;
      const { executionId, workflowId, nodeId } = jobData;

      console.log(`🔍 Handling failure for node ${nodeId} in execution ${executionId}`);

      // Extract node result from error if available
      let nodeResult: ExecutionResult | undefined;
      if (job.failedReason) {
        try {
          const error = new Error(job.failedReason);
          nodeResult = (error as any).nodeResult;
        } catch (e) {
          // Ignore parsing errors
        }
      }

      // If no node result attached, create a default failure result
      if (!nodeResult) {
        nodeResult = {
          success: false,
          error: failedReason,
          retryable: true,
          failureReason: 'error',
        };
      }

      // Save the failure result to state store
      await this.stateStore.updateNodeResult(executionId, nodeId, nodeResult);

      // Get current failure count from state store
      const currentFailureCount = await this.stateStore.getRetryCount(executionId);
      const failureCount = currentFailureCount + 1;

      // Update failure count
      await this.stateStore.setRetryCount(executionId, failureCount);

      // Check if we should add to DLQ
      if (failureCount >= this.errorRecoveryOptions.retryPolicy.maxRetries) {
        console.log(`📨 Adding node ${nodeId} to DLQ after ${failureCount} failures`);

        const dlqJobData: DLQJobData = {
          executionId,
          workflowId,
          nodeId,
          originalJobData: jobData,
          failureReason: failedReason,
          failureCount,
          lastFailedAt: new Date(),
          errorDetails: { jobId, failedReason },
        };

        await this.dlqManager.addToDLQ(dlqJobData);

        // Propagate error to dependent nodes if enabled
        if (this.errorRecoveryOptions.errorPropagation) {
          await this.propagateErrorToDependents(executionId, workflowId, nodeId);
        }
      } else {
        // Calculate retry delay and re-queue the job
        const delay = this.calculateRetryDelay(failureCount - 1);
        console.log(`🔄 Re-queuing node ${nodeId} for retry ${failureCount}/${this.errorRecoveryOptions.retryPolicy.maxRetries} after ${delay}ms delay`);

        await this.nodeQueue.add(
          'run-node',
          jobData,
          {
            jobId: `${executionId}-${nodeId}-retry-${failureCount}`,
            delay,
            attempts: 1,
          }
        );
      }

      // Check if workflow is complete
      await this.checkWorkflowCompletion(executionId, workflowId);

    } catch (error) {
      console.error(`❌ Error handling node failure for job ${jobId}:`, error);
    }
  }

  // Calculate retry delay based on policy
  private calculateRetryDelay(failureCount: number): number {
    const { baseDelay, maxDelay, backoffStrategy } = this.errorRecoveryOptions.retryPolicy;
    
    let delay: number;
    
    switch (backoffStrategy) {
      case 'exponential':
        delay = baseDelay * Math.pow(2, failureCount);
        break;
      case 'linear':
        delay = baseDelay * (failureCount + 1);
        break;
      case 'fixed':
      default:
        delay = baseDelay;
        break;
    }
    
    return maxDelay ? Math.min(delay, maxDelay) : delay;
  }

  // Propagate error to dependent nodes in the DAG
  private async propagateErrorToDependents(executionId: string, workflowId: string, failedNodeId: string): Promise<void> {
    try {
      const workflow = this.workflows.get(workflowId);
      if (!workflow) return;

      const failedNode = workflow.nodes.find(n => n.id === failedNodeId);
      if (!failedNode) return;

      // Get all dependent nodes (nodes that have this failed node as input)
      const dependentNodes = workflow.nodes.filter(node => 
        node.inputs.includes(failedNodeId)
      );

      if (dependentNodes.length === 0) return;

      console.log(`🔗 Propagating error from ${failedNodeId} to ${dependentNodes.length} dependent nodes`);

      // Mark dependent nodes as failed due to dependency failure
      for (const dependentNode of dependentNodes) {
        const failedResult: ExecutionResult = {
          success: false,
          error: `Dependency node ${failedNodeId} failed`,
          failureReason: 'dependency_failed',
          retryable: false,
        };

        await this.stateStore.updateNodeResult(executionId, dependentNode.id, failedResult);
        console.log(`🚫 Marked dependent node ${dependentNode.id} as failed due to dependency failure`);
      }

      // Store error propagation mapping
      const dependentIds = dependentNodes.map(n => n.id);
      await this.stateStore.setErrorPropagation(executionId, failedNodeId, dependentIds);

      // Check if workflow should be marked as failed
      await this.checkWorkflowCompletion(executionId, workflowId);

    } catch (error) {
      console.error(`❌ Error propagating failure from node ${failedNodeId}:`, error);
    }
  }

  // Retry a failed node from DLQ
  async retryFailedNode(executionId: string, nodeId: string): Promise<boolean> {
    try {
      console.log(`🔄 Attempting to retry failed node ${nodeId} in execution ${executionId}`);

      // First try to retry from DLQ
      const dlqRetrySuccess = await this.dlqManager.retryFromDLQ(executionId, nodeId);

      if (dlqRetrySuccess) {
        // Clear the node result from state store - set pending sentinel instead of success
        const pendingResult: ExecutionResult = {
          success: false,
          pending: true,
          retryable: true,
        };
        await this.stateStore.updateNodeResult(executionId, nodeId, pendingResult);

        // Reset execution status to running
        await this.stateStore.setExecutionStatus(executionId, 'running');

        console.log(`✓ Successfully initiated retry for node ${nodeId}`);
        return true;
      }

      console.log(`❌ Failed to retry node ${nodeId} - not found in DLQ or max retries exceeded`);
      return false;

    } catch (error) {
      console.error(`❌ Error retrying node ${nodeId}:`, error);
      return false;
    }
  }

  // Get all failed nodes for an execution
  async getFailedNodes(executionId: string): Promise<string[]> {
    return await this.stateStore.getFailedNodes(executionId);
  }

  // Get DLQ jobs for monitoring
  async getDLQJobs(executionId?: string): Promise<DLQJobData[]> {
    return await this.dlqManager.getDLQJobs(executionId);
  }

  // Cancel a running workflow
  async cancelWorkflow(executionId: string): Promise<boolean> {
    try {
      console.log(`🛑 Attempting to cancel workflow execution ${executionId}`);

      // Get the execution
      const execution = await this.stateStore.getExecution(executionId);
      if (!execution) {
        console.log(`❌ Execution ${executionId} not found`);
        return false;
      }

      // Mark execution as cancelled
      await this.stateStore.setExecutionStatus(executionId, 'cancelled');

      // Remove any pending jobs for this execution
      const jobs = await this.nodeQueue.getJobs(['waiting', 'active']);
      let cancelledCount = 0;

      for (const job of jobs) {
        if (job.data.executionId === executionId) {
          await job.remove();
          cancelledCount++;
        }
      }

      console.log(`✓ Cancelled ${cancelledCount} pending jobs for execution ${executionId}`);
      return true;

    } catch (error) {
      console.error(`❌ Error cancelling workflow execution ${executionId}:`, error);
      return false;
    }
  }

  // Graceful shutdown
  async close(): Promise<void> {
    console.log('🛑 Shutting down workflow engine...');
    
    await this.nodeWorker?.close();
    await this.workflowWorker?.close();
    await this.nodeQueueEvents.close();
    await this.workflowQueueEvents.close();
    await this.flowProducer.close();
    await this.dlqManager.close();
    await this.nodeQueue.close();
    await this.workflowQueue.close();
    
    console.log('✓ Workflow engine shutdown complete');
  }
}
