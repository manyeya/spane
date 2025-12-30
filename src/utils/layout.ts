
import dagre from 'dagre';

interface Position {
    x: number;
    y: number;
}

interface ReactFlowNode {
    id: string;
    position: Position;
    data: any;
    type?: string;
    width?: number;
    height?: number;
}

interface ReactFlowEdge {
    id: string;
    source: string;
    target: string;
    data?: any;
}

interface LayoutOptions {
    direction?: 'TB' | 'LR';
    nodeWidth?: number;
    nodeHeight?: number;
}

/**
 * Applies dagre layout to a set of nodes and edges.
 * Returns the nodes with updated positions.
 */
export function applyAutoLayout(
    nodes: ReactFlowNode[],
    edges: ReactFlowEdge[],
    options: LayoutOptions = {}
): { nodes: ReactFlowNode[]; edges: ReactFlowEdge[] } {
    const {
        direction = 'TB',
        nodeWidth = 200,
        nodeHeight = 80
    } = options;

    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        // Use node dimensions if available, otherwise use defaults
        const width = node.width || node.data?.width || nodeWidth;
        const height = node.height || node.data?.height || nodeHeight;

        dagreGraph.setNode(node.id, { width, height });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);

        // Dagre returns the center point of the node. React Flow expects top-left.
        // We shift the node based on its width/height.
        const width = node.width || node.data?.width || nodeWidth;
        const height = node.height || node.data?.height || nodeHeight;

        return {
            ...node,
            position: {
                x: nodeWithPosition.x - width / 2,
                y: nodeWithPosition.y - height / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
}
