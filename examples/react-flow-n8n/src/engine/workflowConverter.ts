import { Edge } from '@xyflow/react';
import { TriggerNodeData } from '../nodes/TriggerNode';
import { ConditionNodeData } from '../nodes/ConditionNode';

export interface WorkflowDefinition {
    nodes: WorkflowNode[];
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
    dependencies: string[];
    condition?: {
        expression: string;
        branch: 'true' | 'false';
    };
}

export function convertToWorkflow(
    nodes: any[],
    edges: Edge[]
): WorkflowDefinition {
    const workflowNodes: WorkflowNode[] = [];
    let trigger: WorkflowDefinition['trigger'] | undefined;

    // Find trigger node
    const triggerNode = nodes.find(n => n.type === 'trigger');
    if (triggerNode) {
        const triggerData = triggerNode.data as TriggerNodeData;
        trigger = {
            type: triggerData.type,
            config: triggerData.config || {}
        };
    }

    // Convert each node
    nodes.forEach(node => {
        if (node.type === 'trigger') return; // Skip trigger, handled separately

        // Find dependencies (incoming edges)
        const incomingEdges = edges.filter(e => e.target === node.id);
        const dependencies = incomingEdges.map(e => e.source);

        // Check if this is a conditional branch
        let condition: WorkflowNode['condition'] | undefined;
        const incomingEdge = incomingEdges[0];
        if (incomingEdge?.sourceHandle === 'true' || incomingEdge?.sourceHandle === 'false') {
            const sourceNode = nodes.find(n => n.id === incomingEdge.source);
            if (sourceNode?.type === 'condition') {
                const conditionData = sourceNode.data as ConditionNodeData;
                condition = {
                    expression: conditionData.config?.condition || 'true',
                    branch: incomingEdge.sourceHandle as 'true' | 'false'
                };
            }
        }

        const workflowNode: WorkflowNode = {
            id: node.id,
            name: node.data.label,
            type: node.type || 'action',
            config: node.data.config || {},
            dependencies,
            ...(condition && { condition })
        };

        workflowNodes.push(workflowNode);
    });

    return {
        nodes: workflowNodes,
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
