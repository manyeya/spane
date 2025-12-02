# 🚀 SPANE

**P**arallel **A**synchronous **N**ode **E**xecution

> Build your own automation platform, workflow builder, or embed powerful orchestration into any application.

> [!WARNING]
> **Experimental Project** - SPANE is currently an experiment and proof-of-concept. It is **not production-ready** and has not been battle-tested. Use at your own risk and expect breaking changes.

SPANE is an embeddable workflow orchestration engine built on BullMQ and Redis. It's designed to be the **infrastructure layer** that could enable you to create automation platforms, visual workflow builders, and intelligent job orchestration systems - without building the complex engine from scratch.

**What makes SPANE unique:**
- 🗄️ **Postgres Persistence** - Optional persistent state storage with Postgres
- 🔌 **Fully Embeddable** - Use programmatically in any application
- 🏗️ **Production Ready Features** - Health checks, metrics, circuit breakers, graceful shutdown
- 📦 **Complete Examples** - Including a React Flow n8n-style visual builder example

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-orange.svg)](https://bun.sh/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.1+-red.svg)](https://docs.bullmq.io/)

## 🎯 What is SPANE?

SPANE is an **experimental headless workflow engine** - exploring what it takes to build the type of infrastructure that platforms like n8n, Zapier, and Temporal are built upon. With SPANE, you can experiment with:

### **🏗️ Build Your Own Platform**
- Create a custom automation platform tailored to your domain
- Build a visual workflow builder with your own UI
- Develop industry-specific automation tools (marketing automation, data pipelines, etc.)
- Prototype a SaaS product with workflow capabilities built-in

### **🔌 Embed Workflow Power**
- Add workflow orchestration to your existing application
- Let your users create custom automation within your product
- Build internal tools with complex job dependencies
- Create event-driven architectures with visual workflow support

### **💡 Why Experiment with SPANE?**
- ✅ **Learning Foundation** - Understand BullMQ, Redis queues, and DAG execution
- ✅ **Fully Embeddable** - Drop into any Node.js/Bun application as a library
- ✅ **Type-Safe Foundation** - Built with TypeScript for better DX
- ✅ **Bring Your Own UI** - SPANE handles execution, you build the interface
- ✅ **Complete Control** - Customize node types, execution logic, and workflows
- ✅ **Solid Stack** - Built on BullMQ and Redis (though SPANE itself is experimental)

## ✨ Features

### 🎨 Visual Workflow Builder
- **🖱️ Drag-and-Drop Interface** - Build workflows visually with React Flow
- **🎯 Multiple Node Types** - Triggers (Schedule, Webhook, Manual), Actions (HTTP, Transform, Email, Database), Control (Condition)
- **⚙️ Node Configuration** - Configure each node with custom parameters
- **🚀 Real-time Execution** - Execute workflows and see live status updates
- **💾 Import/Export** - Save and load workflows as JSON
- **✅ Validation** - Automatic workflow validation before execution
- **🎨 n8n-Inspired UI** - Familiar interface for workflow automation

### 💻 Developer Experience
- **📝 Workflows as Code** - Define workflows in TypeScript, not just UI
- **🔒 Type Safety** - Full TypeScript support with comprehensive type definitions
- **🧪 Testable** - Unit test your workflows like any other code
- **📝 IDE Support** - Autocomplete, refactoring, and inline documentation
- **🔄 Version Control** - Commit workflows to Git, review in PRs
- **🚀 Minimal Setup** - Just Redis and you're ready to experiment

### ⚡ Workflow Capabilities
- **🔄 DAG-based Workflows** - Define complex workflows as Directed Acyclic Graphs
- **⚡ Parallel Execution** - Execute independent nodes concurrently with configurable concurrency
- **🔁 Automatic Retries** - Built-in exponential backoff retry mechanism for failed jobs
- **💀 Dead Letter Queue** - Capture and retry permanently failed jobs
- **⏸️ Pause/Resume** - Pause and resume workflow executions on demand
- **🚫 Cancellation** - Cancel running workflows gracefully
- **⏱️ Timeout Handling** - Configure per-node execution timeouts
- **🔀 Conditional Branching** - Dynamic routing based on execution results
- **🔄 Sub-workflows** - Compose workflows from reusable workflow components
- **📊 Data Passing** - Automatic data flow between nodes
- **🎯 Priority Queues** - Prioritize critical workflows
- **⏰ Delayed/Scheduled Jobs** - Execute workflows at specific times
- **🔁 Job Deduplication** - Prevent duplicate executions
- **📦 Bulk Operations** - Manage multiple workflows simultaneously

### 🗄️ Persistence & State
- 🗄️ **Postgres Persistence** - Optional persistent state storage with Postgres
- 💾 **Full State Persistence** - Execution state, node results, logs, and traces
- 🔍 **Execution Replay** - Re-run past executions with full context
- 📊 **Observability** - Comprehensive logging and tracing
- ⚡ **In-Memory Fallback** - Works without a database for development

### 🏥 Production Operations
- **💓 Health Monitoring** - Comprehensive health checks for workers, queues, and Redis
- **📊 Metrics Collection** - Prometheus and JSON format metrics export
- **🔌 Circuit Breakers** - Prevent cascading failures with automatic recovery
- **🛑 Graceful Shutdown** - Proper cleanup on SIGTERM/SIGINT
- **☸️ Kubernetes Ready** - Liveness and readiness probes
- **📈 Real-time Monitoring** - Track queue statistics and execution states

### 🔌 Integration & API
- **🌐 REST API** - Full HTTP API for workflow management
- **🪝 Webhook Triggers** - Start workflows via HTTP webhooks
- **⏰ Cron Triggers** - Schedule workflows with cron expressions
- **🔄 React Flow Integration** - Complete visual builder example
- **🔧 Extensible** - Plugin-based node executor system

### 🏗️ Architecture
- **BullMQ Integration** - Manual DAG traversal with Redis-backed job queues
- **Redis-backed** - Persistent job queues with Redis
- **Embeddable** - Drop into any Node.js/Bun application
- **Modular Design** - Separated concerns (QueueManager, DLQManager, NodeProcessor, WorkerManager)
- **Error Handling** - DLQ, retries, and graceful shutdown
- **Lightweight** - Minimal dependencies, optional UI

## 🎨 What Can You Build? (Experimentally)

### **Automation Platform Prototypes**
Experiment with building your own automation tools:
- 🎯 **Domain-Specific Automation** - Prototype automation tools for specific industries (e-commerce, marketing, finance)
- 🎨 **Custom Visual Builders** - Experiment with drag-and-drop workflow UIs on top of SPANE
- 🏢 **Enterprise Automation** - Explore white-label automation platforms
- 🌐 **Multi-Tenant SaaS** - Prototype workflow automation SaaS products

### **Embedded Workflow Features**
Experiment with adding workflow capabilities to existing products:
- 📊 **Analytics Pipelines** - Let users create custom data transformation workflows
- 🤖 **AI Agent Orchestration** - Build LangChain-style agent workflows with custom logic
- 📧 **Marketing Automation** - Embed drip campaigns and customer journeys into your CRM
- 🔄 **ETL/Data Pipelines** - Create Airflow-like data orchestration within your app
- 🎮 **Game Event Systems** - Complex event-driven game mechanics and quests

### **Internal Tools & Learning**
Power your backend infrastructure or learn workflow orchestration:
- 🔧 **Microservice Orchestration** - Coordinate complex service interactions
- 📦 **Deployment Pipelines** - Build custom CI/CD workflows
- 🔔 **Event Processing** - Handle webhooks, events, and async tasks
- 📈 **Scheduled Jobs** - Cron-like scheduling with dependencies and retries

## 📋 Table of Contents

- [What is SPANE?](#-what-is-spane)
- [What Can You Build?](#-what-can-you-build)
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Core Concepts](#-core-concepts)
- [API Reference](#-api-reference)
- [Examples](#-examples)
- [Configuration](#-configuration)
- [Architecture](#-architecture)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

## 🔧 Installation

### Prerequisites
- [Bun](https://bun.sh/) 1.0 or higher
- Redis 6.0 or higher
- (Optional) Postgres for persistent state

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/spane.git
cd spane

# Install dependencies
bun install

# Make sure Redis is running
redis-server

# (Optional) Set up Postgres for persistence
# See Database Setup section below

# Start the engine
bun start
```

### Database Setup (Optional)

SPANE supports Postgres for persistent state storage. If you don't configure a database, it will use an in-memory store (data lost on restart).

```bash
# Install Postgres and create a database
createdb spane

# Set environment variable
export DATABASE_URL="postgresql://user:password@localhost:5432/spane"

# Run migrations
bun run db:generate
bun run db:push
```

### Environment Variables

```bash
# Optional: Custom Redis URL (defaults to localhost:6379)
REDIS_URL=redis://localhost:6379

# Optional: Custom port (defaults to 3000)
PORT=3000

# Optional: Database URL for persistent state (uses in-memory if not set)
DATABASE_URL=postgresql://user:password@localhost:5432/spane

# Optional: Enable/disable production operations features (enabled by default)
ENABLE_PRODUCTION_OPS=true

# Optional: Worker concurrency (defaults to 5)
WORKER_CONCURRENCY=5

# Optional: Graceful shutdown timeout in milliseconds (defaults to 30000)
SHUTDOWN_TIMEOUT=30000
```

## 🚀 Quick Start

### 1. Define Your Node Executors

Create custom node executors by implementing the `INodeExecutor` interface:

```typescript
import type { INodeExecutor, ExecutionContext, ExecutionResult } from './types';

class EmailNodeExecutor implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { inputData, previousResults } = context;
    
    // Your business logic here
    await sendEmail(inputData.to, inputData.subject, inputData.body);
    
    return {
      success: true,
      data: { emailSent: true, timestamp: Date.now() }
    };
  }
}
```

### 2. Register Node Types

```typescript
import { NodeRegistry } from './registry';

const registry = new NodeRegistry();
registry.register('email', new EmailNodeExecutor());
registry.register('http', new HttpNodeExecutor());
registry.register('transform', new TransformNodeExecutor());
```

### 3. Define Your Workflow

```typescript
import type { WorkflowDefinition } from './types';

const workflow: WorkflowDefinition = {
  id: 'user-onboarding',
  name: 'User Onboarding Workflow',
  entryNodeId: 'validate-user',
  nodes: [
    {
      id: 'validate-user',
      type: 'transform',
      config: { validation: 'email' },
      inputs: [],
      outputs: ['send-welcome-email', 'create-account']
    },
    {
      id: 'send-welcome-email',
      type: 'email',
      config: { template: 'welcome' },
      inputs: ['validate-user'],
      outputs: []
    },
    {
      id: 'create-account',
      type: 'http',
      config: { endpoint: '/api/accounts', method: 'POST' },
      inputs: ['validate-user'],
      outputs: []
    }
  ]
};
```

### 4. Execute Your Workflow

```typescript
import { WorkflowEngine } from './workflow-engine';
import { InMemoryExecutionStore } from './inmemory-store';
import { Redis } from 'ioredis';

const redis = new Redis();
const stateStore = new InMemoryExecutionStore();
const engine = new WorkflowEngine(registry, stateStore, redis);

// Register workflow
engine.registerWorkflow(workflow);

// Start workers
engine.startWorkers(5); // 5 concurrent workers

// Execute workflow
const executionId = await engine.enqueueWorkflow('user-onboarding', {
  email: 'user@example.com',
  name: 'John Doe'
});

console.log(`Workflow started: ${executionId}`);
```

### 5. Monitor Execution

```typescript
// Get execution status
const execution = await stateStore.getExecution(executionId);
console.log(execution.status); // 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'

// Get queue statistics
const stats = await engine.getQueueStats();
console.log(stats);
```

## 8. Observability & Debugging

The engine provides built-in observability features to track and debug workflow executions.

### Logging
Execution logs are automatically generated for every node execution, capturing start, success, and failure events.

```typescript
const logs = await store.getLogs(executionId);
// [INFO] Executing node node1 (type: http-request)
// [INFO] Node execution completed successfully
```

### Tracing
Performance traces are created for each execution, with spans for individual nodes tracking duration and status.

```typescript
const trace = await store.getTrace(executionId);
// Trace ID: exec_123
// Spans: 2
//   - Span: Execute http-request (completed) [150ms]
```

### Replay
You can replay any past execution. The new execution will be linked to the original via metadata, allowing for historical analysis.

```typescript
const newExecutionId = await engine.replayWorkflow(originalExecutionId);
```

## 9. Persistence ⚠️

> **⚠️ WARNING**: The Drizzle store implementation is currently **not working** and should not be used in production. SPANE currently uses an in-memory store by default.

SPANE supports persistent state storage using **Drizzle ORM** with **Postgres**, but this feature is currently **experimental and not functional**.

### Database Setup

Set the `DATABASE_URL` environment variable to enable persistence:

```bash
# Postgres
DATABASE_URL=postgresql://user:password@localhost:5432/spane
```

If `DATABASE_URL` is not set, SPANE will use an in-memory store (data will be lost on restart).

### Running Migrations

Generate and apply database migrations using Drizzle Kit:

```bash
# Generate migration files
bun run db:generate

# Apply migrations to database
bun run db:push
```

### What Gets Persisted

- **Execution State**: Workflow status, start/completion times, depth, metadata
- **Node Results**: Success/failure status, output data, errors
- **Execution Logs**: Detailed logs for debugging
- **Execution Traces**: Performance spans for each node

> **⚠️ IMPORTANT**: The Drizzle store implementation has known issues and is not currently functional. Use the in-memory store for development and testing purposes only.

## 10. Future Enhancements

## 🧩 Core Concepts

### Workflows

A **workflow** is a collection of nodes organized as a Directed Acyclic Graph (DAG). Each workflow has:
- **Unique ID** - Identifier for the workflow
- **Entry Node** - Starting point for execution
- **Nodes** - Individual units of work
- **Dependencies** - Defined by `inputs` and `outputs` arrays

### Nodes

A **node** represents a single unit of work in your workflow:
- **Type** - Determines which executor handles the node
- **Config** - Node-specific configuration
- **Inputs** - IDs of upstream nodes (dependencies)
- **Outputs** - IDs of downstream nodes

### Executors

**Executors** contain the business logic for each node type. They receive:
- **Execution Context** - Workflow ID, execution ID, node ID
- **Input Data** - Data passed to this node (see Data Passing below)
- **Previous Results** - Results from all upstream nodes

### Data Passing

SPANE automatically passes data between nodes based on their parent-child relationships:

#### **Entry Nodes** (No Parents)
Receive the initial workflow data as `inputData`:
```typescript
const executionId = await engine.enqueueWorkflow('my-workflow', {
  userId: 123,
  email: 'user@example.com'
});

// Entry node receives: { userId: 123, email: 'user@example.com' }
```

#### **Single Parent Nodes**
Automatically receive the parent's output `data` as `inputData`:
```typescript
class ProcessorNode implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    // context.inputData contains parent's output.data directly
    const value = context.inputData.value; // From parent
    return { success: true, data: { processed: value * 2 } };
  }
}
```

#### **Multiple Parent Nodes** (Merge Scenario)
Receive an object with parent node IDs as keys:
```typescript
class MergeNode implements INodeExecutor {
  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    // context.inputData = { 'node-a': {...}, 'node-b': {...} }
    const dataA = context.inputData['node-a'];
    const dataB = context.inputData['node-b'];
    
    return { 
      success: true, 
      data: { merged: dataA.value + dataB.value } 
    };
  }
}
```

#### **Accessing All Results**
For complex scenarios, use `previousResults` to access any node's output:
```typescript
const allResults = context.previousResults;
const specificNode = allResults['some-node-id'];
```

### Execution Flow

1. **Enqueue** - Workflow is submitted to the engine
2. **Entry Nodes** - All nodes with no inputs are enqueued
3. **Sequential Execution** - Child nodes wait for all parents to complete
4. **Data Passing** - Parent outputs automatically passed to children
5. **Parallel Branches** - Independent branches execute concurrently
6. **Result Aggregation** - Results stored in state store
7. **Completion** - Workflow marked as completed/failed

## 📡 API Reference

### REST Endpoints

#### Execute Workflow
```http
POST /api/workflows/:workflowId/execute
Content-Type: application/json

{
  "initialData": {
    "key": "value"
  }
}
```

#### Register Workflow
```http
POST /api/workflows
Content-Type: application/json

{
  "id": "my-workflow",
  "name": "My Workflow",
  "entryNodeId": "start",
  "nodes": [...]
}
```

#### Get Workflow Definition
```http
GET /api/workflows/:workflowId
```

#### Get Execution Status
```http
GET /api/executions/:executionId
```

#### Get Queue Statistics
```http
GET /api/stats
```

#### Execute Single Node
```http
POST /api/workflows/:workflowId/nodes/:nodeId/execute
Content-Type: application/json

{
  "executionId": "exec_123",
  "inputData": {
    "key": "value"
  }
}
```

#### Webhook Trigger
```http
POST /api/webhooks/:path
Content-Type: application/json

{
  "data": "your webhook payload"
}
```

#### Health Check (Detailed)
```http
GET /health
```

#### Liveness Probe (Kubernetes)
```http
GET /health/live
```

#### Readiness Probe (Kubernetes)
```http
GET /health/ready
```

#### Metrics (Prometheus Format)
```http
GET /metrics
```

#### Metrics (JSON Format)
```http
GET /metrics/json
```

#### Circuit Breaker Status
```http
GET /circuit-breakers
```

#### Reset Circuit Breaker
```http
POST /circuit-breakers/:name/reset
```

#### Shutdown Status
```http
GET /health
```

### Programmatic API

#### WorkflowEngine

```typescript
class WorkflowEngine {
  // Register a workflow definition
  registerWorkflow(workflow: WorkflowDefinition): void
  
  // Get workflow by ID
  getWorkflow(workflowId: string): WorkflowDefinition | undefined
  
  // Execute a workflow
  enqueueWorkflow(workflowId: string, initialData?: any): Promise<string>
  
  // Execute a single node
  enqueueNode(executionId: string, workflowId: string, nodeId: string, inputData?: any): Promise<string>
  
  // Start worker processes
  startWorkers(concurrency?: number): void
  
  // Pause a running workflow
  pauseWorkflow(executionId: string): Promise<void>
  
  // Resume a paused workflow
  resumeWorkflow(executionId: string): Promise<void>
  
  // Cancel a workflow
  cancelWorkflow(executionId: string): Promise<void>
  
  // Get DLQ items
  getDLQItems(start?: number, end?: number): Promise<DLQItem[]>
  
  // Retry a DLQ item
  retryDLQItem(dlqJobId: string): Promise<boolean>
  
  // Get queue statistics
  getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }>
  
  // Schedule a workflow to execute at a specific time
  scheduleWorkflow(workflowId: string, initialData: any, executeAt: Date): Promise<string>
  
  // Graceful shutdown
  close(): Promise<void>
}
```

#### IExecutionStateStore

```typescript
interface IExecutionStateStore {
  createExecution(workflowId: string): Promise<string>
  updateNodeResult(executionId: string, nodeId: string, result: ExecutionResult): Promise<void>
  getExecution(executionId: string): Promise<ExecutionState | null>
  setExecutionStatus(executionId: string, status: ExecutionStatus): Promise<void>
}
```

## 📚 Examples

### Example 1: Dead Letter Queue (DLQ)

See [`examples/dlq.ts`](./examples/dlq.ts) for a complete example demonstrating:
- Failed job handling
- Automatic retries with exponential backoff
- DLQ population after retry exhaustion
- Error propagation to workflow status
```
bun run examples/dlq.ts
```

### Example 2: Data Passing Between Nodes

See [`examples/data-passing.ts`](./examples/data-passing.ts) for examples of:
- Simple chain data passing (A → B → C)
- Multiple parent merge scenario (A → C, B → C)
- Automatic parent output passing
- Handling merged data from multiple parents

```bash
bun run examples/data-passing.ts
```

### Example 3: Pause/Resume/Cancel

See [`examples/cancellation-pause.ts`](./examples/cancellation-pause.ts) for examples of:
- Pausing running workflows
- Resuming paused workflows
- Cancelling workflows mid-execution
- Timeout handling

```bash
bun run examples/cancellation-pause.ts
```

### Example 4: Conditional Branching

See [`examples/conditional-branching.ts`](./examples/conditional-branching.ts) for examples of:
- Switch/Router nodes
- Conditional execution paths
- Skipping branches
- Joining branches after conditional execution

```bash
bun run examples/conditional-branching.ts
```

### Example 5: Parallel Execution Limits

See [`examples/parallel-limits.ts`](./examples/parallel-limits.ts) for examples of:
- Limiting workflow concurrency
- Rate limiting specific node types
- Handling backpressure via delayed retries

```bash
bun run examples/parallel-limits.ts
```

### Example 6: Webhook & Schedule Triggers

See [`examples/triggers.ts`](./examples/triggers.ts) for examples of:
- Webhook-based workflow triggering
- Cron schedule-based execution
- Automatic recurring workflows

```bash

bun run examples/triggers.ts
```

### Example 7: Sub-workflows (Reusable Workflows)

See [`examples/sub-workflows.ts`](./examples/sub-workflows.ts) for examples of:
- Composing workflows from other workflows
- Passing data between parent and child workflows
- Non-blocking execution (Checkpoint & Resume pattern)
- Handling child workflow failures

```bash
bun run examples/sub-workflows.ts
```

### Example 8: Advanced Queue Features

SPANE supports advanced queue features for fine-grained control over workflow execution.

#### Job Prioritization

Execute workflows based on priority (1-10, higher = more important):

```typescript
// High priority workflow executes first
await engine.enqueueWorkflow(
  'urgent-task',
  { data: 'critical' },
  undefined,
  0,
  undefined,
  { priority: 10 }
);

// Normal priority
await engine.enqueueWorkflow(
  'normal-task',
  { data: 'standard' },
  undefined,
  0,
  undefined,
  { priority: 5 }
);
```

See [`examples/priority-test.ts`](./examples/priority-test.ts) for a complete example.

#### Delayed/Scheduled Jobs

Execute workflows after a delay or at a specific time:

```typescript
// Delay by 5 seconds (relative)
await engine.enqueueWorkflow(
  'delayed-task',
  { data: 'delayed' },
  undefined,
  0,
  undefined,
  { delay: 5000 } // 5000ms = 5 seconds
);

// Schedule for specific time (absolute)
const executeAt = new Date('2024-12-25T00:00:00Z');
await engine.scheduleWorkflow('christmas-task', { data: 'holiday' }, executeAt);
```

See [`examples/delayed-test.ts`](./examples/delayed-test.ts) for a complete example.

#### Job Deduplication

Prevent duplicate workflow executions using custom job IDs:

```typescript
// First enqueue - will execute
await engine.enqueueWorkflow(
  'unique-task',
  { data: 'first' },
  undefined,
  0,
  undefined,
  { jobId: 'unique-job-123' }
);

// Second enqueue with same jobId - will be deduplicated (won't execute)
await engine.enqueueWorkflow(
  'unique-task',
  { data: 'duplicate' },
  undefined,
  0,
  undefined,
  { jobId: 'unique-job-123' }
);

// Check if job exists
const status = await engine.getJobStatus('unique-job-123');
console.log(status.exists); // true
console.log(status.status); // 'completed' | 'waiting' | 'active' | etc.
```

See [`examples/dedup-test.ts`](./examples/dedup-test.ts) for a complete example.

#### Bulk Operations

Enqueue, pause, resume, or cancel multiple workflows at once:

```typescript
// Bulk enqueue
const workflows = [
  { workflowId: 'task-1', initialData: { id: 1 }, priority: 8 },
  { workflowId: 'task-2', initialData: { id: 2 }, priority: 5 },
  { workflowId: 'task-3', initialData: { id: 3 }, delay: 10000 }
];

const executionIds = await engine.enqueueBulkWorkflows(workflows);

// Bulk pause
await engine.pauseBulkWorkflows(executionIds.slice(0, 2));

// Bulk resume
await engine.resumeBulkWorkflows(executionIds.slice(0, 2));

// Bulk cancel
await engine.cancelBulkWorkflows(executionIds.slice(2));
```

See [`examples/bulk-test.ts`](./examples/bulk-test.ts) for a complete example.

### Example 9: Production Operations

SPANE includes production-ready operational features for monitoring, reliability, and graceful degradation.

#### Health Monitoring

Comprehensive health checks for workers, queues, and Redis:

```typescript
import { HealthMonitor } from './health';

const healthMonitor = new HealthMonitor(redis);

// Detailed health check
const health = await healthMonitor.getHealth();
// {
//   status: 'healthy' | 'degraded' | 'unhealthy',
//   checks: {
//     redis: { status: 'pass', message: 'Redis connection healthy', details: { latency: '5ms' } },
//     workers: { status: 'pass', message: 'All workers running', details: { total: 5, running: 5 } },
//     queues: { status: 'pass', message: 'Queues healthy', details: { queues: [...] } }
//   },
//   uptime: 123456
// }

// Kubernetes probes
const liveness = await healthMonitor.getLiveness();  // { alive: true }
const readiness = await healthMonitor.getReadiness(); // { ready: true }
```

**HTTP Endpoints:**
- `GET /health` - Detailed health status
- `GET /health/live` - Liveness probe (K8s)
- `GET /health/ready` - Readiness probe (K8s)

#### Metrics Collection

Track workflow execution metrics in Prometheus or JSON format:

```typescript
import { MetricsCollector } from './metrics';

const metricsCollector = new MetricsCollector();

// Metrics are automatically collected by the engine
// Export in Prometheus format
const prometheus = metricsCollector.toPrometheus();

// Export in JSON format
const json = metricsCollector.toJSON();
// {
//   counters: {
//     workflows_enqueued_total: 150,
//     workflows_completed_total: 145,
//     workflows_failed_total: 3,
//     nodes_executed_total: 450
//   },
//   gauges: {
//     workflows_active: 5,
//     queue_waiting: 12
//   },
//   histograms: {
//     workflow_duration_ms: { p50: 1200, p90: 2500, p95: 3000, p99: 5000 }
//   }
// }
```

**HTTP Endpoints:**
- `GET /metrics` - Prometheus format (for Prometheus/Grafana)
- `GET /metrics/json` - JSON format

**Tracked Metrics:**
- **Counters**: workflows enqueued/completed/failed/cancelled, nodes executed/failed, DLQ items
- **Gauges**: active workflows, paused workflows, queue depths (waiting/active/delayed/failed)
- **Histograms**: workflow duration, node duration, queue wait time (with p50, p90, p95, p99 percentiles)

#### Circuit Breaker Pattern

Prevent cascading failures with automatic circuit breakers:

```typescript
import { CircuitBreakerRegistry } from './circuit-breaker';

const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Get or create a circuit breaker
const breaker = circuitBreakerRegistry.getOrCreate('external-api', {
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 2,      // Close after 2 successes
  timeout: 60000,           // Wait 60s before retry
  monitoringPeriod: 120000  // Track failures over 2 minutes
});

// Use in node executor
registry.register('api-call', async (context) => {
  try {
    const result = await breaker.execute(async () => {
      return await callExternalAPI();
    });
    return { success: true, data: result };
  } catch (error) {
    // Circuit breaker will throw CircuitBreakerError if open
    return { success: false, error: error.message };
  }
});

// Check circuit breaker status
const stats = circuitBreakerRegistry.getAllStats();
// [{ name: 'external-api', state: 'CLOSED', failureCount: 0, successCount: 0 }]

// Manually reset a circuit breaker
circuitBreakerRegistry.reset('external-api');
```

**HTTP Endpoints:**
- `GET /circuit-breakers` - View all circuit breaker states
- `POST /circuit-breakers/:name/reset` - Manually reset a breaker

**Circuit States:**
- `CLOSED` - Normal operation, requests pass through
- `OPEN` - Failing, requests rejected immediately
- `HALF_OPEN` - Testing recovery, limited requests allowed

#### Graceful Shutdown

Proper cleanup on SIGTERM/SIGINT:

```typescript
import { GracefulShutdown } from './graceful-shutdown';

const gracefulShutdown = new GracefulShutdown({
  timeout: 30000,    // Max 30s to complete shutdown
  forceExit: true    // Force exit after timeout
});

// Register resources for cleanup
gracefulShutdown.registerRedis(redis);
gracefulShutdown.registerCleanupHandler(async () => {
  await engine.close();
});

// Shutdown is automatically triggered on SIGTERM/SIGINT
// Or manually:
await gracefulShutdown.shutdown();
```

**Shutdown Process:**
1. Stop accepting new jobs (close workers)
2. Wait for active jobs to complete
3. Run custom cleanup handlers
4. Close all queues
5. Close Redis connections
6. Exit process

**HTTP Endpoint:**
- `GET /shutdown/status` - Check if shutdown is in progress

**Features:**
- Stops accepting new jobs
- Waits for active jobs to complete (with timeout)
- Closes all queues and connections cleanly
- Configurable timeout and force exit

**Complete Example:**
See [`examples/production-ops.ts`](./examples/production-ops.ts) for a full demonstration of all production operations features.

```bash
bun run examples/production-ops.ts
```

- **Webhook** - Trigger via HTTP webhook
- **Manual** - Start workflows manually

**Actions:**
- **HTTP Request** - Make HTTP API calls
- **Transform** - Transform data with JavaScript code
- **Send Email** - Send email notifications
- **Database** - Query databases

**Control:**
- **Condition** - Branch based on conditions (if/else logic)

#### Running the Visual Builder

**1. Start the Backend:**

```bash
# From the project root
bun run examples/react-flow-backend.ts
```

This starts the SPANE engine with a REST API on port 4000.

**2. Start the Frontend:**

```bash
# In a new terminal
cd examples/react-flow-n8n
bun install
bun run dev
```

This starts the React Flow visual builder on port 5173.

**3. Open in Browser:**

Navigate to `http://localhost:5173` and start building workflows!

#### Usage

1. **Add nodes** - Drag nodes from the left palette onto the canvas
2. **Connect nodes** - Click and drag from one node's handle to another to create connections
3. **Configure nodes** - Click on a node to open its configuration panel
4. **Execute workflow** - Click the "Execute" button to run your workflow
5. **Monitor execution** - Watch as nodes update their status in real-time

#### Example Workflows

**Simple HTTP Workflow:**
1. Add a "Manual" trigger
2. Add an "HTTP Request" action
3. Connect trigger to HTTP action
4. Configure HTTP action with a URL
5. Execute and see results

**Conditional Workflow:**
1. Add a "Manual" trigger
2. Add a "Transform" action to prepare data
3. Add a "Condition" node
4. Add two different actions for true/false branches
5. Connect and configure
6. Execute to see conditional branching

#### Architecture

- **Frontend**: React + Vite + React Flow
- **Backend**: Elysia + SPANE workflow engine
- **State Management**: React hooks
- **Workflow Execution**: BullMQ + Redis
- **Real-time Updates**: Polling-based status updates

#### API Endpoints

The backend provides these endpoints:
- `POST /api/workflows/execute` - Execute a workflow
- `GET /api/workflows/executions/:id` - Get execution status
- `GET /api/health` - Health check

#### Project Structure

```
react-flow-n8n/
├── src/
│   ├── components/
│   │   ├── NodePalette.tsx      # Draggable node templates
│   │   └── NodeConfigPanel.tsx  # Node configuration UI
│   ├── nodes/
│   │   ├── TriggerNode.tsx      # Trigger node component
│   │   ├── ActionNode.tsx       # Action node component
│   │   └── ConditionNode.tsx    # Condition node component
│   ├── engine/
│   │   ├── workflowConverter.ts # Convert React Flow to SPANE
│   │   └── executionManager.ts  # Handle workflow execution
│   ├── styles/
│   │   ├── app.css              # Application styles
│   │   └── nodes.css            # Node styles
│   ├── App.tsx                  # Main application
│   └── main.tsx                 # Entry point
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

#### Building for Production

```bash
cd examples/react-flow-n8n
bun run build
```

The built files will be in the `dist/` directory.

**Learn More:**
See [`examples/react-flow-n8n/README.md`](./examples/react-flow-n8n/README.md) for detailed documentation.

## ⚙️ Configuration

### Node Configuration

Each node can have custom configuration:

```typescript
{
  id: 'api-call',
  type: 'http',
  config: {
    timeout: 30000,        // 30 second timeout
    retries: 3,            // Custom retry count
    endpoint: '/api/data',
    method: 'POST'
  },
  inputs: [],
  outputs: []
}
```

### Worker Configuration

```typescript
// Start with custom concurrency
engine.startWorkers(10); // 10 concurrent node executions
```

### Queue Options

BullMQ queue options are configurable in the `WorkflowEngine` constructor:

```typescript
this.nodeQueue = new Queue<NodeJobData>('node-execution', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
});
```

## 🏗️ Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                    REST API (Elysia)                    │
│                  WorkflowAPIController                  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   WorkflowEngine                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Manual DAG   │  │ Node Queue   │  │  DLQ Queue   │  │
│  │ Traversal    │  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │ Node Worker  │  │ Queue Events │                    │
│  └──────────────┘  └──────────────┘                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                    Redis (BullMQ)                       │
│         Job Queues │ State │ Locks │ Events            │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              ExecutionStateStore                        │
│           (InMemory / Postgres / MongoDB)               │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **API Request** → `WorkflowAPIController` receives HTTP request
2. **Workflow Enqueue** → `WorkflowEngine.enqueueWorkflow()` called
3. **Entry Detection** → Find all nodes with no inputs (entry nodes)
4. **Job Creation** → Manually enqueue entry nodes to Redis queues
5. **Worker Processing** → `NodeWorker` picks up jobs and executes
6. **Node Execution** → `NodeRegistry` provides executor for node type
7. **Child Enqueueing** → Check and enqueue child nodes when all parents complete
8. **Result Storage** → Results saved to `ExecutionStateStore`
9. **Completion Check** → Engine checks if all nodes completed
10. **Status Update** → Workflow marked as completed/failed

### Error Handling Flow

```
Node Execution Failed
       │
       ▼
Retry with Exponential Backoff
       │
       ▼
Max Retries Exhausted?
       │
       ├─── No ──→ Retry Again
       │
       └─── Yes ──→ Move to DLQ
                    │
                    ├─→ Update Node Result (failed)
                    │
                    └─→ Update Workflow Status (failed)
```

## 🗺️ Roadmap

### ✅ Implemented Features
- [x] DAG-based workflow execution
- [x] Parallel node execution
- [x] Automatic retries with exponential backoff
- [x] Dead Letter Queue (DLQ)
- [x] Pause/Resume workflows
- [x] Workflow cancellation
- [x] Timeout handling
- [x] **Data passing between nodes** - Automatic parent output passing
- [x] **Conditional Branching** - If/else logic, switch nodes, and skipping
- [x] **Parallel Execution Limits** - Concurrency control and rate limiting
- [x] **Webhook/Trigger Support** - Webhook and Cron triggers
- [x] **Sub-workflows** - Reusable workflow composition (Non-blocking)
- [x] **Observability & Debugging** - Execution logging, tracing, and replay
- [x] **Advanced Queue Features** - Job prioritization, delayed/scheduled jobs, deduplication, bulk operations
- [x] REST API
- [x] Queue statistics

### ⚠️ Known Issues
- [ ] **Drizzle Store Not Working** - The Postgres persistence implementation via Drizzle ORM is currently not functional. SPANE uses in-memory store by default.
- [ ] Transaction support for state updates

### 📅 Planned Features

#### High Priority
- [ ] **Metrics Integration** - Prometheus/Grafana support
- [ ] **Fix Drizzle Store** - Complete and test Postgres persistence implementation

#### Low Priority
- [ ] **Multi-tenancy** - Tenant isolation
- [ ] **Authentication/Authorization** - Secure API access
- [ ] **Secrets Management** - Secure config storage
- [ ] **Circuit Breaker** - Fault tolerance patterns
- [ ] **Health Checks** - Worker health monitoring

See [`critical-missing-parts.md`](./critical-missing-parts.md) for detailed feature breakdown.

> **📅 Last Updated**: December 2, 2025 - Added clear documentation about Drizzle store issues and updated roadmap priorities.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
# Install dependencies
bun install

# Run in development mode with auto-reload
bun dev

# Build for production
bun run build

# Run tests
bun test
```

### Project Structure

```
spane/
├── index.ts              # Entry point
├── workflow-engine.ts    # Core workflow orchestration
├── api.ts                # REST API controller
├── registry.ts           # Node executor registry
├── types.ts              # TypeScript type definitions
├── inmemory-store.ts     # In-memory state store
├── examples/             # Example workflows
│   ├── dlq.ts           # DLQ demonstration
│   └── cancellation-pause.ts
└── README.md
```

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

Built with:
- [BullMQ](https://docs.bullmq.io/) - Premium Message Queue for NodeJS
- [Bun](https://bun.sh/) - Fast all-in-one JavaScript runtime
- [Elysia](https://elysiajs.com/) - Fast and friendly Bun web framework
- [Redis](https://redis.io/) - In-memory data structure store
- [ioredis](https://github.com/redis/ioredis) - Robust Redis client

---

**Made with ❤️ by the SPANE team**

For questions, issues, or feature requests, please [open an issue](https://github.com/yourusername/spane/issues).
