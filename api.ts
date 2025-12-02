import { Elysia } from 'elysia';
import type { WorkflowEngine } from './workflow-engine';
import type { IExecutionStateStore, WorkflowDefinition } from './types';
import type { HealthMonitor } from './health';
import type { MetricsCollector } from './metrics';
import type { CircuitBreakerRegistry } from './circuit-breaker';
import type { GracefulShutdown } from './graceful-shutdown';

export class WorkflowAPIController {
  private app = new Elysia();

  constructor(
    private engine: WorkflowEngine,
    private stateStore: IExecutionStateStore,
    private healthMonitor?: HealthMonitor,
    private metricsCollector?: MetricsCollector,
    private circuitBreakerRegistry?: CircuitBreakerRegistry,
    private gracefulShutdown?: GracefulShutdown
  ) {
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
    this.app.post('/api/workflows', async ({ body, set }) => {
      try {
        const workflow = body as WorkflowDefinition;
        await this.engine.registerWorkflow(workflow);

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

    // Production Operations Endpoints

    // Health check (detailed)
    this.app.get('/health', async ({ set }) => {
      if (!this.healthMonitor) {
        return { status: 'ok', timestamp: new Date().toISOString() };
      }

      try {
        const health = await this.healthMonitor.getHealth();

        if (health.status === 'unhealthy') {
          set.status = 503;
        } else if (health.status === 'degraded') {
          set.status = 200; // Still return 200 for degraded
        }

        return health;
      } catch (error: any) {
        set.status = 503;
        return {
          status: 'unhealthy',
          timestamp: Date.now(),
          error: error.message,
        };
      }
    });

    // Liveness probe (for Kubernetes)
    this.app.get('/health/live', async ({ set }) => {
      if (!this.healthMonitor) {
        return { alive: true };
      }

      try {
        const liveness = await this.healthMonitor.getLiveness();
        return liveness;
      } catch (error: any) {
        set.status = 503;
        return { alive: false, error: error.message };
      }
    });

    // Readiness probe (for Kubernetes)
    this.app.get('/health/ready', async ({ set }) => {
      if (!this.healthMonitor) {
        return { ready: true };
      }

      try {
        const readiness = await this.healthMonitor.getReadiness();

        if (!readiness.ready) {
          set.status = 503;
        }

        return readiness;
      } catch (error: any) {
        set.status = 503;
        return { ready: false, reason: error.message };
      }
    });

    // Metrics endpoint (Prometheus format)
    this.app.get('/metrics', async ({ set }) => {
      if (!this.metricsCollector) {
        set.status = 404;
        return 'Metrics not enabled';
      }

      try {
        // Update queue metrics before exporting
        await this.metricsCollector.updateQueueMetrics();

        set.headers['Content-Type'] = 'text/plain; version=0.0.4';
        return this.metricsCollector.toPrometheus();
      } catch (error: any) {
        set.status = 500;
        return `# Error generating metrics: ${error.message}`;
      }
    });

    // Metrics endpoint (JSON format)
    this.app.get('/metrics/json', async ({ set }) => {
      if (!this.metricsCollector) {
        set.status = 404;
        return { error: 'Metrics not enabled' };
      }

      try {
        // Update queue metrics before exporting
        await this.metricsCollector.updateQueueMetrics();

        return {
          success: true,
          metrics: this.metricsCollector.toJSON(),
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Circuit breaker status
    this.app.get('/circuit-breakers', ({ set }) => {
      if (!this.circuitBreakerRegistry) {
        set.status = 404;
        return { error: 'Circuit breakers not enabled' };
      }

      return {
        success: true,
        breakers: this.circuitBreakerRegistry.getAllStats(),
      };
    });

    // Reset circuit breaker
    this.app.post('/circuit-breakers/:name/reset', ({ params, set }) => {
      if (!this.circuitBreakerRegistry) {
        set.status = 404;
        return { error: 'Circuit breakers not enabled' };
      }

      const { name } = params;
      const success = this.circuitBreakerRegistry.reset(name);

      if (!success) {
        set.status = 404;
        return {
          success: false,
          error: `Circuit breaker '${name}' not found`,
        };
      }

      return {
        success: true,
        message: `Circuit breaker '${name}' reset`,
      };
    });

    // Shutdown status
    this.app.get('/shutdown/status', () => {
      if (!this.gracefulShutdown) {
        return { shutdownInProgress: false };
      }

      return {
        shutdownInProgress: this.gracefulShutdown.isShutdownInProgress(),
      };
    });


    // Webhook endpoint (supports multi-segment paths like /foo/bar)
    this.app.all('/api/webhooks/*', async ({ params, body, request, set }) => {
      try {
        const path = params['*'] || '';
        const method = request.method;
        const data = body || {};

        const executionIds = await this.engine.triggerWebhook(path, method, data);

        if (executionIds.length === 0) {
          set.status = 404;
          return {
            success: false,
            error: `No workflow registered for webhook path: ${path}`,
          };
        }

        return {
          success: true,
          executionIds,
          message: `Triggered ${executionIds.length} workflow(s)`,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
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
