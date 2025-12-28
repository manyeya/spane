import { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
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
import DelayNode from './nodes/DelayNode';
import NodePalette, { NodeTemplate } from './components/NodePalette';
import NodeConfigPanel from './components/NodeConfigPanel';
import ExecutionResultsPanel from './components/ExecutionResultsPanel';
import { WorkflowListPanel } from './components/panels/WorkflowListPanel';
import { ExecutionHistoryPanel } from './components/panels/ExecutionHistoryPanel';
import { ExecutionControlPanel } from './components/panels/ExecutionControlPanel';
import { DLQPanel } from './components/panels/DLQPanel';
import { MonitoringDashboard } from './components/panels/MonitoringDashboard';
import { VersionHistoryPanel } from './components/panels/VersionHistoryPanel';
import { convertToWorkflow, validateWorkflow } from './engine/workflowConverter';
import ExecutionManager, { ExecutionStatus } from './engine/executionManager';
import { workflowService, type WorkflowSummary } from './services/workflowService';
import { executionService, type ExecutionSummary, type ExecutionDetail } from './services/executionService';
import { monitoringService, type QueueStats, type HealthStatus, type DLQItem } from './services/monitoringService';
import type { WorkflowVersion } from './services/workflowService';

import './styles/app.css';
import './styles/nodes.css';
import './styles/panels.css';

const nodeTypes: NodeTypes = {
    trigger: TriggerNode,
    action: ActionNode,
    condition: ConditionNode,
    delay: DelayNode
};

const executionManager = new ExecutionManager();

function App() {
    const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
    const [selectedNode, setSelectedNode] = useState<any | null>(null);
    const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
    const [isExecuting, setIsExecuting] = useState(false);
    const [nodeResults, setNodeResults] = useState<Record<string, any>>({});
    const [showResults, setShowResults] = useState(false);

    // Workflow management state
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
    const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Execution history state
    const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
    const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
    const [executionDetail, setExecutionDetail] = useState<ExecutionDetail | null>(null);
    const [executionWorkflowFilter, setExecutionWorkflowFilter] = useState<string | null>(null);
    const [isLoadingExecutions, setIsLoadingExecutions] = useState(false);
    const [showExecutionHistory, setShowExecutionHistory] = useState(false);

    // Monitoring state - Requirements: 7.1, 7.3, 7.4
    const [showMonitoringDashboard, setShowMonitoringDashboard] = useState(false);
    const [queueStats, setQueueStats] = useState<QueueStats>({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
    });
    const [healthStatus, setHealthStatus] = useState<HealthStatus>({
        overall: 'healthy',
        redis: true,
        database: true,
        workers: true,
        timestamp: new Date(),
    });
    const [isLoadingMonitoring, setIsLoadingMonitoring] = useState(false);

    // DLQ state - Requirements: 6.1, 6.2, 6.3, 6.4
    const [showDLQPanel, setShowDLQPanel] = useState(false);
    const [dlqItems, setDlqItems] = useState<DLQItem[]>([]);
    const [isLoadingDLQ, setIsLoadingDLQ] = useState(false);

    // Version history state - Requirements: 8.1, 8.2, 8.3
    const [showVersionHistory, setShowVersionHistory] = useState(false);
    const [versions, setVersions] = useState<WorkflowVersion[]>([]);
    const [isLoadingVersions, setIsLoadingVersions] = useState(false);

    // Execution control state - Requirements: 5.1, 5.2, 5.3, 5.4
    const [showExecutionControl, setShowExecutionControl] = useState(false);
    const [isControlLoading, setIsControlLoading] = useState(false);

    // Active panel tracking for exclusive panel display
    type ActivePanel = 'none' | 'history' | 'monitoring' | 'dlq' | 'versions' | 'control';
    const [activePanel, setActivePanel] = useState<ActivePanel>('none');

    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
    const nodeIdCounter = useRef(0);

    // Load workflows, executions, and monitoring data on mount
    useEffect(() => {
        loadWorkflows();
        loadExecutions();
        loadMonitoringData();
    }, []);

    // Refresh monitoring data periodically (every 5 seconds) - Requirements: 7.2
    useEffect(() => {
        const interval = setInterval(() => {
            loadMonitoringData();
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    // Auto-hide notification after 3 seconds
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    // Cleanup SSE subscriptions on unmount
    useEffect(() => {
        return () => {
            executionManager.unsubscribeAll();
        };
    }, []);

    /**
     * Loads all workflows from the backend
     * Requirements: 1.1
     */
    const loadWorkflows = async () => {
        setIsLoadingWorkflows(true);
        try {
            const workflowList = await workflowService.listWorkflows();
            setWorkflows(workflowList);
        } catch (error) {
            console.error('Failed to load workflows:', error);
            setNotification({ type: 'error', message: 'Failed to load workflows' });
        } finally {
            setIsLoadingWorkflows(false);
        }
    };

    /**
     * Loads all executions from the backend
     * Requirements: 4.1
     */
    const loadExecutions = async (workflowId?: string) => {
        setIsLoadingExecutions(true);
        try {
            const executionList = await executionService.listExecutions(workflowId);
            setExecutions(executionList);
        } catch (error) {
            console.error('Failed to load executions:', error);
            // Don't show error notification for executions as the endpoint may not exist yet
        } finally {
            setIsLoadingExecutions(false);
        }
    };

    /**
     * Loads monitoring data (queue stats and health status)
     * Requirements: 7.1, 7.3
     */
    const loadMonitoringData = async () => {
        setIsLoadingMonitoring(true);
        try {
            const [stats, health] = await Promise.all([
                monitoringService.getQueueStats(),
                monitoringService.getHealthStatus(),
            ]);
            setQueueStats(stats);
            setHealthStatus(health);
        } catch (error) {
            console.error('Failed to load monitoring data:', error);
            // Don't show error notification as monitoring may not be available
        } finally {
            setIsLoadingMonitoring(false);
        }
    };

    /**
     * Loads DLQ items from the backend
     * Requirements: 6.1
     */
    const loadDLQItems = async () => {
        setIsLoadingDLQ(true);
        try {
            const items = await monitoringService.getDLQItems();
            setDlqItems(items);
        } catch (error) {
            console.error('Failed to load DLQ items:', error);
        } finally {
            setIsLoadingDLQ(false);
        }
    };

    /**
     * Retries a DLQ item
     * Requirements: 6.2, 6.3
     */
    const handleRetryDLQItem = async (dlqJobId: string): Promise<boolean> => {
        try {
            const success = await monitoringService.retryDLQItem(dlqJobId);
            if (success) {
                setNotification({ type: 'success', message: 'Job retry initiated' });
                // Refresh DLQ items to remove the retried item
                await loadDLQItems();
            }
            return success;
        } catch (error) {
            console.error('Failed to retry DLQ item:', error);
            setNotification({ type: 'error', message: 'Failed to retry job' });
            return false;
        }
    };

    /**
     * Loads version history for the selected workflow
     * Requirements: 8.1
     */
    const loadVersionHistory = async (workflowId: string) => {
        setIsLoadingVersions(true);
        try {
            const versionList = await workflowService.getVersionHistory(workflowId);
            setVersions(versionList);
        } catch (error) {
            console.error('Failed to load version history:', error);
            setVersions([]);
        } finally {
            setIsLoadingVersions(false);
        }
    };

    /**
     * Handles version selection for preview
     * Requirements: 8.2
     */
    const handleSelectVersion = async (version: number) => {
        if (!selectedWorkflowId) return;
        try {
            const workflow = await workflowService.getWorkflow(selectedWorkflowId, version);
            // Load the version into canvas for preview
            const loadedNodes = workflow.nodes.map((node: any) => {
                // Map node types to React Flow component types
                let reactFlowType = node.type;
                const dataType = node.data?.type || node.type;

                if (['trigger', 'schedule', 'manual', 'webhook'].includes(dataType)) {
                    reactFlowType = 'trigger';
                } else if (dataType === 'condition') {
                    reactFlowType = 'condition';
                } else if (dataType === 'delay') {
                    reactFlowType = 'delay';
                } else if (['action', 'http', 'transform', 'email', 'database'].includes(dataType)) {
                    reactFlowType = 'action';
                }

                if (['trigger', 'action', 'condition', 'delay'].includes(node.type)) {
                    reactFlowType = node.type;
                }

                return {
                    id: node.id,
                    type: reactFlowType || 'action',
                    position: node.position || { x: 0, y: 0 },
                    data: {
                        label: node.data?.label || node.id,
                        type: node.data?.type || dataType,
                        config: node.data?.config || {},
                        status: 'idle' as ExecutionStatus,
                    },
                };
            });
            const loadedEdges = workflow.edges.map((edge: any) => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
            }));
            setNodes(loadedNodes);
            setEdges(loadedEdges);
            setNotification({ type: 'success', message: `Loaded version ${version}` });
        } catch (error) {
            console.error('Failed to load version:', error);
            setNotification({ type: 'error', message: 'Failed to load version' });
        }
    };

    /**
     * Restores a previous version (creates new version from it)
     * Requirements: 8.3
     */
    const handleRestoreVersion = async (version: number) => {
        if (!selectedWorkflowId) return;
        try {
            await workflowService.restoreVersion(selectedWorkflowId, version);
            setNotification({ type: 'success', message: `Restored version ${version}` });
            // Reload version history and workflow
            await loadVersionHistory(selectedWorkflowId);
            await handleSelectWorkflow(selectedWorkflowId);
        } catch (error) {
            console.error('Failed to restore version:', error);
            setNotification({ type: 'error', message: 'Failed to restore version' });
        }
    };

    /**
     * Handles click on health indicator to show detailed health view
     * Requirements: 7.4
     */
    const handleHealthIndicatorClick = () => {
        togglePanel('monitoring');
    };

    /**
     * Toggles a panel, closing others when opening a new one
     */
    const togglePanel = (panel: ActivePanel) => {
        if (activePanel === panel) {
            setActivePanel('none');
            setShowExecutionHistory(false);
            setShowMonitoringDashboard(false);
            setShowDLQPanel(false);
            setShowVersionHistory(false);
            setShowExecutionControl(false);
        } else {
            setActivePanel(panel);
            setShowExecutionHistory(panel === 'history');
            setShowMonitoringDashboard(panel === 'monitoring');
            setShowDLQPanel(panel === 'dlq');
            setShowVersionHistory(panel === 'versions');
            setShowExecutionControl(panel === 'control');

            // Load data for the panel being opened
            if (panel === 'dlq') {
                loadDLQItems();
            } else if (panel === 'versions' && selectedWorkflowId) {
                loadVersionHistory(selectedWorkflowId);
            }
        }
    };

    /**
     * Pauses a running execution
     * Requirements: 5.1
     */
    const handlePauseExecution = async (executionId: string) => {
        setIsControlLoading(true);
        try {
            await executionService.pauseExecution(executionId);
            setNotification({ type: 'success', message: 'Execution paused' });
            // Refresh execution detail
            const detail = await executionService.getExecution(executionId);
            setExecutionDetail(detail);
            await loadExecutions(executionWorkflowFilter || undefined);
        } catch (error) {
            console.error('Failed to pause execution:', error);
            setNotification({ type: 'error', message: 'Failed to pause execution' });
        } finally {
            setIsControlLoading(false);
        }
    };

    /**
     * Resumes a paused execution
     * Requirements: 5.2
     */
    const handleResumeExecution = async (executionId: string) => {
        setIsControlLoading(true);
        try {
            await executionService.resumeExecution(executionId);
            setNotification({ type: 'success', message: 'Execution resumed' });
            // Refresh execution detail
            const detail = await executionService.getExecution(executionId);
            setExecutionDetail(detail);
            await loadExecutions(executionWorkflowFilter || undefined);
        } catch (error) {
            console.error('Failed to resume execution:', error);
            setNotification({ type: 'error', message: 'Failed to resume execution' });
        } finally {
            setIsControlLoading(false);
        }
    };

    /**
     * Cancels a running or paused execution
     * Requirements: 5.3
     */
    const handleCancelExecution = async (executionId: string) => {
        setIsControlLoading(true);
        try {
            await executionService.cancelExecution(executionId);
            setNotification({ type: 'success', message: 'Execution cancelled' });
            // Refresh execution detail
            const detail = await executionService.getExecution(executionId);
            setExecutionDetail(detail);
            await loadExecutions(executionWorkflowFilter || undefined);
        } catch (error) {
            console.error('Failed to cancel execution:', error);
            setNotification({ type: 'error', message: 'Failed to cancel execution' });
        } finally {
            setIsControlLoading(false);
        }
    };

    /**
     * Handles execution selection and loads execution details
     * Requirements: 4.2
     */
    const handleSelectExecution = async (executionId: string) => {
        setSelectedExecutionId(executionId);
        try {
            const detail = await executionService.getExecution(executionId);
            setExecutionDetail(detail);

            // If execution is running or paused, show control panel hint
            if (detail.status === 'running' || detail.status === 'paused') {
                setNotification({ type: 'success', message: 'Use Control panel to manage this execution' });
            }
        } catch (error) {
            console.error('Failed to load execution details:', error);
            setNotification({ type: 'error', message: 'Failed to load execution details' });
        }
    };

    /**
     * Handles execution workflow filter change
     * Requirements: 4.5
     */
    const handleExecutionFilterChange = (workflowId: string | null) => {
        setExecutionWorkflowFilter(workflowId);
        loadExecutions(workflowId || undefined);
    };

    /**
     * Replays a completed execution with the same initial data
     * Requirements: 9.1, 9.2
     */
    const handleReplayExecution = async (executionId: string) => {
        try {
            setNotification({ type: 'success', message: 'Starting replay...' });
            const newExecutionId = await executionService.replayExecution(executionId);

            // Navigate to the new execution view
            setSelectedExecutionId(newExecutionId);
            setShowExecutionHistory(true);

            // Load the new execution details
            const detail = await executionService.getExecution(newExecutionId);
            setExecutionDetail(detail);

            // Refresh execution list to include the new execution
            await loadExecutions(executionWorkflowFilter || undefined);

            setNotification({ type: 'success', message: `Replay started (ID: ${newExecutionId})` });
        } catch (error) {
            console.error('Failed to replay execution:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            setNotification({ type: 'error', message: `Replay failed: ${errorMessage}` });
        }
    };

    /**
     * Loads a workflow into the canvas
     * Requirements: 3.1, 3.2 - Load workflow nodes at saved positions, edges, and configurations
     */
    const handleSelectWorkflow = async (workflowId: string) => {
        try {
            setSelectedWorkflowId(workflowId);
            const workflow = await workflowService.getWorkflow(workflowId);

            // Convert workflow nodes to React Flow format with proper data structure
            const loadedNodes = workflow.nodes.map((node: any) => {
                // Determine the React Flow node type (trigger, action, or condition)
                // The node.type from backend might be the specific type (http, transform, etc.)
                // We need to map it to the React Flow component type
                let reactFlowType = node.type;
                const dataType = node.data?.type || node.type;

                // Map specific types to React Flow component types
                if (['trigger', 'schedule', 'manual', 'webhook'].includes(dataType)) {
                    reactFlowType = 'trigger';
                } else if (dataType === 'condition') {
                    reactFlowType = 'condition';
                } else if (dataType === 'delay') {
                    reactFlowType = 'delay';
                } else if (['action', 'http', 'transform', 'email', 'database'].includes(dataType)) {
                    reactFlowType = 'action';
                }

                // If the node already has a valid React Flow type, use it
                if (['trigger', 'action', 'condition', 'delay'].includes(node.type)) {
                    reactFlowType = node.type;
                }

                return {
                    id: node.id,
                    type: reactFlowType || 'action',
                    position: node.position || { x: 0, y: 0 },
                    data: {
                        label: node.data?.label || node.id,
                        type: node.data?.type || dataType,
                        config: node.data?.config || {},
                        status: 'idle' as ExecutionStatus,
                    },
                };
            });

            // Convert workflow edges to React Flow format
            const loadedEdges = workflow.edges.map((edge: any) => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
            }));

            // Update canvas with loaded workflow
            setNodes(loadedNodes);
            setEdges(loadedEdges);
            setSelectedNode(null);
            setExecutionStatus('idle');
            setNodeResults({});
            setShowResults(false);

            // Update node ID counter to avoid conflicts
            const maxNodeId = loadedNodes.reduce((max: number, node: any) => {
                const match = node.id.match(/node-(\d+)/);
                return match ? Math.max(max, parseInt(match[1], 10)) : max;
            }, 0);
            nodeIdCounter.current = maxNodeId + 1;

            // Fit view if React Flow instance is available
            if (reactFlowInstance && workflow.viewport) {
                reactFlowInstance.setViewport(workflow.viewport);
            } else if (reactFlowInstance) {
                setTimeout(() => reactFlowInstance.fitView(), 100);
            }

            // Load version history if version panel is open
            if (showVersionHistory) {
                loadVersionHistory(workflowId);
            }

            setNotification({ type: 'success', message: `Loaded workflow: ${workflow.name}` });
        } catch (error) {
            console.error('Failed to load workflow:', error);
            setNotification({ type: 'error', message: 'Failed to load workflow' });
        }
    };

    /**
     * Creates a new workflow
     * Requirements: 2.1, 2.2
     */
    const handleCreateWorkflow = async (name: string) => {
        try {
            // Clear canvas for new workflow
            setNodes([]);
            setEdges([]);
            setSelectedNode(null);
            setSelectedWorkflowId(null);
            nodeIdCounter.current = 0;

            // Create workflow in backend (will be saved when user adds nodes and saves)
            setNotification({ type: 'success', message: `Created new workflow: ${name}` });

            // Refresh workflow list
            await loadWorkflows();
        } catch (error) {
            console.error('Failed to create workflow:', error);
            setNotification({ type: 'error', message: 'Failed to create workflow' });
        }
    };

    /**
     * Deletes a workflow
     * Requirements: 1.4
     */
    const handleDeleteWorkflow = async (workflowId: string) => {
        try {
            await workflowService.deleteWorkflow(workflowId);

            // Clear canvas if deleted workflow was selected
            if (selectedWorkflowId === workflowId) {
                setNodes([]);
                setEdges([]);
                setSelectedWorkflowId(null);
                setSelectedNode(null);
            }

            // Refresh workflow list
            await loadWorkflows();
            setNotification({ type: 'success', message: 'Workflow deleted' });
        } catch (error) {
            console.error('Failed to delete workflow:', error);
            setNotification({ type: 'error', message: 'Failed to delete workflow' });
        }
    };

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
            } else if (template.nodeType === 'delay' || template.subType === 'delay') {
                // Delay node - pauses workflow execution for a configurable duration
                // Requirements: 1.1, 3.1, 3.2, 3.3
                newNode = {
                    id: newNodeId,
                    type: 'delay',
                    position,
                    data: {
                        label: template.label,
                        type: 'delay',
                        config: {
                            durationSeconds: 5 // Default to 5 seconds
                        },
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

        // Convert to workflow definition, passing the selected workflow ID
        // This prevents creating duplicate workflows on each execution
        const workflow = convertToWorkflow(nodes, edges, selectedWorkflowId);
        console.log('Executing workflow:', workflow, 'selectedWorkflowId:', selectedWorkflowId);

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

            // Subscribe to real-time updates via SSE
            const unsubscribe = executionManager.subscribeToExecution(result.executionId, {
                onUpdate: (statusUpdate) => {
                    console.log('📊 SSE status update received:', statusUpdate);
                    setExecutionStatus(statusUpdate.status);

                    // Update node statuses and include result data for condition nodes
                    setNodes((nds) =>
                        nds.map((node) => {
                            const nodeResult = statusUpdate.nodeResults?.[node.id];
                            return {
                                ...node,
                                data: {
                                    ...node.data,
                                    status: statusUpdate.nodeStatuses[node.id] || 'idle',
                                    // Include result data for condition nodes to show which branch was taken
                                    result: node.type === 'condition' && nodeResult?.data
                                        ? nodeResult.data
                                        : node.data.result
                                }
                            };
                        })
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
                        unsubscribe();
                    }

                    if (statusUpdate.status !== 'running') {
                        console.log('🏁 Workflow completed with status:', statusUpdate.status);
                        setIsExecuting(false);
                        setShowResults(true);
                        // Refresh execution history to show the new execution
                        loadExecutions(executionWorkflowFilter || undefined);
                    }
                },
                onNodeProgress: (event) => {
                    console.log(`📍 Node ${event.nodeId} status: ${event.status}`);
                },
                onWorkflowStatus: (event) => {
                    console.log(`📋 Workflow status: ${event.status}`);
                },
                onError: (event) => {
                    console.error('❌ SSE error:', event.message);
                    setIsExecuting(false);
                    unsubscribe();
                }
            });
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
            setSelectedWorkflowId(null);
            setExecutionStatus('idle');
        }
    };

    /**
     * Saves the current workflow to the backend
     * Requirements: 2.4, 2.5, 3.3
     */
    const handleSave = async () => {
        if (nodes.length === 0) {
            setNotification({ type: 'error', message: 'Cannot save an empty workflow' });
            return;
        }

        try {
            if (selectedWorkflowId) {
                // Update existing workflow (Requirements: 3.3)
                await workflowService.updateWorkflow(selectedWorkflowId, nodes, edges);
                setNotification({ type: 'success', message: `Workflow saved (ID: ${selectedWorkflowId})` });
            } else {
                // Prompt for workflow name for new workflow
                const name = prompt('Enter workflow name:');
                if (!name || name.trim() === '') {
                    setNotification({ type: 'error', message: 'Workflow name cannot be empty' });
                    return;
                }

                // Create new workflow (Requirements: 2.4, 2.5)
                const workflowId = await workflowService.createWorkflow(name.trim(), nodes, edges);
                setSelectedWorkflowId(workflowId);
                setNotification({ type: 'success', message: `Workflow saved (ID: ${workflowId})` });
            }

            // Refresh workflow list
            await loadWorkflows();
        } catch (error) {
            console.error('Failed to save workflow:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            setNotification({ type: 'error', message: `Failed to save: ${errorMessage}` });
        }
    };

    /**
     * Downloads the workflow as a JSON file (local export)
     */
    const handleExport = () => {
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
                {/* Health Status Indicator - Requirements: 7.3, 7.4 */}
                <div
                    className={`health-indicator ${healthStatus.overall}`}
                    onClick={handleHealthIndicatorClick}
                    title={`System Health: ${healthStatus.overall}. Click for details.`}
                >
                    <span className="health-indicator-dot"></span>
                    <span>{healthStatus.overall === 'healthy' ? 'Healthy' : healthStatus.overall === 'degraded' ? 'Degraded' : 'Unhealthy'}</span>
                </div>
                <div className="header-actions">
                    <button
                        className={`btn btn-secondary ${activePanel === 'history' ? 'active' : ''}`}
                        onClick={() => togglePanel('history')}
                        title="Execution History"
                    >
                        📊 History
                    </button>
                    <button
                        className={`btn btn-secondary ${activePanel === 'control' ? 'active' : ''}`}
                        onClick={() => togglePanel('control')}
                        title="Execution Controls"
                        disabled={!executionDetail}
                    >
                        🎮 Control
                    </button>
                    <button
                        className={`btn btn-secondary ${activePanel === 'dlq' ? 'active' : ''}`}
                        onClick={() => togglePanel('dlq')}
                        title="Dead Letter Queue"
                    >
                        ⚠️ DLQ
                    </button>
                    <button
                        className={`btn btn-secondary ${activePanel === 'versions' ? 'active' : ''}`}
                        onClick={() => togglePanel('versions')}
                        title="Version History"
                        disabled={!selectedWorkflowId}
                    >
                        📜 Versions
                    </button>
                    <button className="btn btn-secondary" onClick={handleClear}>
                        🗑️ Clear
                    </button>
                    <button className="btn btn-secondary" onClick={handleExport} title="Export to file">
                        📤 Export
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

            {/* Notification Toast */}
            {notification && (
                <div className={`notification-toast ${notification.type}`}>
                    {notification.type === 'success' ? '✓' : '✕'} {notification.message}
                </div>
            )}

            {/* Sidebar with Workflow List and Node Palette */}
            <div className="sidebar">
                <WorkflowListPanel
                    workflows={workflows}
                    selectedWorkflowId={selectedWorkflowId}
                    onSelect={handleSelectWorkflow}
                    onCreate={handleCreateWorkflow}
                    onDelete={handleDeleteWorkflow}
                    isLoading={isLoadingWorkflows}
                />
                <NodePalette onDragStart={onDragStart} />
            </div>

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
                {selectedNode && (
                    <NodeConfigPanel
                        node={selectedNode}
                        nodeResults={nodeResults} // Pass execution history for autocomplete
                        onClose={onPaneClick}
                        onUpdate={updateNodeData}
                    />
                )}     {showResults && (
                    <ExecutionResultsPanel
                        nodeResults={nodeResults}
                        selectedNodeId={selectedNode?.id || null}
                        onClose={() => setShowResults(false)}
                    />
                )}

                {/* Execution History Panel - Requirements: 4.1, 9.1, 9.2 */}
                {showExecutionHistory && (
                    <div className="execution-history-container">
                        <ExecutionHistoryPanel
                            executions={executions}
                            selectedExecutionId={selectedExecutionId}
                            workflowFilter={executionWorkflowFilter}
                            onSelect={handleSelectExecution}
                            onFilterChange={handleExecutionFilterChange}
                            onReplay={handleReplayExecution}
                            workflows={workflows}
                            executionDetail={executionDetail}
                            isLoading={isLoadingExecutions}
                        />
                    </div>
                )}

                {/* Execution Control Panel - Requirements: 5.1, 5.2, 5.3, 5.4 */}
                {showExecutionControl && (
                    <div className="execution-control-container">
                        <ExecutionControlPanel
                            execution={executionDetail}
                            onPause={handlePauseExecution}
                            onResume={handleResumeExecution}
                            onCancel={handleCancelExecution}
                            isLoading={isControlLoading}
                        />
                    </div>
                )}

                {/* DLQ Panel - Requirements: 6.1, 6.2, 6.3, 6.4 */}
                {showDLQPanel && (
                    <div className="dlq-panel-container">
                        <DLQPanel
                            items={dlqItems}
                            onRetry={handleRetryDLQItem}
                            isLoading={isLoadingDLQ}
                            onRefresh={loadDLQItems}
                        />
                    </div>
                )}

                {/* Version History Panel - Requirements: 8.1, 8.2, 8.3 */}
                {showVersionHistory && selectedWorkflowId && (
                    <div className="version-history-container">
                        <VersionHistoryPanel
                            workflowId={selectedWorkflowId}
                            versions={versions}
                            onSelectVersion={handleSelectVersion}
                            onRestore={handleRestoreVersion}
                            isLoading={isLoadingVersions}
                        />
                    </div>
                )}

                {/* Monitoring Dashboard - Requirements: 7.1, 7.3, 7.4 */}
                {showMonitoringDashboard && (
                    <div className="monitoring-dashboard-container">
                        <MonitoringDashboard
                            queueStats={queueStats}
                            healthStatus={healthStatus}
                            onRefresh={loadMonitoringData}
                            isLoading={isLoadingMonitoring}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
