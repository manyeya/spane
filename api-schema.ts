

// ============================================================================
// API SCHEMAS FOR WORKFLOW ENGINE
// ============================================================================

import { t } from "elysia";

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

export const ErrorResponseSchema = t.Object({
  success: t.Literal(false),
  error: t.String(),
  code: t.Optional(t.String()),
});

export const SuccessResponseSchema = t.Object({
  success: t.Literal(true),
  message: t.Optional(t.String()),
});

// ============================================================================
// WORKFLOW SCHEMAS
// ============================================================================

export const NodeDefinitionSchema = t.Object({
  id: t.String(),
  type: t.String(),
  config: t.Record(t.String(), t.Any()),
  inputs: t.Array(t.String()),
  outputs: t.Array(t.String()),
});

export const WorkflowTriggerSchema = t.Union([
  t.Object({
    type: t.Literal('webhook'),
    config: t.Object({
      path: t.String(),
      method: t.Optional(t.Union([
        t.Literal('GET'),
        t.Literal('POST'),
        t.Literal('PUT'),
        t.Literal('DELETE')
      ])),
    }),
  }),
  t.Object({
    type: t.Literal('schedule'),
    config: t.Object({
      cron: t.String(),
      timezone: t.Optional(t.String()),
    }),
  }),
]);

export const WorkflowDefinitionSchema = t.Object({
  id: t.String(),
  name: t.String(),
  nodes: t.Array(NodeDefinitionSchema),
  entryNodeId: t.String(),
  maxConcurrency: t.Optional(t.Number()),
  concurrencyLockTTL: t.Optional(t.Number()),
  triggers: t.Optional(t.Array(WorkflowTriggerSchema)),
  priority: t.Optional(t.Number()),
  delay: t.Optional(t.Number()),
  jobId: t.Optional(t.String()),
});

export const WorkflowRegistrationRequestSchema = t.Object({
  workflow: WorkflowDefinitionSchema,
});

export const WorkflowResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    workflow: WorkflowDefinitionSchema,
  }),
  ErrorResponseSchema,
]);

export const WorkflowListResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    workflows: t.Array(WorkflowDefinitionSchema),
    count: t.Number(),
  }),
  ErrorResponseSchema,
]);

// ============================================================================
// EXECUTION SCHEMAS
// ============================================================================

export const ExecutionContextSchema = t.Object({
  workflowId: t.String(),
  executionId: t.String(),
  nodeId: t.String(),
  inputData: t.Any(),
  nodeConfig: t.Optional(t.Record(t.String(), t.Any())),
  previousResults: t.Record(t.String(), t.Any()),
  parentExecutionId: t.Optional(t.String()),
  depth: t.Number(),
});

export const ExecutionResultSchema = t.Object({
  success: t.Boolean(),
  data: t.Optional(t.Any()),
  error: t.Optional(t.String()),
  nextNodes: t.Optional(t.Array(t.String())),
  skipped: t.Optional(t.Boolean()),
});

export const ExecutionStateSchema = t.Object({
  executionId: t.String(),
  workflowId: t.String(),
  status: t.Union([
    t.Literal('running'),
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('cancelled'),
    t.Literal('paused'),
  ]),
  nodeResults: t.Record(t.String(), ExecutionResultSchema),
  startedAt: t.String(),
  completedAt: t.Optional(t.String()),
  parentExecutionId: t.Optional(t.String()),
  depth: t.Number(),
  initialData: t.Optional(t.Any()),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});

export const WorkflowExecutionRequestSchema = t.Object({
  initialData: t.Optional(t.Any()),
});

export const WorkflowExecutionResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    executionId: t.String(),
    message: t.String(),
  }),
  ErrorResponseSchema,
]);

export const NodeExecutionRequestSchema = t.Object({
  executionId: t.String(),
  inputData: t.Optional(t.Any()),
});

export const NodeExecutionResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    jobId: t.String(),
    message: t.String(),
  }),
  ErrorResponseSchema,
]);

export const ExecutionStatusResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    execution: ExecutionStateSchema,
  }),
  ErrorResponseSchema,
]);

// ============================================================================
// QUEUE & STATISTICS SCHEMAS
// ============================================================================

export const QueueStatsSchema = t.Object({
  active: t.Number(),
  waiting: t.Number(),
  completed: t.Number(),
  failed: t.Number(),
  delayed: t.Number(),
});

export const QueueStatsResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    stats: QueueStatsSchema,
  }),
  ErrorResponseSchema,
]);

// ============================================================================
// HEALTH & MONITORING SCHEMAS
// ============================================================================

export const HealthStatusSchema = t.Union([
  t.Object({
    status: t.Literal('ok'),
    timestamp: t.String(),
  }),
  t.Object({
    status: t.Union([t.Literal('degraded'), t.Literal('unhealthy')]),
    timestamp: t.Union([t.String(), t.Number()]),
    services: t.Optional(t.Record(t.String(), t.String())),
    error: t.Optional(t.String()),
  }),
]);

export const LivenessProbeSchema = t.Object({
  alive: t.Boolean(),
});

export const ReadinessProbeSchema = t.Object({
  ready: t.Boolean(),
  reason: t.Optional(t.String()),
});

export const CircuitBreakerStatsSchema = t.Object({
  name: t.String(),
  state: t.Union([
    t.Literal('closed'),
    t.Literal('open'),
    t.Literal('half-open'),
  ]),
  failureCount: t.Number(),
  lastFailureTime: t.Optional(t.String()),
  nextRetry: t.Optional(t.String()),
});

export const CircuitBreakersResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    breakers: t.Array(CircuitBreakerStatsSchema),
  }),
  t.Object({
    error: t.String(),
  }),
]);

export const CircuitBreakerResetRequestSchema = t.Object({});

export const CircuitBreakerResetResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    message: t.String(),
  }),
  ErrorResponseSchema,
]);

export const ShutdownStatusSchema = t.Object({
  shutdownInProgress: t.Boolean(),
});

// ============================================================================
// DLQ (DEAD LETTER QUEUE) SCHEMAS
// ============================================================================

export const DLQItemSchema = t.Object({
  id: t.String(),
  jobId: t.String(),
  workflowId: t.String(),
  executionId: t.String(),
  nodeId: t.String(),
  error: t.String(),
  failedAt: t.String(),
  retryCount: t.Number(),
  data: t.Any(),
});

export const DLQListRequestSchema = t.Object({
  start: t.Optional(t.Number()),
  end: t.Optional(t.Number()),
});

export const DLQListResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    items: t.Array(DLQItemSchema),
    count: t.Number(),
  }),
  ErrorResponseSchema,
]);

export const DLQRetryRequestSchema = t.Object({});

export const DLQRetryResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    message: t.String(),
  }),
  ErrorResponseSchema,
]);

// ============================================================================
// WORKFLOW CONTROL SCHEMAS
// ============================================================================

export const WorkflowControlRequestSchema = t.Object({});

export const WorkflowControlResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    message: t.String(),
  }),
  ErrorResponseSchema,
]);

export const TimeoutRequestSchema = t.Object({
  timeoutMs: t.Number({ minimum: 1 }),
});

export const TimeoutResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    message: t.String(),
    timeoutAt: t.String(),
  }),
  ErrorResponseSchema,
]);

// ============================================================================
// WEBHOOK SCHEMAS
// ============================================================================

export const WebhookRequestSchema = t.Object({
  path: t.String(),
  method: t.String(),
  data: t.Any(),
});

export const WebhookResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    executionIds: t.Array(t.String()),
    message: t.String(),
  }),
  ErrorResponseSchema,
]);

// ============================================================================
// METRICS SCHEMAS
// ============================================================================

export const MetricsJsonResponseSchema = t.Union([
  t.Object({
    success: t.Literal(true),
    metrics: t.Record(t.String(), t.Any()),
  }),
  t.Object({
    error: t.String(),
  }),
]);

// ============================================================================
// API DOCUMENTATION METADATA
// ============================================================================

export const APIMetadataSchema = t.Object({
  title: t.String(),
  version: t.String(),
  description: t.String(),
  contact: t.Object({
    name: t.String(),
    email: t.String(),
  }),
  server: t.String(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

// export type ErrorResponse = t.Infer<typeof ErrorResponseSchema>;
// export type SuccessResponse = t.Infer<typeof SuccessResponseSchema>;
// export type NodeDefinition = t.Infer<typeof NodeDefinitionSchema>;
// export type WorkflowDefinition = t.Infer<typeof WorkflowDefinitionSchema>;
// export type WorkflowRegistrationRequest = t.Infer<typeof WorkflowRegistrationRequestSchema>;
// export type WorkflowResponse = t.Infer<typeof WorkflowResponseSchema>;
// export type WorkflowListResponse = t.Infer<typeof WorkflowListResponseSchema>;
// export type ExecutionContext = t.Infer<typeof ExecutionContextSchema>;
// export type ExecutionResult = t.Infer<typeof ExecutionResultSchema>;
// export type ExecutionState = t.Infer<typeof ExecutionStateSchema>;
// export type WorkflowExecutionRequest = t.Infer<typeof WorkflowExecutionRequestSchema>;
// export type WorkflowExecutionResponse = t.Infer<typeof WorkflowExecutionResponseSchema>;
// export type NodeExecutionRequest = t.Infer<typeof NodeExecutionRequestSchema>;
// export type NodeExecutionResponse = t.Infer<typeof NodeExecutionResponseSchema>;
// export type ExecutionStatusResponse = t.Infer<typeof ExecutionStatusResponseSchema>;
// export type QueueStats = t.Infer<typeof QueueStatsSchema>;
// export type QueueStatsResponse = t.Infer<typeof QueueStatsResponseSchema>;
// export type HealthStatus = t.Infer<typeof HealthStatusSchema>;
// export type LivenessProbe = t.Infer<typeof LivenessProbeSchema>;
// export type ReadinessProbe = t.Infer<typeof ReadinessProbeSchema>;
// export type CircuitBreakerStats = t.Infer<typeof CircuitBreakerStatsSchema>;
// export type CircuitBreakersResponse = t.Infer<typeof CircuitBreakersResponseSchema>;
// export type CircuitBreakerResetRequest = t.Infer<typeof CircuitBreakerResetRequestSchema>;
// export type CircuitBreakerResetResponse = t.Infer<typeof CircuitBreakerResetResponseSchema>;
// export type ShutdownStatus = t.Infer<typeof ShutdownStatusSchema>;
// export type DLQItem = t.Infer<typeof DLQItemSchema>;
// export type DLQListRequest = t.Infer<typeof DLQListRequestSchema>;
// export type DLQListResponse = t.Infer<typeof DLQListResponseSchema>;
// export type DLQRetryRequest = t.Infer<typeof DLQRetryRequestSchema>;
// export type DLQRetryResponse = t.Infer<typeof DLQRetryResponseSchema>;
// export type WorkflowControlRequest = t.Infer<typeof WorkflowControlRequestSchema>;
// export type WorkflowControlResponse = t.Infer<typeof WorkflowControlResponseSchema>;
// export type TimeoutRequest = t.Infer<typeof TimeoutRequestSchema>;
// export type TimeoutResponse = t.Infer<typeof TimeoutResponseSchema>;
// export type WebhookRequest = t.Infer<typeof WebhookRequestSchema>;
// export type WebhookResponse = t.Infer<typeof WebhookResponseSchema>;
// export type MetricsJsonResponse = t.Infer<typeof MetricsJsonResponseSchema>;
// export type APIMetadata = t.Infer<typeof APIMetadataSchema>;
