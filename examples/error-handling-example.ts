import { WorkflowEngine } from '../workflow-engine.js';
import { InMemoryExecutionStore } from '../inmemory-store.js';
import { NodeRegistry } from '../registry.js';
import { Redis } from 'ioredis';
import type { WorkflowDefinition, INodeExecutor, ExecutionContext, ExecutionResult } from '../types.js';

// Example node executors for testing error handling
class FailingNodeExecutor implements INodeExecutor {
  constructor(private failCount: number = 1) {}

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const failKey = `fail_${context.executionId}_${context.nodeId}`;
    const currentFailCount = parseInt((globalThis as any)[failKey] || '0');
    
    if (currentFailCount < this.failCount) {
      (globalThis as any)[failKey] = (currentFailCount + 1).toString();
      return {
        success: false,
        error: `Node ${context.nodeId} failed (attempt ${currentFailCount + 1})`,
        retryable: true,
        failureReason: 'error',
      };
    }
    
    return {
      success: true,
      data: { message: `Node ${context.nodeId} succeeded after ${currentFailCount} failures` },
    };
  }
}

class TimeoutNodeExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    // Simulate a long-running operation
    await new Promise(resolve => setTimeout(resolve, 35000)); // 35 seconds
    return {
      success: true,
      data: { message: `Node ${context.nodeId} completed` },
    };
  }
}

class SuccessNodeExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    return {
      success: true,
      data: { message: `Node ${context.nodeId} completed successfully` },
    };
  }
}

async function demonstrateErrorHandling() {
  console.log('🚀 Starting Error Handling Demonstration\n');

  // Setup Redis connection
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  });

  // Setup components
  const stateStore = new InMemoryExecutionStore();
  const registry = new NodeRegistry();

  // Register node executors
  registry.register('failing-node', new FailingNodeExecutor(2)); // Will fail twice, then succeed
  registry.register('timeout-node', new TimeoutNodeExecutor()); // Will timeout
  registry.register('success-node', new SuccessNodeExecutor());

  // Create workflow engine with custom error recovery options
  const engine = new WorkflowEngine(
    registry,
    stateStore,
    redis,
    {
      retryPolicy: {
        maxRetries: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 10000,
      },
      deadLetterQueue: true,
      errorPropagation: true,
      timeoutMs: 30000, // 30 second timeout
    }
  );

  // Create a test workflow with error scenarios
  const workflow: WorkflowDefinition = {
    id: 'error-test-workflow',
    name: 'Error Handling Test Workflow',
    nodes: [
      {
        id: 'start',
        type: 'success-node',
        config: {},
        inputs: [],
        outputs: ['failing-node'],
      },
      {
        id: 'failing-node',
        type: 'failing-node',
        config: {},
        inputs: ['start'],
        outputs: ['dependent-1', 'dependent-2'],
      },
      {
        id: 'dependent-1',
        type: 'success-node',
        config: {},
        inputs: ['failing-node'],
        outputs: ['timeout-node'],
      },
      {
        id: 'dependent-2',
        type: 'success-node',
        config: {},
        inputs: ['failing-node'],
        outputs: [],
      },
      {
        id: 'timeout-node',
        type: 'timeout-node',
        config: {},
        inputs: ['dependent-1'],
        outputs: [],
      },
    ],
    entryNodeId: 'start',
  };

  // Register workflow
  engine.registerWorkflow(workflow);

  // Start workers
  engine.startWorkers(2);

  try {
    console.log('📋 Enqueuing workflow...\n');
    const executionId = await engine.enqueueWorkflow('error-test-workflow', { testData: 'error-demo' });

    // Monitor the execution
    console.log('⏳ Monitoring execution...\n');
    
    let checkCount = 0;
    const maxChecks = 20;
    
    while (checkCount < maxChecks) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const execution = await stateStore.getExecution(executionId);
      const stats = await engine.getQueueStats();
      const failedNodes = await engine.getFailedNodes(executionId);
      const dlqJobs = await engine.getDLQJobs(executionId);
      
      console.log(`📊 Check ${checkCount + 1}:`);
      console.log(`   Status: ${execution?.status}`);
      console.log(`   Failed nodes: ${failedNodes.join(', ') || 'none'}`);
      console.log(`   DLQ jobs: ${dlqJobs.length}`);
      console.log(`   Queue stats:`, JSON.stringify(stats, null, 2));
      console.log('');

      if (execution?.status === 'completed' || execution?.status === 'failed' || execution?.status === 'cancelled') {
        console.log(`🏁 Workflow execution finished with status: ${execution.status}`);
        break;
      }

      checkCount++;
    }

    // Demonstrate retry functionality
    console.log('\n🔄 Demonstrating retry functionality...\n');
    
    const failedNodes = await engine.getFailedNodes(executionId);
    if (failedNodes.length > 0) {
      const nodeIdToRetry = failedNodes[0];
      if (nodeIdToRetry) {
        console.log(`Retrying failed node: ${nodeIdToRetry}`);
        
        const retrySuccess = await engine.retryFailedNode(executionId, nodeIdToRetry);
        console.log(`Retry ${retrySuccess ? 'succeeded' : 'failed'}`);
        
        // Wait a bit and check status again
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      const finalExecution = await stateStore.getExecution(executionId);
      console.log(`Final execution status: ${finalExecution?.status}`);
    }

    // Show final DLQ contents
    console.log('\n📨 Final DLQ contents:\n');
    const finalDLQJobs = await engine.getDLQJobs(executionId);
    for (const job of finalDLQJobs) {
      console.log(`- Node ${job.nodeId}: ${job.failureReason} (${job.failureCount} failures)`);
    }

  } catch (error) {
    console.error('❌ Error during demonstration:', error);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await engine.close();
    await redis.quit();
    console.log('✅ Demonstration complete');
  }
}

// Run the demonstration
if (import.meta.main) {
  demonstrateErrorHandling().catch(console.error);
}
