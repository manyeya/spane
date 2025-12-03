/**
 * WorkflowListPanel - Displays all saved workflows with options to create, load, and delete
 * 
 * Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3
 */

import { useState } from 'react';
import type { WorkflowSummary } from '../../services/workflowService';

export interface WorkflowListPanelProps {
    workflows: WorkflowSummary[];
    selectedWorkflowId: string | null;
    onSelect: (workflowId: string) => void;
    onCreate: (name: string) => void;
    onDelete: (workflowId: string) => void;
    isLoading: boolean;
}

/**
 * Formats a date for display in the workflow list
 */
function formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
}

/**
 * Validates workflow name - must be non-empty and not just whitespace
 * Requirements: 2.3
 */
export function validateWorkflowName(name: string): boolean {
    return name.trim().length > 0;
}

export function WorkflowListPanel({
    workflows,
    selectedWorkflowId,
    onSelect,
    onCreate,
    onDelete,
    isLoading,
}: WorkflowListPanelProps) {
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newWorkflowName, setNewWorkflowName] = useState('');
    const [nameError, setNameError] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const handleCreateClick = () => {
        setShowCreateDialog(true);
        setNewWorkflowName('');
        setNameError(null);
    };

    const handleCreateConfirm = () => {
        // Validate non-empty name (Requirements: 2.3)
        if (!validateWorkflowName(newWorkflowName)) {
            setNameError('Workflow name cannot be empty');
            return;
        }

        onCreate(newWorkflowName.trim());
        setShowCreateDialog(false);
        setNewWorkflowName('');
        setNameError(null);
    };

    const handleCreateCancel = () => {
        setShowCreateDialog(false);
        setNewWorkflowName('');
        setNameError(null);
    };

    const handleDeleteClick = (workflowId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteConfirmId(workflowId);
    };

    const handleDeleteConfirm = () => {
        if (deleteConfirmId) {
            onDelete(deleteConfirmId);
            setDeleteConfirmId(null);
        }
    };

    const handleDeleteCancel = () => {
        setDeleteConfirmId(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleCreateConfirm();
        } else if (e.key === 'Escape') {
            handleCreateCancel();
        }
    };

    return (
        <div className="workflow-list-panel">
            <div className="workflow-list-header">
                <h3>Workflows</h3>
                <button 
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateClick}
                    disabled={isLoading}
                    title="Create new workflow"
                >
                    + New
                </button>
            </div>

            <div className="workflow-list-content">
                {isLoading ? (
                    <div className="workflow-list-loading">
                        <div className="loading-spinner"></div>
                        <span>Loading workflows...</span>
                    </div>
                ) : workflows.length === 0 ? (
                    // Empty state (Requirements: 1.5)
                    <div className="workflow-list-empty">
                        <div className="empty-icon">📋</div>
                        <div className="empty-title">No workflows yet</div>
                        <div className="empty-hint">
                            Click "New" to create your first workflow
                        </div>
                    </div>
                ) : (
                    // Workflow list (Requirements: 1.1)
                    <ul className="workflow-list">
                        {workflows.map((workflow) => (
                            <li
                                key={workflow.id}
                                className={`workflow-item ${selectedWorkflowId === workflow.id ? 'selected' : ''}`}
                                onClick={() => onSelect(workflow.id)}
                            >
                                <div className="workflow-item-content">
                                    <div className="workflow-item-name">{workflow.name}</div>
                                    <div className="workflow-item-meta">
                                        <span className="workflow-node-count">
                                            {workflow.nodeCount} node{workflow.nodeCount !== 1 ? 's' : ''}
                                        </span>
                                        <span className="workflow-updated">
                                            {formatDate(workflow.updatedAt)}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    className="workflow-delete-btn"
                                    onClick={(e) => handleDeleteClick(workflow.id, e)}
                                    title="Delete workflow"
                                >
                                    🗑️
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Create Workflow Dialog (Requirements: 2.1, 2.2) */}
            {showCreateDialog && (
                <div className="dialog-overlay" onClick={handleCreateCancel}>
                    <div className="dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-header">
                            <h4>Create New Workflow</h4>
                            <button className="dialog-close" onClick={handleCreateCancel}>×</button>
                        </div>
                        <div className="dialog-body">
                            <div className="config-field">
                                <label htmlFor="workflow-name">Workflow Name</label>
                                <input
                                    id="workflow-name"
                                    type="text"
                                    value={newWorkflowName}
                                    onChange={(e) => {
                                        setNewWorkflowName(e.target.value);
                                        setNameError(null);
                                    }}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Enter workflow name"
                                    autoFocus
                                />
                                {nameError && (
                                    <div className="field-error">{nameError}</div>
                                )}
                            </div>
                        </div>
                        <div className="dialog-footer">
                            <button className="btn btn-secondary" onClick={handleCreateCancel}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleCreateConfirm}>
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog (Requirements: 1.4) */}
            {deleteConfirmId && (
                <div className="dialog-overlay" onClick={handleDeleteCancel}>
                    <div className="dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-header">
                            <h4>Delete Workflow</h4>
                            <button className="dialog-close" onClick={handleDeleteCancel}>×</button>
                        </div>
                        <div className="dialog-body">
                            <p>Are you sure you want to delete this workflow? This action cannot be undone.</p>
                        </div>
                        <div className="dialog-footer">
                            <button className="btn btn-secondary" onClick={handleDeleteCancel}>
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={handleDeleteConfirm}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
