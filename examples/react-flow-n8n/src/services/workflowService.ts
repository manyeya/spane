/**
 * WorkflowService - Handles all workflow CRUD operations
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.4, 3.3, 8.1, 8.3
 * 
 * Aligned with react-flow-backend.ts API endpoints
 */

// Use relative URL to leverage Vite's proxy configuration
// This avoids CORS issues in development
const API_BASE_URL = '';

// Define local types to avoid dependency on reactflow package in service layer
export interface Node {
    id: string;
    type?: string;
    position: { x: number; y: number };
    data?: Record<string, unknown>;
}

export interface Edge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
}

export interface WorkflowSummary {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    nodeCount: number;
    version: number;
}

export interface WorkflowVersion {
    versionId: number;
    version: number;
    createdAt: Date;
    changeNotes?: string;
    createdBy?: string;
}

export interface WorkflowDefinition {
    id: string;
    name: string;
    nodes: Node[];
    edges: Edge[];
    viewport?: { x: number; y: number; zoom: number };
    triggers?: WorkflowTrigger[];
    entryNodeId?: string;
}

export interface WorkflowTrigger {
    type: 'webhook' | 'schedule';
    config: {
        path?: string;
        method?: string;
        cron?: string;
        timezone?: string;
    };
}


export interface SerializedWorkflow {
    version: 1;
    id: string;
    name: string;
    nodes: SerializedNode[];
    edges: SerializedEdge[];
    viewport?: { x: number; y: number; zoom: number };
    triggers?: WorkflowTrigger[];
    entryNodeId?: string;
}

export interface SerializedNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: {
        label: string;
        type?: string;
        config: Record<string, unknown>;
    };
}

export interface SerializedEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}

interface APIResponse<T> {
    success: boolean;
    error?: string;
    workflows?: T[];
    workflow?: T;
    workflowId?: string;
    versions?: WorkflowVersion[];
    count?: number;
}

/**
 * Serializes a workflow definition to JSON format for persistence
 */
export function serializeWorkflow(
    id: string,
    name: string,
    nodes: Node[],
    edges: Edge[],
    viewport?: { x: number; y: number; zoom: number },
    triggers?: WorkflowTrigger[],
    entryNodeId?: string
): SerializedWorkflow {
    const serializedNodes: SerializedNode[] = nodes.map(node => ({
        id: node.id,
        type: node.type || 'default',
        position: { x: node.position.x, y: node.position.y },
        data: {
            label: String(node.data?.label ?? ''),
            type: node.data?.type as string | undefined,
            config: (node.data?.config as Record<string, unknown>) || {},
        },
    }));

    const serializedEdges: SerializedEdge[] = edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
    }));

    return {
        version: 1,
        id,
        name,
        nodes: serializedNodes,
        edges: serializedEdges,
        viewport,
        triggers,
        entryNodeId,
    };
}

/**
 * Deserializes a workflow from JSON format back to React Flow format
 */
export function deserializeWorkflow(serialized: SerializedWorkflow): WorkflowDefinition {
    const nodes: Node[] = serialized.nodes.map(node => ({
        id: node.id,
        type: node.type,
        position: { x: node.position.x, y: node.position.y },
        data: {
            label: node.data.label,
            type: node.data.type,
            config: node.data.config,
        },
    }));

    const edges: Edge[] = serialized.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
    }));

    return {
        id: serialized.id,
        name: serialized.name,
        nodes,
        edges,
        viewport: serialized.viewport,
        triggers: serialized.triggers,
        entryNodeId: serialized.entryNodeId,
    };
}


/**
 * WorkflowService class for managing workflow CRUD operations
 * Uses the react-flow-backend.ts API endpoints
 */
export class WorkflowService {
    private baseUrl: string;

    constructor(baseUrl: string = API_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Lists all workflows from the backend
     * Endpoint: GET /api/workflows
     * Requirements: 1.1
     */
    async listWorkflows(): Promise<WorkflowSummary[]> {
        const response = await fetch(`${this.baseUrl}/api/workflows`);
        const data: APIResponse<Record<string, unknown>> = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to list workflows');
        }

        const workflows = data.workflows || [];
        return workflows.map(w => this.toWorkflowSummary(w));
    }

    /**
     * Gets a specific workflow by ID, optionally at a specific version
     * Endpoint: GET /api/workflows/:workflowId/versions/:version (for versioned)
     * Requirements: 1.2, 3.1, 3.2
     */
    async getWorkflow(workflowId: string, version?: number): Promise<WorkflowDefinition> {
        // For versioned workflow, use the versions endpoint
        const url = version !== undefined
            ? `${this.baseUrl}/api/workflows/${workflowId}/versions/${version}`
            : `${this.baseUrl}/api/workflows/${workflowId}`;

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to get workflow: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success === false) {
            throw new Error(data.error || 'Failed to get workflow');
        }

        // Handle the workflow data - it may be in data.workflow or directly in data
        const workflow = data.workflow || data;
        
        // Check if it has reactFlowData (stored by backend)
        if (workflow.reactFlowData) {
            return {
                id: workflow.id,
                name: workflow.name,
                nodes: workflow.reactFlowData.nodes || [],
                edges: workflow.reactFlowData.edges || [],
                viewport: workflow.reactFlowData.viewport,
                triggers: workflow.triggers,
                entryNodeId: workflow.entryNodeId,
            };
        }

        // If it's a serialized workflow format
        if (workflow.version === 1 && Array.isArray(workflow.nodes)) {
            return deserializeWorkflow(workflow as SerializedWorkflow);
        }

        // Convert from spane format (nodes with inputs/outputs) to React Flow format
        return this.convertFromSpaneFormat(workflow);
    }

    /**
     * Creates a new workflow by registering it with the engine
     * Endpoint: POST /api/workflows
     * Requirements: 1.3, 2.2, 2.4
     */
    async createWorkflow(name: string, nodes: Node[], edges: Edge[]): Promise<string> {
        if (!name || name.trim() === '') {
            throw new Error('Workflow name cannot be empty');
        }

        const entryNodeId = this.findEntryNodeId(nodes, edges);
        
        // Send the full React Flow node data to preserve positions, configs, etc.
        const workflowData = {
            name: name.trim(),
            nodes: nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: node.data,
            })),
            edges: edges.map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
            })),
            entryNodeId,
        };

        const response = await fetch(`${this.baseUrl}/api/workflows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(workflowData),
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to create workflow');
        }

        return data.workflowId;
    }

    /**
     * Updates an existing workflow
     * Endpoint: PUT /api/workflows/:workflowId
     * Requirements: 3.3
     */
    async updateWorkflow(workflowId: string, nodes: Node[], edges: Edge[]): Promise<void> {
        const existing = await this.getWorkflow(workflowId);
        const entryNodeId = this.findEntryNodeId(nodes, edges);

        // Send the full React Flow node data to preserve positions, configs, etc.
        const workflowData = {
            name: existing.name,
            nodes: nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: node.data,
            })),
            edges: edges.map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
            })),
            entryNodeId,
            triggers: existing.triggers,
        };

        const response = await fetch(`${this.baseUrl}/api/workflows/${workflowId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(workflowData),
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to update workflow');
        }
    }

    /**
     * Deletes a workflow (soft delete/deactivate)
     * Note: DELETE endpoint may not be implemented in backend yet
     * Requirements: 1.4
     */
    async deleteWorkflow(workflowId: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/workflows/${workflowId}`, {
            method: 'DELETE',
        });

        // Handle case where endpoint doesn't exist
        if (response.status === 404) {
            console.warn('Delete endpoint not implemented yet');
            return;
        }

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete workflow');
        }
    }


    /**
     * Gets version history for a workflow
     * Endpoint: GET /api/workflows/:workflowId/versions
     * Requirements: 8.1
     */
    async getVersionHistory(workflowId: string): Promise<WorkflowVersion[]> {
        const response = await fetch(`${this.baseUrl}/api/workflows/${workflowId}/versions`);
        const data = await response.json();

        if (!data.success) {
            // Version history may not be supported
            if (data.error?.includes('not supported')) {
                return [];
            }
            throw new Error(data.error || 'Failed to get version history');
        }

        return (data.versions || []).map((v: Record<string, unknown>) => ({
            versionId: (v.versionId as number) || (v.version as number),
            version: v.version as number,
            createdAt: new Date(v.createdAt as string),
            changeNotes: v.changeNotes as string | undefined,
            createdBy: v.createdBy as string | undefined,
        }));
    }

    /**
     * Restores a workflow to a previous version
     * Requirements: 8.3
     */
    async restoreVersion(workflowId: string, version: number): Promise<void> {
        // Get the specific version
        const versionedWorkflow = await this.getWorkflow(workflowId, version);

        // Save it as a new version (creates a new version based on the old one)
        await this.updateWorkflow(workflowId, versionedWorkflow.nodes, versionedWorkflow.edges);
    }

    /**
     * Converts a workflow record to a summary object
     */
    private toWorkflowSummary(workflow: Record<string, unknown>): WorkflowSummary {
        const nodes = (workflow.nodes as unknown[]) || [];
        
        return {
            id: workflow.id as string,
            name: (workflow.name as string) || 'Unnamed Workflow',
            createdAt: workflow.createdAt ? new Date(workflow.createdAt as string) : new Date(),
            updatedAt: workflow.updatedAt ? new Date(workflow.updatedAt as string) : new Date(),
            nodeCount: nodes.length,
            version: (workflow.version as number) || 1,
        };
    }

    /**
     * Finds the entry node ID from nodes and edges
     */
    private findEntryNodeId(nodes: Node[], edges: Edge[]): string | undefined {
        // Find trigger node first
        const triggerNode = nodes.find(n => 
            n.type === 'trigger' || 
            n.data?.type === 'trigger' ||
            n.type === 'triggerNode'
        );
        if (triggerNode) return triggerNode.id;

        // Find node with no incoming edges
        const targetIds = new Set(edges.map(e => e.target));
        const entryNode = nodes.find(n => !targetIds.has(n.id));
        return entryNode?.id || nodes[0]?.id;
    }

    /**
     * Converts from Spane workflow format to React Flow format
     */
    private convertFromSpaneFormat(workflow: Record<string, unknown>): WorkflowDefinition {
        const spaneNodes = (workflow.nodes as Array<Record<string, unknown>>) || [];
        
        // Convert spane nodes to React Flow nodes
        const nodes: Node[] = spaneNodes.map((node, index) => ({
            id: node.id as string,
            type: node.type as string,
            position: { x: 100 + (index % 3) * 200, y: 100 + Math.floor(index / 3) * 150 },
            data: {
                label: node.id as string,
                type: node.type as string,
                config: (node.config as Record<string, unknown>) || {},
            },
        }));

        // Reconstruct edges from inputs/outputs
        const edges: Edge[] = [];
        for (const node of spaneNodes) {
            const outputs = (node.outputs as string[]) || [];
            for (const targetId of outputs) {
                edges.push({
                    id: `${node.id}-${targetId}`,
                    source: node.id as string,
                    target: targetId,
                });
            }
        }

        return {
            id: workflow.id as string,
            name: (workflow.name as string) || 'Unnamed Workflow',
            nodes,
            edges,
            triggers: workflow.triggers as WorkflowTrigger[] | undefined,
            entryNodeId: workflow.entryNodeId as string | undefined,
        };
    }
}

// Export a default instance
export const workflowService = new WorkflowService();
