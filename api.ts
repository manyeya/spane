import { Elysia } from 'elysia';
import type { WorkflowEngine } from './engine/workflow-engine';
import type { IExecutionStateStore, WorkflowDefinition } from './types';
import type { HealthMonitor } from './utils/health';
import type { MetricsCollector } from './utils/metrics';
import type { CircuitBreakerRegistry } from './utils/circuit-breaker';
import type { GracefulShutdown } from './utils/graceful-shutdown';

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

    // ============================================================================
    // DURABILITY & RELIABILITY ENDPOINTS
    // ============================================================================

    // Get all workflows
    this.app.get('/api/workflows', async ({ set }) => {
      try {
        const workflows = this.engine.getAllWorkflows();
        return {
          success: true,
          workflows: Array.from(workflows.values()),
          count: workflows.size,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Get workflow version history
    this.app.get('/api/workflows/:workflowId/versions', async ({ params, set }) => {
      try {
        const { workflowId } = params;

        if ('getWorkflowVersions' in this.stateStore) {
          const versions = await (this.stateStore as any).getWorkflowVersions(workflowId);
          return {
            success: true,
            versions,
          };
        }

        set.status = 501;
        return {
          success: false,
          error: 'Workflow versioning not supported with current state store',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Get specific workflow version
    this.app.get('/api/workflows/:workflowId/versions/:version', async ({ params, set }) => {
      try {
        const { workflowId, version } = params;
        const workflow = await this.engine.getWorkflowFromDatabase(workflowId, parseInt(version));

        if (!workflow) {
          set.status = 404;
          return {
            success: false,
            error: 'Workflow version not found',
          };
        }

        return {
          success: true,
          workflow,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // System health (new HealthMonitor)
    this.app.get('/api/health', async ({ set }) => {
      try {
        // Try to get health from new HealthMonitor in engine
        if ('healthMonitor' in this.engine && (this.engine as any).healthMonitor) {
          const healthMonitor = (this.engine as any).healthMonitor;
          const health = healthMonitor.getLastHealthStatus();

          if (health) {
            if (health.overall === 'unhealthy') {
              set.status = 503;
            }
            return {
              success: true,
              ...health,
            };
          }
        }

        // Fallback to basic health check
        return {
          success: true,
          overall: 'healthy',
          timestamp: new Date(),
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Timeout management
    this.app.post('/api/executions/:executionId/timeout', async ({ params, body, set }) => {
      try {
        const { executionId } = params;
        const { timeoutMs } = body as any;

        if (!timeoutMs || timeoutMs <= 0) {
          set.status = 400;
          return {
            success: false,
            error: 'timeoutMs must be a positive number',
          };
        }

        if ('timeoutMonitor' in this.engine && (this.engine as any).timeoutMonitor) {
          const timeoutMonitor = (this.engine as any).timeoutMonitor;
          await timeoutMonitor.setExecutionTimeout(executionId, timeoutMs);

          return {
            success: true,
            message: `Timeout set for execution ${executionId}`,
            timeoutAt: new Date(Date.now() + timeoutMs),
          };
        }

        set.status = 501;
        return {
          success: false,
          error: 'Timeout monitoring not available',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // DLQ operations
    this.app.get('/api/dlq', async ({ query, set }) => {
      try {
        const start = parseInt(query.start as string || '0');
        const end = parseInt(query.end as string || '10');

        const items = await this.engine.getDLQItems(start, end);

        return {
          success: true,
          items,
          count: items.length,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Retry DLQ item
    this.app.post('/api/dlq/:dlqJobId/retry', async ({ params, set }) => {
      try {
        const { dlqJobId } = params;
        const success = await this.engine.retryDLQItem(dlqJobId);

        if (!success) {
          set.status = 404;
          return {
            success: false,
            error: 'DLQ item not found',
          };
        }

        return {
          success: true,
          message: 'DLQ item retried',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Pause workflow execution
    this.app.post('/api/executions/:executionId/pause', async ({ params, set }) => {
      try {
        const { executionId } = params;
        await this.engine.pauseWorkflow(executionId);

        return {
          success: true,
          message: 'Workflow paused',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Resume workflow execution
    this.app.post('/api/executions/:executionId/resume', async ({ params, set }) => {
      try {
        const { executionId } = params;
        await this.engine.resumeWorkflow(executionId);

        return {
          success: true,
          message: 'Workflow resumed',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Cancel workflow execution
    this.app.post('/api/executions/:executionId/cancel', async ({ params, set }) => {
      try {
        const { executionId } = params;
        await this.engine.cancelWorkflow(executionId);

        return {
          success: true,
          message: 'Workflow cancelled',
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
        };
      }
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
