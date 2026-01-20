import type { WorkflowDefinition, NodeDefinition } from '../types';

/**
 * Validation error types for workflow graph validation.
 */
export type ValidationErrorType =
  | 'cycle'
  | 'orphan'
  | 'unreachable'
  | 'missing-ref'
  | 'duplicate-id'
  | 'no-entry-node';

/**
 * Validation error result from workflow graph validation.
 */
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  nodeIds?: string[];
  severity: 'error' | 'warning';
}

/**
 * Result of workflow validation with optional errors.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Detects cycles in a workflow graph using DFS.
 *
 * @param workflow - The workflow definition to validate
 * @returns ValidationError if cycle found, null otherwise
 *
 * @example
 * const cycleError = detectCycle(workflow);
 * if (cycleError) {
 *   console.error(cycleError.message); // "Workflow contains a cycle: A → B → C → A"
 * }
 */
export function detectCycle(workflow: WorkflowDefinition): ValidationError | null {
  const nodeMap = new Map<string, NodeDefinition>(
    workflow.nodes.map((n) => [n.id, n])
  );

  // Check for cycles starting from each node
  for (const node of workflow.nodes) {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    if (hasCycleFromNode(node.id, nodeMap, visited, recursionStack)) {
      // Find the cycle path for better error messages
      const cyclePath = findCyclePath(node.id, nodeMap, recursionStack);

      return {
        type: 'cycle',
        severity: 'error',
        message: `Workflow contains a cycle: ${cyclePath.join(' → ')}`,
        nodeIds: cyclePath,
      };
    }
  }

  return null;
}

/**
 * Recursively checks if a cycle exists starting from a node.
 *
 * @param nodeId - Current node ID being visited
 * @param nodeMap - Map of node ID to node definition
 * @param visited - Set of already visited nodes
 * @param recursionStack - Current recursion path for cycle detection
 * @returns true if cycle found, false otherwise
 */
function hasCycleFromNode(
  nodeId: string,
  nodeMap: Map<string, NodeDefinition>,
  visited: Set<string>,
  recursionStack: Set<string>
): boolean {
  if (recursionStack.has(nodeId)) {
    return true; // Cycle detected
  }

  if (visited.has(nodeId)) {
    return false; // Already checked, no cycle
  }

  visited.add(nodeId);
  recursionStack.add(nodeId);

  const node = nodeMap.get(nodeId);
  if (!node) {
    recursionStack.delete(nodeId);
    return false; // Invalid node reference, skip
  }

  // Check all outputs (edges to children)
  for (const childId of node.outputs) {
    if (hasCycleFromNode(childId, nodeMap, visited, recursionStack)) {
      return true;
    }
  }

  recursionStack.delete(nodeId);
  return false;
}

/**
 * Finds the cycle path for error reporting.
 *
 * @param startNodeId - Node where cycle was detected
 * @param nodeMap - Map of node ID to node definition
 * @param recursionStack - Current recursion stack
 * @returns Array of node IDs forming the cycle
 */
function findCyclePath(
  startNodeId: string,
  nodeMap: Map<string, NodeDefinition>,
  recursionStack: Set<string>
): string[] {
  const cycleNodes = Array.from(recursionStack);
  const cycleStart = cycleNodes.find((id) => recursionStack.has(id));

  if (!cycleStart) {
    return [startNodeId];
  }

  return [cycleStart, ...cycleNodes];
}

/**
 * Finds nodes that are not reachable from the entry node.
 *
 * @param workflow - The workflow definition to validate
 * @returns Array of unreachable node IDs
 *
 * @example
 * const unreachable = findUnreachableNodes(workflow);
 * console.warn('Unreachable nodes:', unreachable); // ['node-5', 'node-6']
 */
export function findUnreachableNodes(workflow: WorkflowDefinition): string[] {
  if (!workflow.entryNodeId) {
    return [];
  }

  const reachable = new Set<string>();

  // BFS from entry node to find all reachable nodes
  const queue = [workflow.entryNodeId];

  if (!workflow.entryNodeId) {
    return [];
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;

    if (reachable.has(nodeId)) {
      continue;
    }

    reachable.add(nodeId);

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (node) {
      // Add all children to queue
      node.outputs.forEach((childId) => queue.push(childId));
    }
  }

  // Find nodes not in reachable set
  return workflow.nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id);
}

/**
 * Finds references that point to non-existent nodes.
 *
 * Checks both inputs (nodes that feed into this node) and outputs (nodes this feeds into).
 *
 * @param workflow - The workflow definition to validate
 * @returns Array of invalid node IDs
 *
 * @example
 * const missing = findMissingReferences(workflow);
 * console.error('Missing references:', missing); // ['ghost-node', 'deleted-node']
 */
export function findMissingReferences(workflow: WorkflowDefinition): string[] {
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  const missingRefs = new Set<string>();

  for (const node of workflow.nodes) {
    // Check inputs (nodes that feed into this node)
    for (const inputId of node.inputs) {
      if (!nodeIds.has(inputId)) {
        missingRefs.add(inputId);
      }
    }
    // Check outputs (nodes this node feeds into)
    for (const outputId of node.outputs) {
      if (!nodeIds.has(outputId)) {
        missingRefs.add(outputId);
      }
    }
  }

  return Array.from(missingRefs);
}

/**
 * Finds duplicate node IDs in the workflow.
 *
 * @param workflow - The workflow definition to validate
 * @returns Array of duplicate node IDs
 *
 * @example
 * const duplicates = findDuplicateNodeIds(workflow);
 * console.error('Duplicate IDs:', duplicates); // ['transform-node', 'merge-node']
 */
export function findDuplicateNodeIds(workflow: WorkflowDefinition): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const node of workflow.nodes) {
    if (seen.has(node.id)) {
      duplicates.add(node.id);
    } else {
      seen.add(node.id);
    }
  }

  return Array.from(duplicates);
}

/**
 * Validates that entry node exists in a workflow.
 *
 * Note: For workflows with triggers only (webhook/schedule), the entry node
 * is implicit - the trigger node itself. In such cases, an empty
 * entryNodeId is acceptable.
 *
 * @param workflow - The workflow definition to validate
 * @returns ValidationError if entry node invalid, null otherwise
 */
export function validateEntryNode(workflow: WorkflowDefinition): ValidationError | null {
  // Allow empty entryNodeId if workflow has triggers (implicit entry)
  if (!workflow.entryNodeId && !workflow.triggers) {
    return {
      type: 'no-entry-node',
      severity: 'error',
      message: 'Workflow must have an entryNodeId specified',
    };
  }

  // If entryNodeId is provided, validate it exists
  if (workflow.entryNodeId) {
    const entryNodeExists = workflow.nodes.some((n) => n.id === workflow.entryNodeId);

    if (!entryNodeExists) {
      return {
        type: 'no-entry-node',
        severity: 'error',
        message: `Entry node '${workflow.entryNodeId}' not found in workflow nodes`,
        nodeIds: [workflow.entryNodeId],
      };
    }
  }

  return null;
}

  const entryNodeExists = workflow.nodes.some((n) => n.id === workflow.entryNodeId);

  if (!entryNodeExists) {
    return {
      type: 'no-entry-node',
      severity: 'error',
      message: `Entry node '${workflow.entryNodeId}' not found in workflow nodes`,
      nodeIds: [workflow.entryNodeId],
    };
  }

  return null;
}

/**
 * Performs comprehensive validation of a workflow graph.
 *
 * Validates:
 * 1. Entry node exists
 * 2. No cycles in the graph
 * 3. No unreachable nodes (orphans)
 * 4. No missing references
 * 5. No duplicate node IDs
 *
 * @param workflow - The workflow definition to validate
 * @returns ValidationResult with valid flag and array of errors
 *
 * @example
 * const result = validateWorkflow(workflow);
 * if (!result.valid) {
 *   result.errors.forEach(error => console.error(error.message));
 * }
 */
export function validateWorkflow(workflow: WorkflowDefinition): ValidationResult {
  const errors: ValidationError[] = [];

  // 1. Validate entry node
  const entryNodeError = validateEntryNode(workflow);
  if (entryNodeError) {
    errors.push(entryNodeError);
  }

  // 2. Detect cycles (critical error)
  const cycleError = detectCycle(workflow);
  if (cycleError) {
    errors.push(cycleError);
  }

  // 3. Find duplicate node IDs
  const duplicateIds = findDuplicateNodeIds(workflow);
  if (duplicateIds.length > 0) {
    errors.push({
      type: 'duplicate-id',
      severity: 'error',
      message: `Duplicate node IDs found: ${duplicateIds.join(', ')}`,
      nodeIds: duplicateIds,
    });
  }

  // 4. Find missing references (invalid inputs)
  const missingRefs = findMissingReferences(workflow);
  if (missingRefs.length > 0) {
    errors.push({
      type: 'missing-ref',
      severity: 'error',
      message: `References to non-existent nodes: ${missingRefs.join(', ')}`,
      nodeIds: missingRefs,
    });
  }

  // 5. Find unreachable nodes (warning, not error)
  const unreachableNodes = findUnreachableNodes(workflow);
  if (unreachableNodes.length > 0) {
    errors.push({
      type: 'unreachable',
      severity: 'warning',
      message: `Nodes not reachable from entry node: ${unreachableNodes.join(', ')}`,
      nodeIds: unreachableNodes,
    });
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  };
}

/**
 * Quick check if workflow is valid (only checks for errors, not warnings).
 *
 * @param workflow - The workflow definition to validate
 * @returns true if workflow has no errors, false otherwise
 */
export function isValidWorkflow(workflow: WorkflowDefinition): boolean {
  return validateWorkflow(workflow).valid;
}
