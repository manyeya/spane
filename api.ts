import { Elysia } from 'elysia';
import type { WorkflowEngine } from './workflow-engine';
import type { IExecutionStateStore, WorkflowDefinition } from './types';

export class WorkflowAPIController {
  private app = new Elysia();

  constructor(private engine: WorkflowEngine, private stateStore: IExecutionStateStore) {
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Start a full workflow execution
    this.app.post('/api/workflows/:workflowId/execute', async ({ params, body, set }) => {
      try {
        const { workflowId } = params;
        const { initialData } = body as any;

        const executionId = await this.engine.enqueueWorkflow(workflowId, initialData);

        return {
          success: true,
          executionId,
          message: 'Workflow execution enqueued',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Execute a single node
    this.app.post('/api/workflows/:workflowId/nodes/:nodeId/execute', async ({ params, body, set }) => {
      try {
        const { workflowId, nodeId } = params;
        const { executionId, inputData } = body as any;

        if (!executionId) {
          set.status = 400;
          return {
            success: false,
            error: 'executionId is required',
          };
        }

        const jobId = await this.engine.enqueueNode(executionId, workflowId, nodeId, inputData);

        return {
          success: true,
          jobId,
          message: 'Node execution enqueued',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Register a new workflow
    this.app.post('/api/workflows', ({ body, set }) => {
      try {
        const workflow = body as WorkflowDefinition;
        this.engine.registerWorkflow(workflow);

        return {
          success: true,
          message: 'Workflow registered',
          workflowId: workflow.id,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Get workflow definition
    this.app.get('/api/workflows/:workflowId', ({ params, set }) => {
      const { workflowId } = params;
      const workflow = this.engine.getWorkflow(workflowId);

      if (!workflow) {
        set.status = 404;
        return {
          success: false,
          error: 'Workflow not found',
        };
      }

      return {
        success: true,
        workflow,
      };
    });

    // Get execution status
    this.app.get('/api/executions/:executionId', async ({ params, set }) => {
      try {
        const { executionId } = params;
        const execution = await this.stateStore.getExecution(executionId);

        if (!execution) {
          set.status = 404;
          return {
            success: false,
            error: 'Execution not found',
          };
        }

        return {
          success: true,
          execution,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Get queue statistics
    this.app.get('/api/stats', async ({ set }) => {
      try {
        const stats = await this.engine.getQueueStats();
        return {
          success: true,
          stats,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Health check
    this.app.get('/health', () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });
  }

  listen(port: number): void {
    this.app.listen(port);
    console.log(`📡 Workflow API listening on port ${port}`);
  }

  getApp(): Elysia {
    return this.app;
  }
}
