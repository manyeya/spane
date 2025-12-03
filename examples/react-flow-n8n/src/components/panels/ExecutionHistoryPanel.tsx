/**
 * ExecutionHistoryPanel - Shows execution history with filtering and status indicators
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { useState, useMemo } from 'react';
import type { ExecutionSummary, ExecutionDetail, NodeResult } from '../../services/executionService';
import type { WorkflowSummary } from '../../services/workflowService';

export interface ExecutionHistoryPanelProps {
    executions: ExecutionSummary[];
    selectedExecutionId: string | null;
    workflowFilter: string | null;
    onSelect: (executionId: string) => void;
    onFilterChange: (workflowId: string | null) => void;
    onReplay: (executionId: string) => void;
    workflows?: WorkflowSummary[];
    executionDetail?: ExecutionDetail | null;
    isLoading?: boolean;
}

function formatDate(date: Date): string {
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDuration(startedAt: Date, completedAt?: Date): string {
    const end = completedAt || new Date();
    const durationMs = end.getTime() - startedAt.getTime();
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;
    if (durationMs < 3600000) return `${Math.round(durationMs / 60000)}m`;
    return `${Math.round(durationMs / 3600000)}h`;
}

function getStatusDisplay(status: ExecutionSummary['status']): { icon: string; className: string; label: string } {
    switch (status) {
        case 'running': return { icon: '⏳', className: 'status-running', label: 'Running' };
        case 'completed': return { icon: '✓', className: 'status-completed', label: 'Completed' };
        case 'failed': return { icon: '✕', className: 'status-failed', label: 'Failed' };
        case 'cancelled': return { icon: '⊘', className: 'status-cancelled', label: 'Cancelled' };
        case 'paused': return { icon: '⏸', className: 'status-paused', label: 'Paused' };
        default: return { icon: '?', className: 'status-unknown', label: 'Unknown' };
    }
}

function formatNodeResult(result: NodeResult): string {
    if (result.error) return result.error;
    if (result.output !== undefined) {
        try { return JSON.stringify(result.output, null, 2); } catch { return String(result.output); }
    }
    if (result.data !== undefined) {
        try { return JSON.stringify(result.data, null, 2); } catch { return String(result.data); }
    }
    return 'No output';
}


function ExecutionDetailView({ detail, onClose }: { detail: ExecutionDetail; onClose: () => void }) {
    const statusDisplay = getStatusDisplay(detail.status);
    return (
        <div className="execution-detail-overlay" onClick={onClose}>
            <div className="execution-detail-panel" onClick={(e) => e.stopPropagation()}>
                <div className="execution-detail-header">
                    <h4>Execution Details</h4>
                    <button className="dialog-close" onClick={onClose}>×</button>
                </div>
                <div className="execution-detail-body">
                    <div className="execution-detail-summary">
                        <div className="detail-row">
                            <span className="detail-label">Execution ID:</span>
                            <span className="detail-value">{detail.executionId}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Workflow:</span>
                            <span className="detail-value">{detail.workflowName}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Status:</span>
                            <span className={`detail-value ${statusDisplay.className}`}>{statusDisplay.label}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Started:</span>
                            <span className="detail-value">{formatDate(detail.startedAt)}</span>
                        </div>
                        {detail.completedAt && (
                            <div className="detail-row">
                                <span className="detail-label">Completed:</span>
                                <span className="detail-value">{formatDate(detail.completedAt)}</span>
                            </div>
                        )}
                        <div className="detail-row">
                            <span className="detail-label">Duration:</span>
                            <span className="detail-value">{formatDuration(detail.startedAt, detail.completedAt)}</span>
                        </div>
                    </div>
                    {detail.initialData !== undefined && (
                        <div className="execution-detail-section">
                            <h5>Initial Data</h5>
                            <pre className="detail-json">{JSON.stringify(detail.initialData, null, 2)}</pre>
                        </div>
                    )}
                    {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                        <div className="execution-detail-section">
                            <h5>Metadata</h5>
                            <pre className="detail-json">{JSON.stringify(detail.metadata, null, 2)}</pre>
                        </div>
                    )}
                    <div className="execution-detail-section">
                        <h5>Node Results</h5>
                        {Object.keys(detail.nodeResults).length === 0 ? (
                            <div className="no-results">No node results available</div>
                        ) : (
                            <div className="node-results-list">
                                {Object.entries(detail.nodeResults).map(([nodeId, result]) => (
                                    <div key={nodeId} className="node-result-item">
                                        <div className="node-result-header">
                                            <span className="node-result-id">{nodeId}</span>
                                            <span className={`node-result-status ${result.status}`}>{result.status}</span>
                                        </div>
                                        {result.error && <div className="node-result-error">{result.error}</div>}
                                        <pre className="node-result-output">{formatNodeResult(result)}</pre>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}


export function ExecutionHistoryPanel({
    executions, selectedExecutionId, workflowFilter, onSelect, onFilterChange, onReplay,
    workflows = [], executionDetail, isLoading = false,
}: ExecutionHistoryPanelProps) {
    const [showDetailView, setShowDetailView] = useState(false);

    const filteredExecutions = useMemo(() => {
        if (!workflowFilter) return executions;
        return executions.filter(e => e.workflowId === workflowFilter);
    }, [executions, workflowFilter]);

    const workflowOptions = useMemo(() => {
        const uniqueWorkflows = new Map<string, string>();
        executions.forEach(e => {
            if (e.workflowId && !uniqueWorkflows.has(e.workflowId)) {
                uniqueWorkflows.set(e.workflowId, e.workflowName || e.workflowId);
            }
        });
        workflows.forEach(w => { if (!uniqueWorkflows.has(w.id)) uniqueWorkflows.set(w.id, w.name); });
        return Array.from(uniqueWorkflows.entries()).map(([id, name]) => ({ id, name }));
    }, [executions, workflows]);

    const handleSelectExecution = (executionId: string) => { onSelect(executionId); setShowDetailView(true); };
    const handleCloseDetail = () => { setShowDetailView(false); };
    const handleReplay = (executionId: string, e: React.MouseEvent) => { e.stopPropagation(); onReplay(executionId); };

    return (
        <div className="execution-history-panel">
            <div className="execution-history-header">
                <h3>Execution History</h3>
                <div className="execution-filter">
                    <select value={workflowFilter || ''} onChange={(e) => onFilterChange(e.target.value || null)} className="filter-select">
                        <option value="">All Workflows</option>
                        {workflowOptions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                    </select>
                </div>
            </div>
            <div className="execution-history-content">
                {isLoading ? (
                    <div className="execution-history-loading">
                        <div className="loading-spinner"></div>
                        <span>Loading executions...</span>
                    </div>
                ) : filteredExecutions.length === 0 ? (
                    <div className="execution-history-empty">
                        <div className="empty-icon">📊</div>
                        <div className="empty-title">No executions yet</div>
                        <div className="empty-hint">{workflowFilter ? 'No executions found for this workflow' : 'Execute a workflow to see history here'}</div>
                    </div>
                ) : (
                    <ul className="execution-list">
                        {filteredExecutions.map((execution) => {
                            const statusDisplay = getStatusDisplay(execution.status);
                            const isSelected = selectedExecutionId === execution.executionId;
                            return (
                                <li key={execution.executionId} className={`execution-item ${isSelected ? 'selected' : ''}`} onClick={() => handleSelectExecution(execution.executionId)}>
                                    <div className="execution-item-main">
                                        <div className={`execution-status-badge ${statusDisplay.className}`}>
                                            <span className="status-icon">{statusDisplay.icon}</span>
                                        </div>
                                        <div className="execution-item-content">
                                            <div className="execution-item-name">{execution.workflowName}</div>
                                            <div className="execution-item-meta">
                                                <span className="execution-time">{formatDate(execution.startedAt)}</span>
                                                <span className="execution-duration">{formatDuration(execution.startedAt, execution.completedAt)}</span>
                                                <span className="execution-progress">{execution.completedNodes}/{execution.nodeCount} nodes</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="execution-item-actions">
                                        {(execution.status === 'completed' || execution.status === 'failed') && (
                                            <button className="execution-replay-btn" onClick={(e) => handleReplay(execution.executionId, e)} title="Replay execution">🔄</button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            {showDetailView && selectedExecutionId && executionDetail != null && (
                <ExecutionDetailView detail={executionDetail} onClose={handleCloseDetail} />
            )}
        </div>
    );
}
