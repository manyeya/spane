/**
 * VersionHistoryPanel - Displays workflow version history with restore capability
 * 
 * Requirements: 8.1, 8.2, 8.3
 */

import { useState } from 'react';
import type { WorkflowVersion } from '../../services/workflowService';

export interface VersionHistoryPanelProps {
    workflowId: string;
    versions: WorkflowVersion[];
    currentVersion?: number;
    onSelectVersion: (version: number) => void;
    onRestore: (version: number) => void;
    isLoading?: boolean;
}

function formatDate(date: Date): string {
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(date);
}

function ConfirmRestoreDialog({
    version,
    onConfirm,
    onCancel,
}: {
    version: WorkflowVersion;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="dialog-overlay" onClick={onCancel}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <h4>Restore Version</h4>
                    <button className="dialog-close" onClick={onCancel}>×</button>
                </div>
                <div className="dialog-body">
                    <p>
                        Are you sure you want to restore to version {version.version}?
                        This will create a new version based on the selected version's content.
                    </p>
                    {version.changeNotes && (
                        <p style={{ marginTop: '12px', fontStyle: 'italic', color: '#666' }}>
                            "{version.changeNotes}"
                        </p>
                    )}
                </div>
                <div className="dialog-footer">
                    <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
                    <button className="btn btn-primary" onClick={onConfirm}>Restore</button>
                </div>
            </div>
        </div>
    );
}

export function VersionHistoryPanel({
    workflowId,
    versions,
    currentVersion,
    onSelectVersion,
    onRestore,
    isLoading = false,
}: VersionHistoryPanelProps) {
    const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
    const [versionToRestore, setVersionToRestore] = useState<WorkflowVersion | null>(null);

    const handleSelectVersion = (version: number) => {
        setSelectedVersion(version);
        onSelectVersion(version);
    };

    const handleRestoreClick = (version: WorkflowVersion, e: React.MouseEvent) => {
        e.stopPropagation();
        setVersionToRestore(version);
    };

    const handleConfirmRestore = () => {
        if (versionToRestore) {
            onRestore(versionToRestore.version);
            setVersionToRestore(null);
        }
    };

    const handleCancelRestore = () => {
        setVersionToRestore(null);
    };

    // Sort versions by version number descending (newest first)
    const sortedVersions = [...versions].sort((a, b) => b.version - a.version);

    return (
        <div className="version-history-panel">
            <div className="version-history-header">
                <h3>Version History</h3>
                {versions.length > 0 && (
                    <span className="version-count">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
                )}
            </div>

            <div className="version-history-content">
                {isLoading ? (
                    <div className="version-history-loading">
                        <div className="loading-spinner"></div>
                        <span>Loading versions...</span>
                    </div>
                ) : !workflowId ? (
                    <div className="version-history-empty">
                        <div className="empty-icon">📋</div>
                        <div className="empty-title">No workflow selected</div>
                        <div className="empty-hint">Select a workflow to view its version history</div>
                    </div>
                ) : sortedVersions.length === 0 ? (
                    <div className="version-history-empty">
                        <div className="empty-icon">📜</div>
                        <div className="empty-title">No versions yet</div>
                        <div className="empty-hint">Save changes to create version history</div>
                    </div>
                ) : (
                    <ul className="version-list">
                        {sortedVersions.map((version, index) => {
                            const isSelected = selectedVersion === version.version;
                            const isCurrent = currentVersion === version.version;
                            const isLatest = index === 0;

                            return (
                                <li
                                    key={version.versionId}
                                    className={`version-item ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''}`}
                                    onClick={() => handleSelectVersion(version.version)}
                                >
                                    <div className="version-item-main">
                                        <div className="version-badge">
                                            <span className="version-number">v{version.version}</span>
                                            {isLatest && <span className="version-tag latest">Latest</span>}
                                            {isCurrent && !isLatest && <span className="version-tag current">Current</span>}
                                        </div>
                                        <div className="version-item-content">
                                            <div className="version-item-time">
                                                <span className="version-relative-time">{formatRelativeTime(version.createdAt)}</span>
                                                <span className="version-absolute-time">{formatDate(version.createdAt)}</span>
                                            </div>
                                            {version.changeNotes && (
                                                <div className="version-notes">{version.changeNotes}</div>
                                            )}
                                            {version.createdBy && (
                                                <div className="version-author">
                                                    <span className="author-icon">👤</span>
                                                    {version.createdBy}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="version-item-actions">
                                        {!isLatest && (
                                            <button
                                                className="version-restore-btn"
                                                onClick={(e) => handleRestoreClick(version, e)}
                                                title="Restore this version"
                                            >
                                                ↩️
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {versionToRestore && (
                <ConfirmRestoreDialog
                    version={versionToRestore}
                    onConfirm={handleConfirmRestore}
                    onCancel={handleCancelRestore}
                />
            )}
        </div>
    );
}
