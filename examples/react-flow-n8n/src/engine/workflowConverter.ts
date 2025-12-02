import { Edge } from '@xyflow/react';
import { TriggerNodeData } from '../nodes/TriggerNode';
import { ConditionNodeData } from '../nodes/ConditionNode';

export interface WorkflowDefinition {
    nodes: WorkflowNode[];
    edges: Edge[];
    trigger?: {
        type: string;
        config: any;
    };
}

export interface WorkflowNode {
    id: string;
    name: string;
    type: string;
    config: any;
}

export function convertToWorkflow(
    nodes: any[],
    edges: Edge[]
): WorkflowDefinition {
    const workflowNodes: WorkflowNode[] = nodes.map(node => ({
        id: node.id,
        name: node.data.label,
        type: node.data.type || node.type,
        config: node.data.config || {},
    }));

    const triggerNode = nodes.find(n => n.type === 'trigger');
    let trigger: WorkflowDefinition['trigger'] | undefined;
    if (triggerNode) {
        const triggerData = triggerNode.data as TriggerNodeData;
        trigger = {
            type: triggerData.type,
            config: triggerData.config || {}
        };
    }

    return {
        nodes: workflowNodes,
        edges: edges,
        trigger
    };
}

export function validateWorkflow(nodes: any[], edges: Edge[]): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Check for at least one trigger
    const triggers = nodes.filter(n => n.type === 'trigger');
    if (triggers.length === 0) {
        errors.push('Workflow must have at least one trigger node');
    }
    if (triggers.length > 1) {
        errors.push('Workflow can only have one trigger node');
    }

    // Check for orphaned nodes (except trigger)
    nodes.forEach(node => {
        if (node.type === 'trigger') return;
        const hasIncoming = edges.some(e => e.target === node.id);
        if (!hasIncoming) {
            errors.push(`Node "${node.data.label}" is not connected to any input`);
        }
    });

    // Check for cycles
    const hasCycle = detectCycle(nodes, edges);
    if (hasCycle) {
        errors.push('Workflow contains a cycle, which is not allowed');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

function detectCycle(nodes: any[], edges: Edge[]): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
        visited.add(nodeId);
        recursionStack.add(nodeId);

        const outgoingEdges = edges.filter(e => e.source === nodeId);
        for (const edge of outgoingEdges) {
            if (!visited.has(edge.target)) {
                if (dfs(edge.target)) return true;
            } else if (recursionStack.has(edge.target)) {
                return true;
            }
        }

        recursionStack.delete(nodeId);
        return false;
    };

    for (const node of nodes) {
        if (!visited.has(node.id)) {
            if (dfs(node.id)) return true;
        }
    }

    return false;
}
