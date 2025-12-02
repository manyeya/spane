# 🚀 SPANE

**P**arallel **A**synchronous **N**ode **E**xecution

> Build your own automation platform, workflow builder, or embed powerful orchestration into any application.

> [!WARNING]
> **Experimental Project** - SPANE is currently an experiment and proof-of-concept. It is **not production-ready** and has not been battle-tested. Use at your own risk and expect breaking changes.

SPANE is an embeddable workflow orchestration engine built on BullMQ and Redis. It's designed to be the **infrastructure layer** that could enable you to create automation platforms, visual workflow builders, and intelligent job orchestration systems - without building the complex engine from scratch.

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

### 🎨 Developer Experience
- **💻 Workflows as Code** - Define workflows in TypeScript, not JSON or UI
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
- **📊 Real-time Monitoring** - Track queue statistics and execution states
- **🔌 REST API** - Full HTTP API for workflow management

### 🏗️ Architecture
- **BullMQ Integration** - Manual DAG traversal with Redis-backed job queues
- **Redis-backed** - Persistent job queues with Redis
- **Embeddable** - Drop into any Node.js/Bun application
- **Extensible** - Plugin-based node executor system
- **Error Handling** - DLQ, retries, and graceful shutdown
- **Lightweight** - Minimal dependencies, no UI overhead

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

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/spane.git
cd spane

# Install dependencies
bun install

# Make sure Redis is running
redis-server

# Start the engine
bun start
```

### Environment Variables

```bash
# Optional: Custom Redis URL (defaults to localhost:6379)
REDIS_URL=redis://localhost:6379

# Optional: Custom port (defaults to 3000)
PORT=3000
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

## 9. Future Enhancements

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

#### Health Check
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
  getQueueStats(): Promise<QueueStats>
  
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
- [x] REST API
- [x] Queue statistics

### 🚧 In Progress
- [ ] Persistent state store (Postgres/MongoDB adapter)

### 📅 Planned Features

#### High Priority
- [ ] **Execution Logging** - Per-node execution logs and traces

#### Medium Priority
- [ ] **Job Prioritization** - Priority-based execution
- [ ] **Bulk Operations** - Batch workflow operations
- [ ] **Replay/Rerun** - Debug failed executions
- [ ] **Metrics Integration** - Prometheus/Grafana support

#### Low Priority
- [ ] **Multi-tenancy** - Tenant isolation
- [ ] **Authentication/Authorization** - Secure API access
- [ ] **Secrets Management** - Secure config storage
- [ ] **Circuit Breaker** - Fault tolerance patterns
- [ ] **Health Checks** - Worker health monitoring

See [`critical-missing-parts.md`](./critical-missing-parts.md) for detailed feature breakdown.

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
