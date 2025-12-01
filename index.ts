import { WorkflowEngine } from './workflow-engine';
import { WorkflowAPIController } from './api';
import { InMemoryExecutionStore } from './inmemory-store';
import { NodeRegistry } from './registry';
import { Redis } from 'ioredis';

// Initialize Redis connection
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Initialize components
const nodeRegistry = new NodeRegistry();
const stateStore = new InMemoryExecutionStore();
const engine = new WorkflowEngine(nodeRegistry, stateStore, redis);
const api = new WorkflowAPIController(engine, stateStore);

// Start the server
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
api.listen(PORT);

console.log(`🚀 SPANE workflow engine started on port ${PORT}`);
console.log(`📊 Health check: http://localhost:${PORT}/health`);
console.log(`📚 API docs: http://localhost:${PORT}/api/stats`);