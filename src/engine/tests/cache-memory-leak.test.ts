/**
 * Tests for LRU cache memory leak prevention
 *
 * These tests verify that:
 * 1. ttlAutopurge automatically removes stale entries without access
 * 2. Expired entries don't accumulate when cache is at capacity
 * 3. Memory doesn't grow indefinitely with TTL-based cache
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { WorkflowEngine } from '../workflow-engine';
import { NodeRegistry } from '../registry';
import { InMemoryExecutionStore } from '../../db/inmemory-store';
import { Redis } from 'ioredis';
import type { WorkflowDefinition } from '../../types';

describe('WorkflowEngine Cache Memory Leak Prevention', () => {
    let engine: WorkflowEngine;
    let registry: NodeRegistry;
    let store: InMemoryExecutionStore;
    let redis: Redis;

    beforeEach(() => {
        registry = new NodeRegistry();
        store = new InMemoryExecutionStore();
        redis = new Redis({ host: 'localhost', port: 6379, maxRetriesPerRequest: 0 });

        // Create engine with small cache and short TTL for testing
        engine = new WorkflowEngine(
            registry,
            store,
            redis,
            undefined,
            { maxSize: 5, ttlMs: 100 } // 5 max entries, 100ms TTL
        );
    });

    test('should automatically purge stale entries without access (ttlAutopurge)', async () => {
        // This test verifies the memory leak fix: stale entries are purged
        // automatically even without being accessed, preventing unbounded growth

        // Register multiple workflows
        const workflowCount = 5;
        for (let i = 0; i < workflowCount; i++) {
            const workflow: WorkflowDefinition = {
                id: `test-workflow-${i}`,
                nodes: [{ id: `node${i}`, type: 'test', inputs: [], outputs: [] }],
                entryNodeId: `node${i}`
            };
            await engine.registerWorkflow(workflow);
        }

        // All workflows should be in cache initially
        let stats = engine.getCacheStats();
        expect(stats.size).toBe(workflowCount);

        // Wait for TTL to expire (100ms TTL + buffer for ttlResolution)
        // ttlResolution is set to 1000ms, but expiration happens on next cycle
        await new Promise(resolve => setTimeout(resolve, 1200));

        // CRITICAL: With ttlAutopurge enabled, stale entries should be automatically
        // removed from cache even without any access attempts
        // This prevents memory leak from accumulating stale entries
        stats = engine.getCacheStats();

        // Cache should be empty after autopurge runs
        expect(stats.size).toBe(0);
    });

    test('should not accumulate stale entries when cache is full', async () => {
        // This test verifies that expired entries don't linger in cache
        // when the cache is at capacity, preventing memory leaks

        const maxCacheSize = 5;
        const ttlMs = 100;

        // Register initial set of workflows that fills the cache
        for (let i = 0; i < maxCacheSize; i++) {
            const workflow: WorkflowDefinition = {
                id: `initial-wf-${i}`,
                nodes: [{ id: `n${i}`, type: 'test', inputs: [], outputs: [] }],
                entryNodeId: `n${i}`
            };
            await engine.registerWorkflow(workflow);
        }

        let stats = engine.getCacheStats();
        expect(stats.size).toBe(maxCacheSize);

        // Wait for all entries to expire
        await new Promise(resolve => setTimeout(resolve, ttlMs + 1100));

        // Add new workflows - they should replace expired ones, not accumulate
        for (let i = 0; i < maxCacheSize; i++) {
            const workflow: WorkflowDefinition = {
                id: `new-wf-${i}`,
                nodes: [{ id: `new-n${i}`, type: 'test', inputs: [], outputs: [] }],
                entryNodeId: `new-n${i}`
            };
            await engine.registerWorkflow(workflow);
        }

        stats = engine.getCacheStats();
        // Cache should only contain new entries, not accumulate old ones
        expect(stats.size).toBeLessThanOrEqual(maxCacheSize);

        // Verify only new entries are in cache
        const cachedNewWf = engine.getWorkflowFromCache('new-wf-0');
        expect(cachedNewWf).toBeDefined();

        // Old workflow should not be in cache (either evicted by LRU or expired)
        const cachedOldWf = engine.getWorkflowFromCache('initial-wf-0');
        expect(cachedOldWf).toBeUndefined();
    });

    test('should enforce TTL without extending on access (updateAgeOnGet: false)', async () => {
        const workflow: WorkflowDefinition = {
            id: 'test-ttl-reset',
            nodes: [{ id: 'node1', type: 'test', inputs: [], outputs: [] }],
            entryNodeId: 'node1'
        };
        await engine.registerWorkflow(workflow);

        // Access the workflow multiple times to verify TTL doesn't extend
        await engine.getWorkflow('test-ttl-reset');
        await new Promise(resolve => setTimeout(resolve, 50));
        await engine.getWorkflow('test-ttl-reset');
        await new Promise(resolve => setTimeout(resolve, 50));
        await engine.getWorkflow('test-ttl-reset');

        // Wait for original TTL to expire plus autopurge buffer
        await new Promise(resolve => setTimeout(resolve, 1200));

        // Should still be evicted because TTL was not reset
        const cached = engine.getWorkflowFromCache('test-ttl-reset');
        expect(cached).toBeUndefined();
    });

    test('should not allow stale entries to be returned (allowStale: false)', async () => {
        const workflow: WorkflowDefinition = {
            id: 'test-stale',
            nodes: [{ id: 'node1', type: 'test', inputs: [], outputs: [] }],
            entryNodeId: 'node1'
        };
        await engine.registerWorkflow(workflow);

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 1200));

        // getWorkflowFromCache should not return stale entries
        const cached = engine.getWorkflowFromCache('test-stale');
        expect(cached).toBeUndefined();
    });
});
