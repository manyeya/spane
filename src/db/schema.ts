import { pgTable, text, timestamp, jsonb, integer, bigint, boolean, index, foreignKey } from 'drizzle-orm/pg-core';

// Workflows table - stores workflow definitions
export const workflows = pgTable('workflows', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  workflowId: text('workflow_id').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  currentVersionId: integer('current_version_id'),
}, (table) => [
  index('workflows_workflow_id_idx').on(table.workflowId),
  index('workflows_is_active_idx').on(table.isActive),
]);

// Workflow versions table - supports versioning
export const workflowVersions = pgTable('workflow_versions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  workflowId: text('workflow_id').notNull(),
  version: integer('version').notNull(),
  definition: jsonb('definition').notNull(), // Full WorkflowDefinition
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  changeNotes: text('change_notes'),
}, (table) => [
  index('workflow_version_idx').on(table.workflowId, table.version),
  foreignKey({
    columns: [table.workflowId],
    foreignColumns: [workflows.workflowId],
  }).onDelete('cascade'),
]);

// Executions table
export const executions = pgTable('executions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  executionId: text('execution_id').notNull().unique(),
  workflowId: text('workflow_id').notNull(),
  workflowVersionId: integer('workflow_version_id'), // Link to specific workflow version
  status: text('status').notNull(), // 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  startedAt: timestamp('started_at').notNull(),
  completedAt: timestamp('completed_at'),
  parentExecutionId: text('parent_execution_id'),
  depth: integer('depth').notNull().default(0),
  initialData: jsonb('initial_data'),
  metadata: jsonb('metadata'),
  timeoutAt: timestamp('timeout_at'), // When execution should timeout
  timedOut: boolean('timed_out').default(false), // Timeout flag
}, (table) => [
  index('executions_execution_id_idx').on(table.executionId),
  index('executions_workflow_id_idx').on(table.workflowId),
  index('executions_workflow_version_id_idx').on(table.workflowVersionId),
  index('executions_parent_execution_id_idx').on(table.parentExecutionId),
  index('executions_status_idx').on(table.status),
  index('executions_timeout_at_idx').on(table.timeoutAt),
  foreignKey({
    columns: [table.parentExecutionId],
    foreignColumns: [table.executionId],
  }).onDelete('set null'),
  foreignKey({
    columns: [table.workflowVersionId],
    foreignColumns: [workflowVersions.id],
  }).onDelete('set null'),
]);

// Node results table
export const nodeResults = pgTable('node_results', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  executionId: text('execution_id').notNull(),
  nodeId: text('node_id').notNull(),
  success: boolean('success').notNull(),
  data: jsonb('data'),
  error: text('error'),
  nextNodes: jsonb('next_nodes'), // string[]
  skipped: boolean('skipped').default(false),
}, (table) => [
  index('execution_node_idx').on(table.executionId, table.nodeId),
  foreignKey({
    columns: [table.executionId],
    foreignColumns: [executions.executionId],
  }).onDelete('cascade'),
]);

// Logs table
export const logs = pgTable('logs', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull(),
  nodeId: text('node_id'),
  level: text('level').notNull(), // 'info' | 'warn' | 'error' | 'debug'
  message: text('message').notNull(),
  timestamp: timestamp('timestamp').notNull(),
  metadata: jsonb('metadata'),
}, (table) => [
  index('logs_execution_id_idx').on(table.executionId),
  foreignKey({
    columns: [table.executionId],
    foreignColumns: [executions.executionId],
  }).onDelete('cascade'),
]);

// Spans table
export const spans = pgTable('spans', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull(),
  nodeId: text('node_id').notNull(),
  name: text('name').notNull(),
  startTime: bigint('start_time', { mode: 'number' }).notNull(),
  endTime: bigint('end_time', { mode: 'number' }),
  status: text('status').notNull(), // 'running' | 'completed' | 'failed' | 'skipped'
  error: text('error'),
  metadata: jsonb('metadata'),
}, (table) => [
  index('spans_execution_id_idx').on(table.executionId),
  foreignKey({
    columns: [table.executionId],
    foreignColumns: [executions.executionId],
  }).onDelete('cascade'),
]);

// DLQ items table - persistent storage for dead letter queue
export const dlqItems = pgTable('dlq_items', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull(),
  nodeId: text('node_id').notNull(),
  jobId: text('job_id'),
  jobData: jsonb('job_data'),
  error: text('error').notNull(),
  failedAt: timestamp('failed_at').notNull(),
  attemptsMade: integer('attempts_made').notNull(),
  retried: boolean('retried').default(false),
  retriedAt: timestamp('retried_at'),
}, (table) => [
  index('dlq_execution_id_idx').on(table.executionId),
  index('dlq_failed_at_idx').on(table.failedAt),
  index('dlq_retried_idx').on(table.retried),
  foreignKey({
    columns: [table.executionId],
    foreignColumns: [executions.executionId],
  }).onDelete('cascade'),
]);

// State change audit table - track all state changes for debugging
export const stateChangeAudit = pgTable('state_change_audit', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  executionId: text('execution_id').notNull(),
  changeType: text('change_type').notNull(), // 'status_change', 'node_result', 'workflow_registered', etc.
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  changedAt: timestamp('changed_at').notNull().defaultNow(),
  changedBy: text('changed_by'), // worker ID, API user, etc.
  metadata: jsonb('metadata'),
}, (table) => [
  index('audit_execution_id_idx').on(table.executionId),
  index('audit_change_type_idx').on(table.changeType),
  index('audit_changed_at_idx').on(table.changedAt),
]);

// Payload offloading table - stores large payloads to keep Redis light
export const executionPayloads = pgTable('execution_payloads', {
  id: text('id').primaryKey(), // UUID
  executionId: text('execution_id').notNull(),
  path: text('path').notNull(), // e.g., 'initialData', 'node-nodeId-output'
  data: jsonb('data').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('payloads_execution_id_idx').on(table.executionId),
  foreignKey({
    columns: [table.executionId],
    foreignColumns: [executions.executionId],
  }).onDelete('cascade'),
]);
