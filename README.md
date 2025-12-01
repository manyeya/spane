# 🚀 SPANE

**S**calable **P**arallel **A**synchronous **N**ode **E**xecution

> **The workflow engine that powers platforms like n8n** - Build your own automation platform, workflow builder, or embed powerful orchestration into any application.

SPANE is an embeddable, production-ready workflow orchestration engine built on BullMQ and Redis. It's the **infrastructure layer** that enables you to create automation platforms, visual workflow builders, and intelligent job orchestration systems - without building the complex engine from scratch.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-orange.svg)](https://bun.sh/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.1+-red.svg)](https://docs.bullmq.io/)

## 🎯 What is SPANE?

SPANE is the **headless workflow engine** that platforms like n8n, Zapier, and Temporal are built on top of. Instead of using these platforms, you can use SPANE to:

### **🏗️ Build Your Own Platform**
- Create a custom n8n-like automation platform for your domain
- Build a visual workflow builder with your own UI
- Develop industry-specific automation tools (marketing automation, data pipelines, etc.)
- Launch a SaaS product with workflow capabilities built-in

### **🔌 Embed Workflow Power**
- Add workflow orchestration to your existing application
- Let your users create custom automation within your product
- Build internal tools with complex job dependencies
- Create event-driven architectures with visual workflow support

### **💡 Why Build on SPANE?**
- ✅ **Production-Ready Engine** - Don't reinvent BullMQ, Redis queues, and DAG execution
- ✅ **Fully Embeddable** - Drop into any Node.js/Bun application as a library
- ✅ **Type-Safe Foundation** - Build your platform on solid TypeScript foundations
- ✅ **Bring Your Own UI** - SPANE handles execution, you build the interface
- ✅ **Complete Control** - Customize node types, execution logic, and workflows
- ✅ **Battle-Tested Stack** - Built on BullMQ and Redis, proven at scale

## ✨ Features

### 🎨 Developer Experience
- **💻 Workflows as Code** - Define workflows in TypeScript, not JSON or UI
- **🔒 Type Safety** - Full TypeScript support with comprehensive type definitions
- **🧪 Testable** - Unit test your workflows like any other code
- **📝 IDE Support** - Autocomplete, refactoring, and inline documentation
- **🔄 Version Control** - Commit workflows to Git, review in PRs
- **🚀 Zero Config** - No database setup, just Redis and you're ready

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

### 🏗️ Architecture Highlights
- **BullMQ Integration** - Leverages BullMQ's FlowProducer for robust job orchestration
- **Redis-backed** - Persistent job queues with Redis
- **Embeddable** - Drop into any Node.js/Bun application
- **Extensible** - Plugin-based node executor system
- **Production-ready** - Error handling, graceful shutdown, and observability built-in
- **Lightweight** - Minimal dependencies, no UI overhead

## 🎨 What Can You Build?

### **Automation Platforms**
Build your own n8n, Zapier, or Make.com:
- 🎯 **Domain-Specific Automation** - Create automation tools for specific industries (e-commerce, marketing, finance)
- 🎨 **Custom Visual Builders** - Build your own drag-and-drop workflow UI on top of SPANE
- 🏢 **Enterprise Automation** - White-label automation platforms for enterprise clients
- 🌐 **Multi-Tenant SaaS** - Launch a workflow automation SaaS product

### **Embedded Workflow Features**
Add workflow capabilities to existing products:
- 📊 **Analytics Pipelines** - Let users create custom data transformation workflows
- 🤖 **AI Agent Orchestration** - Build LangChain-style agent workflows with custom logic
- 📧 **Marketing Automation** - Embed drip campaigns and customer journeys into your CRM
- 🔄 **ETL/Data Pipelines** - Create Airflow-like data orchestration within your app
- 🎮 **Game Event Systems** - Complex event-driven game mechanics and quests

### **Internal Tools**
Power your backend infrastructure:
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
- **Input Data** - Data passed to this node
- **Previous Results** - Results from all upstream nodes

### Execution Flow

1. **Enqueue** - Workflow is submitted to the engine
2. **DAG Resolution** - Engine builds execution tree using FlowProducer
3. **Parallel Execution** - Independent nodes run concurrently
4. **Dependency Management** - Nodes wait for upstream dependencies
5. **Result Aggregation** - Results stored in state store
6. **Completion** - Workflow marked as completed/failed

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

```bash
bun run examples/dlq.ts
```

### Example 2: Pause/Resume/Cancel

See [`examples/cancellation-pause.ts`](./examples/cancellation-pause.ts) for examples of:
- Pausing running workflows
- Resuming paused workflows
- Cancelling workflows mid-execution
- Timeout handling

```bash
bun run examples/cancellation-pause.ts
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
│  │ FlowProducer │  │ Node Queue   │  │  DLQ Queue   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
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
3. **DAG Building** → `buildFlowTree()` creates BullMQ flow structure
4. **Job Creation** → `FlowProducer` adds jobs with dependencies to Redis
5. **Worker Processing** → `NodeWorker` picks up jobs and executes
6. **Node Execution** → `NodeRegistry` provides executor for node type
7. **Result Storage** → Results saved to `ExecutionStateStore`
8. **Completion Check** → Engine checks if all nodes completed
9. **Status Update** → Workflow marked as completed/failed

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
- [x] REST API
- [x] Queue statistics

### 🚧 In Progress
- [ ] Data passing between nodes (currently requires manual fetching from state store)
- [ ] Persistent state store (Postgres/MongoDB adapter)

### 📅 Planned Features

#### High Priority
- [ ] **Conditional Branching** - If/else logic in DAG
- [ ] **Sub-workflows** - Reusable workflow composition
- [ ] **Execution Logging** - Per-node execution logs and traces
- [ ] **Webhook Triggers** - Event-based workflow activation
- [ ] **Cron Scheduling** - Time-based workflow triggers

#### Medium Priority
- [ ] **Rate Limiting** - Per-node type rate limits
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
