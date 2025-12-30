/**
 * Processors Module
 * 
 * This module exports utilities and processors for node execution,
 * including stateless functions that can run in BullMQ worker threads.
 * 
 * @see stateless-utils.ts - Pure functions for sandboxed execution
 * @see serialization.ts - Serialization utilities for worker thread data transfer
 * @see node-processor.sandbox.ts - Sandboxed processor entry point
 */

// Export all stateless utilities
export * from './stateless-utils';

// Export serialization utilities for worker thread data handling
export * from './serialization';
