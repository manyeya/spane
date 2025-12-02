import { pgTable, text, timestamp, jsonb, integer, bigint, boolean, index, foreignKey } from 'drizzle-orm/pg-core';

// Executions table
export const executions = pgTable('executions', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    executionId: text('execution_id').notNull().unique(),
    workflowId: text('workflow_id').notNull(),
    status: text('status').notNull(), // 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
    startedAt: timestamp('started_at').notNull(),
    completedAt: timestamp('completed_at'),
    parentExecutionId: text('parent_execution_id'),
    depth: integer('depth').notNull().default(0),
    initialData: jsonb('initial_data'),
    metadata: jsonb('metadata'),
}, (table) => [
    index('execution_id_idx').on(table.executionId),
    index('workflow_id_idx').on(table.workflowId),
    index('parent_execution_id_idx').on(table.parentExecutionId),
    foreignKey({
      columns: [table.parentExecutionId],
      foreignColumns: [table.executionId],
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
