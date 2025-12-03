/**
 * ExecutionControlPanel - Provides pause, resume, and cancel controls for executions
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import type { ExecutionDetail } from '../../services/executionService';

export interface ExecutionControlPanelProps {
    execution: ExecutionDetail | null;
    onPause: (executionId: string) => void;
    onResume: (executionId: string) => void;
    onCancel: (executionId: string) => void;
    isLoading?: boolean;
}

/**
 * Determines which control buttons should be enabled based on execution status
 * Requirements: 5.4
 */
export function getControlButtonStates(status: ExecutionDetail['status'] | null): {
    pauseEnabled: boolean;
    resumeEnabled: boolean;
    cancelEnabled: boolean;
    pauseTooltip: string;
    resumeTooltip: string;
    cancelTooltip: string;
} {
    if (!status) {
        return {
            pauseEnabled: false,
            resumeEnabled: false,
            cancelEnabled: false,
            pauseTooltip: 'No execution selected',
            resumeTooltip: 'No execution selected',
            cancelTooltip: 'No execution selected',
        };
    }

    switch (status) {
        case 'running':
            return {
                pauseEnabled: true,
                resumeEnabled: false,
                cancelEnabled: true,
                pauseTooltip: 'Pause execution',
                resumeTooltip: 'Execution is not paused',
                cancelTooltip: 'Cancel execution',
            };
        case 'paused':
            return {
                pauseEnabled: false,
                resumeEnabled: true,
                cancelEnabled: true,
                pauseTooltip: 'Execution is already paused',
                resumeTooltip: 'Resume execution',
                cancelTooltip: 'Cancel execution',
            };
        case 'completed':
            return {
                pauseEnabled: false,
                resumeEnabled: false,
                cancelEnabled: false,
                pauseTooltip: 'Execution has completed',
                resumeTooltip: 'Execution has completed',
                cancelTooltip: 'Execution has completed',
            };
        case 'failed':
            return {
                pauseEnabled: false,
                resumeEnabled: false,
                cancelEnabled: false,
                pauseTooltip: 'Execution has failed',
                resumeTooltip: 'Execution has failed',
                cancelTooltip: 'Execution has failed',
            };
        case 'cancelled':
            return {
                pauseEnabled: false,
                resumeEnabled: false,
                cancelEnabled: false,
                pauseTooltip: 'Execution was cancelled',
                resumeTooltip: 'Execution was cancelled',
                cancelTooltip: 'Execution was cancelled',
            };
        default:
            return {
                pauseEnabled: false,
                resumeEnabled: false,
                cancelEnabled: false,
                pauseTooltip: 'Unknown execution state',
                resumeTooltip: 'Unknown execution state',
                cancelTooltip: 'Unknown execution state',
            };
    }
}

function getStatusDisplay(status: ExecutionDetail['status']): { icon: string; className: string; label: string } {
    switch (status) {
        case 'running': return { icon: '⏳', className: 'status-running', label: 'Running' };
        case 'completed': return { icon: '✓', className: 'status-completed', label: 'Completed' };
        case 'failed': return { icon: '✕', className: 'status-failed', label: 'Failed' };
        case 'cancelled': return { icon: '⊘', className: 'status-cancelled', label: 'Cancelled' };
        case 'paused': return { icon: '⏸', className: 'status-paused', label: 'Paused' };
        default: return { icon: '?', className: 'status-unknown', label: 'Unknown' };
    }
}

export function ExecutionControlPanel({
    execution,
    onPause,
    onResume,
    onCancel,
    isLoading = false,
}: ExecutionControlPanelProps) {
    const buttonStates = getControlButtonStates(execution?.status ?? null);
    const statusDisplay = execution ? getStatusDisplay(execution.status) : null;

    const handlePause = () => {
        if (execution && buttonStates.pauseEnabled) {
            onPause(execution.executionId);
        }
    };

    const handleResume = () => {
        if (execution && buttonStates.resumeEnabled) {
            onResume(execution.executionId);
        }
    };

    const handleCancel = () => {
        if (execution && buttonStates.cancelEnabled) {
            onCancel(execution.executionId);
        }
    };

    if (!execution) {
        return (
            <div className="execution-control-panel">
                <div className="execution-control-header">
                    <h3>Execution Controls</h3>
                </div>
                <div className="execution-control-empty">
                    <div className="empty-icon">🎮</div>
                    <div className="empty-title">No execution selected</div>
                    <div className="empty-hint">Select a running execution to control it</div>
                </div>
            </div>
        );
    }

    return (
        <div className="execution-control-panel">
            <div className="execution-control-header">
                <h3>Execution Controls</h3>
                {statusDisplay && (
                    <div className={`execution-control-status ${statusDisplay.className}`}>
                        <span className="status-icon">{statusDisplay.icon}</span>
                        <span className="status-label">{statusDisplay.label}</span>
                    </div>
                )}
            </div>
            <div className="execution-control-info">
                <div className="control-info-row">
                    <span className="control-info-label">Execution ID:</span>
                    <span className="control-info-value">{execution.executionId.slice(0, 8)}...</span>
                </div>
                <div className="control-info-row">
                    <span className="control-info-label">Workflow:</span>
                    <span className="control-info-value">{execution.workflowName}</span>
                </div>
                <div className="control-info-row">
                    <span className="control-info-label">Progress:</span>
                    <span className="control-info-value">{execution.completedNodes}/{execution.nodeCount} nodes</span>
                </div>
            </div>
            <div className="execution-control-buttons">
                <button
                    className="control-btn control-btn-pause"
                    onClick={handlePause}
                    disabled={!buttonStates.pauseEnabled || isLoading}
                    title={buttonStates.pauseTooltip}
                >
                    <span className="control-btn-icon">⏸</span>
                    <span className="control-btn-label">Pause</span>
                </button>
                <button
                    className="control-btn control-btn-resume"
                    onClick={handleResume}
                    disabled={!buttonStates.resumeEnabled || isLoading}
                    title={buttonStates.resumeTooltip}
                >
                    <span className="control-btn-icon">▶</span>
                    <span className="control-btn-label">Resume</span>
                </button>
                <button
                    className="control-btn control-btn-cancel"
                    onClick={handleCancel}
                    disabled={!buttonStates.cancelEnabled || isLoading}
                    title={buttonStates.cancelTooltip}
                >
                    <span className="control-btn-icon">⏹</span>
                    <span className="control-btn-label">Cancel</span>
                </button>
            </div>
            {isLoading && (
                <div className="execution-control-loading">
                    <div className="loading-spinner"></div>
                    <span>Processing...</span>
                </div>
            )}
        </div>
    );
}
