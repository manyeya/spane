import { useState, useCallback, useRef, DragEvent } from 'react';
import {
    ReactFlow,
    Controls,
    MiniMap,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    BackgroundVariant,
    NodeTypes
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import TriggerNode from './nodes/TriggerNode';
import ActionNode from './nodes/ActionNode';
import ConditionNode from './nodes/ConditionNode';
import NodePalette, { NodeTemplate } from './components/NodePalette';
import NodeConfigPanel from './components/NodeConfigPanel';
import ExecutionResultsPanel from './components/ExecutionResultsPanel';
import { convertToWorkflow, validateWorkflow } from './engine/workflowConverter';
import ExecutionManager, { ExecutionStatus } from './engine/executionManager';

import './styles/app.css';
import './styles/nodes.css';

const nodeTypes: NodeTypes = {
    trigger: TriggerNode,
    action: ActionNode,
    condition: ConditionNode
};

const executionManager = new ExecutionManager();

function App() {
    const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [selectedNode, setSelectedNode] = useState<any | null>(null);
    const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
    const [isExecuting, setIsExecuting] = useState(false);
    const [nodeResults, setNodeResults] = useState<Record<string, any>>({});
    const [showResults, setShowResults] = useState(false);

    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
    const nodeIdCounter = useRef(0);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

    const onDragOver = useCallback((event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: DragEvent) => {
            event.preventDefault();

            if (!reactFlowWrapper.current || !reactFlowInstance) return;

            const templateData = event.dataTransfer.getData('application/reactflow');
            if (!templateData) return;

            const template: NodeTemplate = JSON.parse(templateData);
            const bounds = reactFlowWrapper.current.getBoundingClientRect();
            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top
            });

            const newNodeId = `node-${nodeIdCounter.current++}`;

            let newNode: any;

            if (template.nodeType === 'trigger') {
                newNode = {
                    id: newNodeId,
                    type: 'trigger',
                    position,
                    data: {
                        label: template.label,
                        type: template.subType as any,
                        config: {},
                        status: 'idle'
                    }
                };
            } else if (template.nodeType === 'action') {
                newNode = {
                    id: newNodeId,
                    type: 'action',
                    position,
                    data: {
                        label: template.label,
                        type: template.subType as any,
                        config: {},
                        status: 'idle'
                    }
                };
            } else {
                newNode = {
                    id: newNodeId,
                    type: 'condition',
                    position,
                    data: {
                        label: template.label,
                        config: {},
                        status: 'idle'
                    }
                };
            }

            setNodes((nds) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes]
    );

    const onDragStart = (event: DragEvent, template: NodeTemplate) => {
        event.dataTransfer.setData('application/reactflow', JSON.stringify(template));
        event.dataTransfer.effectAllowed = 'move';
    };

    const onNodeClick = useCallback((_event: React.MouseEvent, node: any) => {
        setSelectedNode(node);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    const updateNodeData = useCallback(
        (nodeId: string, data: Partial<any>) => {
            setNodes((nds) =>
                nds.map((node) => {
                    if (node.id === nodeId) {
                        const updatedNode = {
                            ...node,
                            data: { ...node.data, ...data }
                        };
                        // Also update selectedNode if it's the same node
                        setSelectedNode((prevSelected: any) =>
                            prevSelected?.id === nodeId ? updatedNode : prevSelected
                        );
                        return updatedNode;
                    }
                    return node;
                })
            );
        },
        [setNodes]
    );

    const handleExecute = async () => {
        // Validate workflow
        const validation = validateWorkflow(nodes, edges);
        if (!validation.valid) {
            alert('Workflow validation failed:\n' + validation.errors.join('\n'));
            return;
        }

        // Convert to workflow definition
        const workflow = convertToWorkflow(nodes, edges);
        console.log('Executing workflow:', workflow);

        setIsExecuting(true);
        setExecutionStatus('running');

        // Update all nodes to running status
        setNodes((nds) =>
            nds.map((node) => ({
                ...node,
                data: { ...node.data, status: 'running' as ExecutionStatus }
            }))
        );

        try {
            console.log('🔄 Starting workflow execution...');
            const result = await executionManager.executeWorkflow(workflow);
            console.log('✅ Workflow execution started, executionId:', result.executionId);

            // Poll for status updates with timeout
            await executionManager.pollExecutionStatus(result.executionId, (statusUpdate) => {
                console.log('📊 Status update received:', statusUpdate);
                setExecutionStatus(statusUpdate.status);

                // Update node statuses
                setNodes((nds) =>
                    nds.map((node) => ({
                        ...node,
                        data: {
                            ...node.data,
                            status: statusUpdate.nodeStatuses[node.id] || 'idle'
                        }
                    }))
                );

                // Update node results if available
                if (statusUpdate.nodeResults) {
                    setNodeResults(statusUpdate.nodeResults);
                    setShowResults(true);
                }

                // Handle error cases
                if (statusUpdate.error) {
                    console.error('❌ Workflow error:', statusUpdate.error);
                    setIsExecuting(false);
                    alert('❌ Workflow error: ' + statusUpdate.error);
                }

                if (statusUpdate.status !== 'running') {
                    console.log('🏁 Workflow completed with status:', statusUpdate.status);
                    setIsExecuting(false);
                    setShowResults(true);
                }
            }, 1000, 60); // 1 second interval, 60 attempts (1 minute timeout)
        } catch (error) {
            console.error('❌ Execution failed:', error);
            setExecutionStatus('error');
            setIsExecuting(false);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            alert('❌ Execution failed: ' + errorMessage);
            // Show error in UI
            setNodes((nds) =>
                nds.map((node) => ({
                    ...node,
                    data: {
                        ...node.data,
                        status: 'error'
                    }
                }))
            );
        }
    };

    const handleClear = () => {
        if (confirm('Clear the entire workflow?')) {
            setNodes([]);
            setEdges([]);
            setSelectedNode(null);
            setExecutionStatus('idle');
        }
    };

    const handleSave = () => {
        const workflow = convertToWorkflow(nodes, edges);
        const dataStr = JSON.stringify({ nodes, edges, workflow }, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'workflow.json';
        link.click();
    };

    return (
        <div className="app-container">
            <div className="app-header">
                <h1>
                    <div className="logo">n8</div>
                    Visual Workflow Builder
                </h1>
                <div className="execution-status">
                    <div className={`status-indicator ${executionStatus}`}></div>
                    <span>{executionStatus}</span>
                </div>
                <div className="header-actions">
                    <button className="btn btn-secondary" onClick={handleClear}>
                        🗑️ Clear
                    </button>
                    <button className="btn btn-secondary" onClick={handleSave}>
                        💾 Save
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleExecute}
                        disabled={isExecuting || nodes.length === 0}
                    >
                        ▶️ Execute
                    </button>
                </div>
            </div>

            <NodePalette onDragStart={onDragStart} />

            <div className="canvas-container" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onInit={setReactFlowInstance}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    nodeTypes={nodeTypes}
                    fitView
                >
                    <Controls />
                    <MiniMap />
                    <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
                </ReactFlow>

                {nodes.length === 0 && (
                    <div className="empty-canvas">
                        <div className="empty-canvas-icon">🎨</div>
                        <div className="empty-canvas-text">Start Building Your Workflow</div>
                        <div className="empty-canvas-hint">
                            Drag nodes from the left panel to get started
                        </div>
                    </div>
                )}

                <NodeConfigPanel
                    node={selectedNode}
                    onClose={() => setSelectedNode(null)}
                    onUpdate={updateNodeData}
                />

                {showResults && (
                    <ExecutionResultsPanel
                        nodeResults={nodeResults}
                        selectedNodeId={selectedNode?.id || null}
                        onClose={() => setShowResults(false)}
                    />
                )}
            </div>
        </div>
    );
}

export default App;
