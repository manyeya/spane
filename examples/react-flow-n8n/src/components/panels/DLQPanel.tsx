/**
 * DLQPanel - Displays and manages Dead Letter Queue items
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import { useState } from 'react';
import type { DLQItem } from '../../services/monitoringService';

export interface DLQPanelProps {
    items: DLQItem[];
    onRetry: (dlqJobId: string) => Promise<boolean>;
    isLoading: boolean;
    onRefresh?: () => void;
}

function formatDate(date: Date): string {
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatTimeSince(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

function truncateError(error: string, maxLength: number = 100): string {
    if (error.length <= maxLength) return error;
    return error.substring(0, maxLength) + '...';
}

interface DLQItemDetailProps {
    item: DLQItem;
    onClose: () => void;
    onRetry: (dlqJobId: string) => Promise<boolean>;
}

function DLQItemDetail({ item, onClose, onRetry }: DLQItemDetailProps) {
    const [isRetrying, setIsRetrying] = useState(false);

    const handleRetry = async () => {
        setIsRetrying(true);
        try {
            const success = await onRetry(item.id);
            if (success) {
                onClose();
            }
        } finally {
            setIsRetrying(false);
        }
    };

    return (
        <div className="dlq-detail-overlay" onClick={onClose}>
            <div className="dlq-detail-panel" onClick={(e) => e.stopPropagation()}>
                <div className="dlq-detail-header">
                    <h4>Failed Job Details</h4>
                    <button className="dialog-close" onClick={onClose}>×</button>
                </div>
                <div className="dlq-detail-body">
                    <div className="dlq-detail-summary">
                        <div className="detail-row">
                            <span className="detail-label">Job ID:</span>
                            <span className="detail-value">{item.jobId || item.id}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Execution ID:</span>
                            <span className="detail-value">{item.executionId}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Node ID:</span>
                            <span className="detail-value">{item.nodeId}</span>
                        </div>
                        {item.workflowId && (
                            <div className="detail-row">
                                <span className="detail-label">Workflow ID:</span>
                                <span className="detail-value">{item.workflowId}</span>
                            </div>
                        )}
                        <div className="detail-row">
                            <span className="detail-label">Failed At:</span>
                            <span className="detail-value">{formatDate(item.failedAt)}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Attempts:</span>
                            <span className="detail-value">{item.attemptCount}</span>
                        </div>
                    </div>
                    <div className="dlq-detail-section">
                        <h5>Error Message</h5>
                        <pre className="dlq-error-detail">{item.error}</pre>
                    </div>
                    {item.data !== undefined && (
                        <div className="dlq-detail-section">
                            <h5>Job Data</h5>
                            <pre className="detail-json">
                                {JSON.stringify(item.data, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
                <div className="dlq-detail-footer">
                    <button 
                        className="btn btn-secondary" 
                        onClick={onClose}
                    >
                        Close
                    </button>
                    <button 
                        className="btn btn-primary" 
                        onClick={handleRetry}
                        disabled={isRetrying}
                    >
                        {isRetrying ? 'Retrying...' : '🔄 Retry Job'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function DLQPanel({ items, onRetry, isLoading, onRefresh }: DLQPanelProps) {
    const [selectedItem, setSelectedItem] = useState<DLQItem | null>(null);
    const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

    const handleRetry = async (dlqJobId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        
        setRetryingIds(prev => new Set(prev).add(dlqJobId));
        try {
            const success = await onRetry(dlqJobId);
            if (success && selectedItem?.id === dlqJobId) {
                setSelectedItem(null);
            }
            return success;
        } finally {
            setRetryingIds(prev => {
                const next = new Set(prev);
                next.delete(dlqJobId);
                return next;
            });
        }
    };

    const handleSelectItem = (item: DLQItem) => {
        setSelectedItem(item);
    };

    const handleCloseDetail = () => {
        setSelectedItem(null);
    };

    return (
        <div className="dlq-panel">
            <div className="dlq-panel-header">
                <h3>Dead Letter Queue</h3>
                <div className="dlq-header-actions">
                    <span className="dlq-count">{items.length} items</span>
                    {onRefresh && (
                        <button 
                            className="btn btn-sm btn-secondary" 
                            onClick={onRefresh}
                            disabled={isLoading}
                        >
                            🔄
                        </button>
                    )}
                </div>
            </div>
            <div className="dlq-panel-content">
                {isLoading ? (
                    <div className="dlq-panel-loading">
                        <div className="loading-spinner"></div>
                        <span>Loading DLQ items...</span>
                    </div>
                ) : items.length === 0 ? (
                    <div className="dlq-panel-empty">
                        <div className="empty-icon">✓</div>
                        <div className="empty-title">No failed jobs</div>
                        <div className="empty-hint">
                            All jobs are processing normally
                        </div>
                    </div>
                ) : (
                    <ul className="dlq-list">
                        {items.map((item) => {
                            const isRetrying = retryingIds.has(item.id);
                            return (
                                <li 
                                    key={item.id} 
                                    className="dlq-item"
                                    onClick={() => handleSelectItem(item)}
                                >
                                    <div className="dlq-item-main">
                                        <div className="dlq-item-icon">⚠️</div>
                                        <div className="dlq-item-content">
                                            <div className="dlq-item-header">
                                                <span className="dlq-item-node">{item.nodeId}</span>
                                                <span className="dlq-item-time">
                                                    {formatTimeSince(item.failedAt)}
                                                </span>
                                            </div>
                                            <div className="dlq-item-error">
                                                {truncateError(item.error)}
                                            </div>
                                            <div className="dlq-item-meta">
                                                <span className="dlq-execution-id">
                                                    Exec: {item.executionId.substring(0, 8)}...
                                                </span>
                                                <span className="dlq-attempts">
                                                    {item.attemptCount} attempts
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="dlq-item-actions">
                                        <button
                                            className="dlq-retry-btn"
                                            onClick={(e) => handleRetry(item.id, e)}
                                            disabled={isRetrying}
                                            title="Retry this job"
                                        >
                                            {isRetrying ? '⏳' : '🔄'}
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            {selectedItem && (
                <DLQItemDetail 
                    item={selectedItem} 
                    onClose={handleCloseDetail}
                    onRetry={handleRetry}
                />
            )}
        </div>
    );
}
