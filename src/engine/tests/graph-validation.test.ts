import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import type { WorkflowDefinition, NodeDefinition } from '../../types';
import {
  detectCycle,
  findUnreachableNodes,
  findMissingReferences,
  findDuplicateNodeIds,
  validateEntryNode,
  validateWorkflow,
  isValidWorkflow,
  type ValidationError,
} from '../graph-validation';

describe('Graph Validation', () => {
  describe('detectCycle', () => {
    test('detects simple cycle A → B → A', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Cyclic Workflow',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: ['B'], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['A'] },
        ],
      };

      const error = detectCycle(workflow);

      expect(error).not.toBeNull();
      expect(error?.type).toBe('cycle');
      expect(error?.severity).toBe('error');
      expect(error?.nodeIds).toContain('A');
      expect(error?.nodeIds).toContain('B');
      expect(error?.message).toContain('A');
      expect(error?.message).toContain('B');
    });

    test('detects longer cycle A → B → C → A', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Cyclic Workflow',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: ['C'], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['C'] },
          { id: 'C', type: 'action', config: {}, inputs: ['B'], outputs: ['A'] },
        ],
      };

      const error = detectCycle(workflow);

      expect(error).not.toBeNull();
      expect(error?.type).toBe('cycle');
      expect(error?.nodeIds?.length).toBeGreaterThanOrEqual(3);
    });

    test('returns null for valid DAG', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Valid DAG',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['C'] },
          { id: 'C', type: 'action', config: {}, inputs: ['B'], outputs: [] },
        ],
      };

      const error = detectCycle(workflow);

      expect(error).toBeNull();
    });

    test('returns null for empty workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Empty Workflow',
        entryNodeId: '',
        nodes: [],
      };

      const error = detectCycle(workflow);

      expect(error).toBeNull();
    });
  });

  describe('findUnreachableNodes', () => {
    test('finds orphaned nodes not reachable from entry', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Workflow with Orphans',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
          {
            id: 'orphan-1',
            type: 'action',
            config: {},
            inputs: [],
            outputs: [],
          },
          {
            id: 'orphan-2',
            type: 'action',
            config: {},
            inputs: ['ghost'],
            outputs: [],
          },
        ],
      };

      const unreachable = findUnreachableNodes(workflow);

      expect(unreachable).toContain('orphan-1');
      expect(unreachable).toContain('orphan-2');
      expect(unreachable.length).toBe(2);
    });

    test('returns empty array when all nodes reachable', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Fully Connected Workflow',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['C'] },
          { id: 'C', type: 'action', config: {}, inputs: ['B'], outputs: [] },
        ],
      };

      const unreachable = findUnreachableNodes(workflow);

      expect(unreachable).toEqual([]);
    });

    test('handles missing entry node gracefully', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'No Entry Node',
        entryNodeId: '',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
          { id: 'B', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      const unreachable = findUnreachableNodes(workflow);

      expect(unreachable).toEqual([]);
    });
  });

  describe('findMissingReferences', () => {
    test('finds references to non-existent nodes', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Workflow with Invalid References',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          {
            id: 'B',
            type: 'action',
            config: {},
            inputs: ['ghost-node', 'deleted-node'],
            outputs: [],
          },
        ],
      };

      const missing = findMissingReferences(workflow);

      expect(missing).toContain('ghost-node');
      expect(missing).toContain('deleted-node');
      expect(missing.length).toBe(2);
    });

    test('returns empty array when all references valid', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Valid References',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
        ],
      };

      const missing = findMissingReferences(workflow);

      expect(missing).toEqual([]);
    });
  });

  describe('findDuplicateNodeIds', () => {
    test('finds duplicate node IDs', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Workflow with Duplicates',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
          {
            id: 'A',
            type: 'action',
            config: {},
            inputs: [],
            outputs: [],
          },
        ],
      };

      const duplicates = findDuplicateNodeIds(workflow);

      expect(duplicates).toContain('A');
      expect(duplicates.length).toBe(1);
    });

    test('returns empty array when all IDs unique', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Unique IDs',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
        ],
      };

      const duplicates = findDuplicateNodeIds(workflow);

      expect(duplicates).toEqual([]);
    });
  });

  describe('validateEntryNode', () => {
    test('returns null when entry node exists', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Valid Entry',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      const error = validateEntryNode(workflow);

      expect(error).toBeNull();
    });

    test('returns error when entry node not specified', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'No Entry',
        entryNodeId: '',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      const error = validateEntryNode(workflow);

      expect(error).not.toBeNull();
      expect(error?.type).toBe('no-entry-node');
      expect(error?.severity).toBe('error');
      expect(error?.message).toContain('entryNodeId');
    });

    test('returns error when entry node not in nodes', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Invalid Entry',
        entryNodeId: 'non-existent',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      const error = validateEntryNode(workflow);

      expect(error).not.toBeNull();
      expect(error?.type).toBe('no-entry-node');
      expect(error?.severity).toBe('error');
      expect(error?.nodeIds).toEqual(['non-existent']);
    });
  });

  describe('validateWorkflow', () => {
    test('returns valid for correct workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Valid Workflow',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['C'] },
          { id: 'C', type: 'action', config: {}, inputs: ['B'], outputs: [] },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('returns invalid for cyclic workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Cyclic Workflow',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: ['B'], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['C'] },
          { id: 'C', type: 'action', config: {}, inputs: ['B'], outputs: ['A'] },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'cycle')).toBe(true);
      expect(result.errors.some((e) => e.severity === 'error')).toBe(true);
    });

    test('returns invalid with unreachable nodes (warning)', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Workflow with Orphans',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
          {
            id: 'orphan',
            type: 'action',
            config: {},
            inputs: [],
            outputs: [],
          },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.type === 'unreachable')).toBe(true);
      expect(result.errors.some((e) => e.severity === 'warning')).toBe(true);
    });

    test('returns invalid for missing references', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Missing Refs',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['ghost'] },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'missing-ref')).toBe(true);
      expect(result.errors.some((e) => e.severity === 'error')).toBe(true);
    });

    test('detects simple two-node cycle', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-cycle-2nodes',
        name: 'Simple 2-Node Cycle',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: ['B'], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['A'] },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'cycle')).toBe(true);
      expect(result.errors.some((e) => e.severity === 'error')).toBe(true);
    });

    test('returns invalid for duplicate IDs', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Duplicates',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'duplicate-id')).toBe(true);
      expect(result.errors.some((e) => e.severity === 'error')).toBe(true);
    });

    test('returns invalid for no entry node', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'No Entry',
        entryNodeId: '',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.type === 'no-entry-node')).toBe(true);
      expect(result.errors.some((e) => e.severity === 'error')).toBe(true);
    });

    test('combines multiple errors', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Multiple Errors',
        entryNodeId: '',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: ['ghost'], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['C'] },
          { id: 'C', type: 'action', config: {}, inputs: ['B'], outputs: ['A'] },
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      const result = validateWorkflow(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(2);
      expect(result.errors.some((e) => e.type === 'no-entry-node')).toBe(true);
      expect(result.errors.some((e) => e.type === 'duplicate-id')).toBe(true);
      expect(result.errors.some((e) => e.type === 'missing-ref')).toBe(true);
    });
  });

  describe('isValidWorkflow', () => {
    test('returns true for valid workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Valid',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      expect(isValidWorkflow(workflow)).toBe(true);
    });

    test('returns false for workflow with duplicate IDs', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Duplicates',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
        ],
      };

      expect(isValidWorkflow(workflow)).toBe(false);
    });

    test('returns true for workflow with warnings (unreachable nodes)', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'With Orphans',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: [] },
          {
            id: 'orphan',
            type: 'action',
            config: {},
            inputs: [],
            outputs: [],
          },
        ],
      };

      expect(isValidWorkflow(workflow)).toBe(true);
    });

    test('returns false for workflow with errors (missing refs)', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Missing Refs',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: ['ghost'], outputs: [] },
        ],
      };

      expect(isValidWorkflow(workflow)).toBe(false);
    });
  });

  describe('Property-based tests', () => {
    test('detects cycle in simple cyclic workflow', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-cyclic',
        name: 'Cyclic Workflow',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: ['B'], outputs: ['C'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: ['D'] },
          { id: 'C', type: 'action', config: {}, inputs: ['A'], outputs: ['B'] },
          { id: 'D', type: 'action', config: {}, inputs: ['B'], outputs: ['C'] },
        ],
      };

      const error = detectCycle(workflow);
      expect(error?.type).toBe('cycle');
      expect(error?.nodeIds).toContain('A');
      expect(error?.nodeIds).toContain('B');
      expect(error?.nodeIds).toContain('C');
      expect(error?.nodeIds).toContain('D');
    });

    test('valid workflow has no errors', () => {
      const workflow: WorkflowDefinition = {
        id: 'wf-valid',
        name: 'Property Workflow',
        entryNodeId: 'A',
        nodes: [
          { id: 'A', type: 'action', config: {}, inputs: [], outputs: ['B'] },
          { id: 'B', type: 'action', config: {}, inputs: ['A'], outputs: [] },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });
  });
});
