/**
 * Runtime Validation Schemas using Zod
 *
 * Provides runtime validation for workflow definitions and related types.
 * Use these to validate user input before processing workflows.
 */

import { z } from 'zod';
import type { WorkflowDefinition, NodeDefinition, SubWorkflowConfig, DelayNodeConfig, RetryPolicy } from '../types';

/**
 * Delay node configuration schema
 */
export const DelayNodeConfigSchema = z.object({
  duration: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  durationMinutes: z.number().nonnegative().optional(),
}).strict();

/**
 * Retry policy schema
 */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().positive().max(100).optional().default(3),
  backoff: z.object({
    type: z.enum(['fixed', 'exponential']),
    delay: z.number().int().positive(),
  }).optional(),
  continueOnFail: z.boolean().optional(),
}).strict();

/**
 * Sub-workflow configuration schema
 */
export const SubWorkflowConfigSchema = z.object({
  workflowId: z.string().min(1),
  inputMapping: z.record(z.string(), z.string()).optional(),
  outputMapping: z.record(z.string(), z.string()).optional(),
  continueOnFail: z.boolean().optional(),
}).strict();

/**
 * Circuit breaker configuration schema
 */
export const CircuitBreakerConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  failureThreshold: z.number().int().positive().optional(),
  successThreshold: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
}).strict();

/**
 * Webhook trigger configuration schema
 */
export const WebhookTriggerConfigSchema = z.object({
  path: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Path must contain only lowercase letters, numbers, and hyphens'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().default('POST'),
}).strict();

/**
 * Schedule trigger configuration schema
 */
export const ScheduleTriggerConfigSchema = z.object({
  cron: z.string().min(1),
  timezone: z.string().optional(),
}).strict();

/**
 * Webhook trigger schema
 */
export const WebhookTriggerSchema = z.object({
  type: z.literal('webhook'),
  config: WebhookTriggerConfigSchema,
}).strict();

/**
 * Schedule trigger schema
 */
export const ScheduleTriggerSchema = z.object({
  type: z.literal('schedule'),
  config: ScheduleTriggerConfigSchema,
}).strict();

/**
 * Union of all trigger types
 */
export const WorkflowTriggerSchema = z.discriminatedUnion('type', [
  WebhookTriggerSchema,
  ScheduleTriggerSchema,
]);

/**
 * Node configuration schema - allows any JSON-serializable value
 */
export const NodeConfigSchema = z.record(z.string(), z.unknown());

/**
 * Node definition schema
 */
export const NodeDefinitionSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1),
  config: NodeConfigSchema.optional(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  retryPolicy: RetryPolicySchema.optional(),
  circuitBreaker: CircuitBreakerConfigSchema.optional(),
});

/**
 * Workflow definition schema
 */
export const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Workflow ID must contain only lowercase letters, numbers, and hyphens'),
  name: z.string().min(1).max(200),
  nodes: z.array(NodeDefinitionSchema).min(1, 'Workflow must have at least one node'),
  entryNodeId: z.string().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  concurrencyLockTTL: z.number().int().positive().optional(),
  triggers: z.array(WorkflowTriggerSchema).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  delay: z.number().int().nonnegative().optional(),
  jobId: z.string().optional(),
});

/**
 * Validation error with details
 */
export class ValidationError extends Error {
  public readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    super(`Validation failed: ${issues.map(i => i.message).join(', ')}`);
    this.name = 'ValidationError';
    this.issues = issues;
  }

  /**
   * Get a formatted error message
   */
  getFormattedErrors(): string {
    return this.issues.map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `  - ${path}: ${issue.message}`;
    }).join('\n');
  }
}

/**
 * Validate a workflow definition at runtime
 *
 * @throws {ValidationError} If the workflow definition is invalid
 * @returns The validated workflow definition
 */
export function validateWorkflowDefinition(data: unknown): z.infer<typeof WorkflowDefinitionSchema> {
  const result = WorkflowDefinitionSchema.safeParse(data);

  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }

  return result.data;
}

/**
 * Validate a workflow definition with detailed error output
 *
 * @returns An object with success status and either the data or error details
 */
export function validateWorkflowDefinitionSafe(data: unknown): {
  success: boolean;
  data?: z.infer<typeof WorkflowDefinitionSchema>;
  errors?: z.ZodIssue[];
} {
  const result = WorkflowDefinitionSchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

/**
 * Validate a node configuration for a specific node type
 */
export function validateNodeConfig<T extends z.ZodType>(schema: T, config: unknown): z.infer<T> {
  const result = schema.safeParse(config);

  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }

  return result.data;
}

/**
 * Common node configuration schemas
 *
 * These are pre-built schemas for common node types.
 * You can use these directly or as a base for custom schemas.
 */
export const CommonNodeSchemas = {
  /**
   * HTTP request node configuration
   */
  httpRequest: z.object({
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
    timeout: z.number().int().positive().optional(),
  }),

  /**
   * Transform/map node configuration
   */
  transform: z.object({
    expression: z.string().optional(),
    mappings: z.record(z.string(), z.string()).optional(),
  }),

  /**
   * Filter/conditional node configuration
   */
  filter: z.object({
    condition: z.string(),
    nextOnTrue: z.string().optional(),
    nextOnFalse: z.string().optional(),
  }),

  /**
   * Email node configuration
   */
  email: z.object({
    to: z.union([z.string(), z.array(z.string())]),
    subject: z.string(),
    body: z.string(),
    from: z.string().email().optional(),
  }),

  /**
   * Database query node configuration
   */
  database: z.object({
    query: z.string(),
    params: z.array(z.unknown()).optional(),
  }),
} satisfies Record<string, z.ZodType>;

/**
 * Helper to create a typed node executor with config validation
 *
 * @example
 * ```typescript
 * const executor = createValidatedExecutor(
 *   'http',
 *   CommonNodeSchemas.httpRequest,
 *   async (context) => {
 *     const { url, method } = context.nodeConfig;
 *     // ... execute HTTP request
 *     return { success: true, data: response };
 *   }
 * );
 * ```
 */
export function createValidatedExecutor<TConfig extends z.ZodType>(
  nodeType: string,
  schema: TConfig,
  handler: (context: import('../types').ExecutionContext<z.infer<TConfig>[any]>) => Promise<import('../types').ExecutionResult>
): import('../types').INodeExecutor {
  return {
    async execute(context) {
      // Validate config
      const validatedConfig = validateNodeConfig(schema, context.nodeConfig);

      // Execute with validated config
      return await handler({
        ...context,
        nodeConfig: validatedConfig as any,
      });
    },
  };
}
