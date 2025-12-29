# BullMQ Engine Improvements - Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      WorkflowEngine                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │QueueManager │  │FlowProducer │  │  EventStreamManager     │  │
│  │ (existing)  │  │   (NEW)     │  │  (simplified)           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    WorkerManager                            ││
│  │  ┌─────────────────┐  ┌──────────────────────────────────┐ ││
│  │  │ Native Rate     │  │ Sandboxed Processor (optional)   │ ││
│  │  │ Limiting        │  │ useWorkerThreads: true           │ ││
│  │  └─────────────────┘  └──────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    NodeProcessor                            ││
│  │  - Main workflow: existing pattern (enqueue children)      ││
│  │  - Sub-workflows: FlowProducer + getChildrenValues()       ││
│  │  - No custom rate limiting (delegated to Worker)           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Designs

### 1. FlowProducer for Sub-Workflows

#### Current Flow (Checkpoint/Resume)
```
Parent Node → Start Child Execution → Checkpoint → Poll/Callback → Resume → Aggregate
```

#### New Flow (FlowProducer)
```
Parent Node → FlowProducer.add(parent + children) → BullMQ waits → getChildrenValues()
```

#### Implementation

**File: `engine/queue-manager.ts`**
```typescript
import { Queue, QueueEvents, FlowProducer } from 'bullmq';

export class QueueManager {
    public flowProducer: FlowProducer; // NEW
    
    constructor(...) {
        // ... existing code ...
        
        // Initialize FlowProducer for sub-workflow handling
        this.flowProducer = new FlowProducer({
            connection: redisConnection,
            prefix: 'spane',
        });
    }
    
    async close(): Promise<void> {
        await this.flowProducer.close(); // NEW
        // ... existing close logic ...
    }
}
```

**File: `engine/node-processor.ts`**
```typescript
private async executeSubWorkflowWithFlow(
    parentExecutionId: string,
    parentNodeId: string,
    config: SubWorkflowConfig,
    inputData: any,
    depth: number,
    job: Job
): Promise<ExecutionResult> {
    const subWorkflow = await this.getWorkflowWithLazyLoad(config.workflowId);
    if (!subWorkflow) {
        return { success: false, error: `Sub-workflow '${config.workflowId}' not found` };
    }

    // Apply input mapping
    const mappedInput = this.applyInputMapping(inputData, config.inputMapping);

    // Create child execution in state store
    const childExecutionId = await this.stateStore.createExecution(
        config.workflowId,
        parentExecutionId,
        depth + 1,
        mappedInput
    );

    // Build flow with entry nodes as children
    const entryNodes = subWorkflow.nodes.filter(n => n.inputs.length === 0);
    
    const flow = await this.queueManager.flowProducer.add({
        name: 'sub-workflow-aggregator',
        queueName: 'node-execution',
        data: {
            executionId: childExecutionId,
            workflowId: config.workflowId,
            nodeId: '__aggregator__',
            isSubWorkflowAggregator: true,
        },
        opts: {
            jobId: `${childExecutionId}-aggregator`,
        },
        children: entryNodes.map(node => ({
            name: 'process-node',
            queueName: 'node-execution',
            data: {
                executionId: childExecutionId,
                workflowId: config.workflowId,
                nodeId: node.id,
                inputData: mappedInput,
            },
            opts: {
                jobId: `${childExecutionId}-${node.id}`,
                failParentOnFailure: !config.continueOnFail,
            },
        })),
    });

    // Wait handled by BullMQ - parent job processes when children complete
    // The aggregator node will call getChildrenValues() to collect results
    
    return {
        success: true,
        data: { flowJobId: flow.job.id, childExecutionId },
    };
}
```

#### Aggregator Processing
```typescript
// In processNodeJob, handle aggregator nodes:
if (data.isSubWorkflowAggregator) {
    const childrenValues = await job.getChildrenValues();
    
    // Apply output mapping
    const mappedOutput = this.applyOutputMapping(childrenValues, config.outputMapping);
    
    return { success: true, data: mappedOutput };
}
```

---

### 2. Native Rate Limiting

#### Current Implementation (Remove)
```typescript
// node-processor.ts - TO BE REMOVED
const rateLimit = this.registry.getRateLimit(node.type);
if (rateLimit) {
    const key = `rate-limit:${node.type}:${Math.floor(Date.now() / 1000)}`;
    const current = await this.redisConnection.incr(key);
    if (current === 1) {
        await this.redisConnection.expire(key, 2);
    }
    if (current > rateLimit) {
        await job.moveToDelayed(Date.now() + 1000, job.token);
        throw new DelayedError();
    }
}
```

#### New Implementation

**File: `engine/worker-manager.ts`**
```typescript
import { Worker, Job, DelayedError, RateLimitError } from 'bullmq';

export interface WorkerConfig {
    concurrency: number;
    rateLimiter?: {
        max: number;
        duration: number;
    };
    useWorkerThreads?: boolean;
    processorFile?: string;
}

export class WorkerManager {
    startWorkers(config: WorkerConfig): void {
        const workerOptions: any = {
            connection: this.redisConnection,
            concurrency: config.concurrency,
            prefix: 'spane',
        };

        // Add native rate limiting if configured
        if (config.rateLimiter) {
            workerOptions.limiter = {
                max: config.rateLimiter.max,
                duration: config.rateLimiter.duration,
            };
        }

        this.nodeWorker = new Worker<NodeJobData>(
            'node-execution',
            async (job: Job<NodeJobData>) => {
                return this.nodeProcessor.processNodeJob(job.data, job);
            },
            workerOptions
        );
    }
}
```

**Manual Rate Limiting for External APIs (in NodeProcessor)**
```typescript
// For dynamic rate limiting based on API responses (e.g., 429)
if (externalApiRateLimited) {
    await this.workerManager.nodeWorker.rateLimit(retryAfterMs);
    throw Worker.RateLimitError();
}
```

---

### 3. Job Schedulers (upsertJobScheduler)

#### Current Implementation (Replace)
```typescript
// workflow-engine.ts - CURRENT
const existingJobs = await this.queueManager.workflowQueue.getRepeatableJobs();
const existingJob = existingJobs.find(job => job.id === jobId);
if (existingJob) {
    await this.queueManager.workflowQueue.removeRepeatableByKey(existingJob.key);
}
await this.queueManager.workflowQueue.add('workflow-execution', {...}, { repeat: {...} });
```

#### New Implementation
```typescript
// workflow-engine.ts - NEW
async registerWorkflow(workflow: WorkflowDefinition, changeNotes?: string): Promise<void> {
    // ... existing save logic ...

    // Handle Schedule Triggers with upsertJobScheduler
    if (workflow.triggers) {
        for (const trigger of workflow.triggers) {
            if (trigger.type === 'schedule') {
                const schedulerId = `schedule:${workflow.id}:${trigger.config.cron}`;

                await this.queueManager.workflowQueue.upsertJobScheduler(
                    schedulerId,
                    {
                        pattern: trigger.config.cron,
                        tz: trigger.config.timezone,
                    },
                    {
                        name: 'workflow-execution',
                        data: { workflowId: workflow.id },
                    }
                );

                logger.info(
                    { workflowId: workflow.id, cron: trigger.config.cron },
                    `⏰ Upserted schedule for workflow ${workflow.id}`
                );
            }
        }
    }
}

// Remove schedule when workflow is deactivated
async deactivateWorkflowSchedules(workflowId: string): Promise<void> {
    const schedulers = await this.queueManager.workflowQueue.getJobSchedulers();
    for (const scheduler of schedulers) {
        if (scheduler.id.startsWith(`schedule:${workflowId}:`)) {
            await this.queueManager.workflowQueue.removeJobScheduler(scheduler.id);
        }
    }
}
```

---

### 4. Flow Dependency Options

#### For Sub-Workflows (FlowProducer)
```typescript
// In executeSubWorkflowWithFlow
children: entryNodes.map(node => ({
    name: 'process-node',
    queueName: 'node-execution',
    data: {...},
    opts: {
        // Propagate failure to parent sub-workflow node
        failParentOnFailure: !nodeConfig.continueOnFail,
        
        // OR: Continue parent even if this child fails
        ignoreDependencyOnFailure: nodeConfig.continueOnFail,
    },
})),
```

#### For Main Workflow Nodes (Keep Existing)
The `continueOnFail` logic in `processNodeJob` remains for main workflow nodes since they don't use FlowProducer.

---

### 5. Sandboxed Processors

#### File Structure
```
engine/
├── processors/
│   └── node-processor.sandbox.ts  # Sandboxed processor file
├── node-processor.ts              # Main processor (inline or delegates)
└── worker-manager.ts              # Configures sandboxing
```

#### Sandboxed Processor File
**File: `engine/processors/node-processor.sandbox.ts`**
```typescript
import { SandboxedJob } from 'bullmq';

// This runs in a separate worker thread
module.exports = async (job: SandboxedJob) => {
    const { executionId, workflowId, nodeId, inputData } = job.data;
    
    // Import processor dynamically to avoid module loading issues
    const { createSandboxedProcessor } = await import('../node-processor');
    const processor = createSandboxedProcessor();
    
    return processor.processNodeJob(job.data, job);
};
```

#### Worker Configuration
**File: `engine/worker-manager.ts`**
```typescript
startWorkers(config: WorkerConfig): void {
    const processorPath = config.useWorkerThreads
        ? path.join(__dirname, 'processors', 'node-processor.sandbox.js')
        : undefined;

    this.nodeWorker = new Worker<NodeJobData>(
        'node-execution',
        processorPath || async (job) => this.nodeProcessor.processNodeJob(job.data, job),
        {
            connection: this.redisConnection,
            concurrency: config.concurrency,
            prefix: 'spane',
            useWorkerThreads: config.useWorkerThreads,
        }
    );
}
```

---

### 6. Simplified Event Streaming

#### Current: Custom QueueEventsProducer
```typescript
// event-stream.ts - CURRENT (complex)
await this.queueEventsProducer.publishEvent({
    eventName: `workflow:${event.status}`,
    ...payload,
});
```

#### New: Use job.updateProgress()
```typescript
// event-emitter.ts - SIMPLIFIED
export class WorkflowEventEmitter {
    static async emitNodeStarted(job: Job, nodeId: string, ...): Promise<void> {
        // Use native progress events instead of custom publishing
        await job.updateProgress({
            eventType: 'node',
            nodeId,
            nodeStatus: 'running',
            timestamp: Date.now(),
        });
    }
    
    static async emitWorkflowStatus(job: Job, status: WorkflowStatus): Promise<void> {
        await job.updateProgress({
            eventType: 'workflow',
            workflowStatus: status,
            timestamp: Date.now(),
        });
    }
}
```

#### EventStreamManager Simplification
```typescript
// event-stream.ts - SIMPLIFIED
export class EventStreamManager {
    // Remove QueueEventsProducer - not needed
    // private queueEventsProducer: QueueEventsProducer; // REMOVE
    
    constructor(redisConnection: Redis, stateStore: IExecutionStateStore) {
        // Single QueueEvents instance for all events
        this.queueEvents = new QueueEvents('node-execution', {
            connection: redisConnection,
            prefix: 'spane',
        });
        
        this.emitter = new EventEmitter();
    }

    async start(): Promise<void> {
        // Listen to native progress events only
        this.queueEvents.on('progress', ({ jobId, data }) => {
            const event = this.parseProgressPayload(data);
            if (event) {
                this.emitter.emit('event', event);
            }
        });

        // Native completed/failed events
        this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
            // Emit completion event
        });

        this.queueEvents.on('failed', ({ jobId, failedReason }) => {
            // Emit failure event
        });
    }
    
    // Remove emit() method - no longer publishing custom events
    // Events flow through job.updateProgress() → QueueEvents.on('progress')
}
```

---

## Migration Strategy

### Phase 1: Non-Breaking Changes
1. Add FlowProducer to QueueManager
2. Add upsertJobScheduler alongside existing code
3. Add sandboxed processor file (disabled by default)

### Phase 2: Switch Implementations
1. Migrate sub-workflows to FlowProducer
2. Switch to upsertJobScheduler
3. Enable native rate limiting

### Phase 3: Cleanup
1. Remove custom rate limiting code
2. Remove checkpoint/resume sub-workflow code
3. Simplify EventStreamManager
4. Remove QueueEventsProducer

---

## Testing Strategy

1. **Unit Tests**: Each component in isolation
2. **Integration Tests**: Full workflow execution with new implementations
3. **A/B Testing**: Run old and new implementations in parallel during migration
4. **Performance Tests**: Compare throughput before/after

---

## Rollback Plan

Each change is behind a feature flag or configuration option:
- `useFlowProducerForSubWorkflows: boolean`
- `useNativeRateLimiting: boolean`
- `useJobSchedulers: boolean`
- `useWorkerThreads: boolean`
- `useSimplifiedEventStream: boolean`
