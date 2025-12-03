/**
 * MonitoringDashboard - Shows queue statistics and system health
 * 
 * Requirements: 7.1, 7.3, 7.4
 * - Display waiting, active, completed, failed counts
 * - Add refresh button
 * - Display health indicator
 */

import type { QueueStats, HealthStatus } from '../../services/monitoringService';

export interface MonitoringDashboardProps {
    queueStats: QueueStats;
    healthStatus: HealthStatus;
    onRefresh: () => void;
    isLoading?: boolean;
}

/**
 * Formats a number for display with thousands separators
 */
function formatNumber(num: number): string {
    return num.toLocaleString();
}

/**
 * Gets the appropriate icon for health status
 */
function getHealthIcon(status: HealthStatus['overall']): string {
    switch (status) {
        case 'healthy':
            return '✓';
        case 'degraded':
            return '⚠';
        case 'unhealthy':
            return '✕';
        default:
            return '?';
    }
}

/**
 * Gets the appropriate label for health status
 */
function getHealthLabel(status: HealthStatus['overall']): string {
    switch (status) {
        case 'healthy':
            return 'Healthy';
        case 'degraded':
            return 'Degraded';
        case 'unhealthy':
            return 'Unhealthy';
        default:
            return 'Unknown';
    }
}

export function MonitoringDashboard({
    queueStats,
    healthStatus,
    onRefresh,
    isLoading = false,
}: MonitoringDashboardProps) {
    const totalJobs = queueStats.waiting + queueStats.active + queueStats.completed + queueStats.failed;

    return (
        <div className="monitoring-dashboard">
            <div className="monitoring-dashboard-header">
                <h3>📊 System Monitoring</h3>
                <div className="monitoring-header-actions">
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={onRefresh}
                        disabled={isLoading}
                        title="Refresh statistics"
                    >
                        {isLoading ? '⏳' : '🔄'} Refresh
                    </button>
                </div>
            </div>

            {/* Health Status Section */}
            <div className="monitoring-health-section">
                <div className={`health-status-card health-${healthStatus.overall}`}>
                    <div className="health-status-icon">{getHealthIcon(healthStatus.overall)}</div>
                    <div className="health-status-info">
                        <div className="health-status-label">System Health</div>
                        <div className="health-status-value">{getHealthLabel(healthStatus.overall)}</div>
                    </div>
                </div>
                <div className="health-components">
                    <div className={`health-component ${healthStatus.redis ? 'healthy' : 'unhealthy'}`}>
                        <span className="component-indicator">{healthStatus.redis ? '●' : '○'}</span>
                        <span className="component-name">Redis</span>
                    </div>
                    <div className={`health-component ${healthStatus.database ? 'healthy' : 'unhealthy'}`}>
                        <span className="component-indicator">{healthStatus.database ? '●' : '○'}</span>
                        <span className="component-name">Database</span>
                    </div>
                    <div className={`health-component ${healthStatus.workers ? 'healthy' : 'unhealthy'}`}>
                        <span className="component-indicator">{healthStatus.workers ? '●' : '○'}</span>
                        <span className="component-name">Workers</span>
                    </div>
                </div>
            </div>

            {/* Queue Statistics Section */}
            <div className="monitoring-stats-section">
                <h4>Queue Statistics</h4>
                <div className="stats-grid">
                    <div className="stat-card stat-waiting">
                        <div className="stat-icon">⏳</div>
                        <div className="stat-info">
                            <div className="stat-value">{formatNumber(queueStats.waiting)}</div>
                            <div className="stat-label">Waiting</div>
                        </div>
                    </div>
                    <div className="stat-card stat-active">
                        <div className="stat-icon">▶️</div>
                        <div className="stat-info">
                            <div className="stat-value">{formatNumber(queueStats.active)}</div>
                            <div className="stat-label">Active</div>
                        </div>
                    </div>
                    <div className="stat-card stat-completed">
                        <div className="stat-icon">✓</div>
                        <div className="stat-info">
                            <div className="stat-value">{formatNumber(queueStats.completed)}</div>
                            <div className="stat-label">Completed</div>
                        </div>
                    </div>
                    <div className="stat-card stat-failed">
                        <div className="stat-icon">✕</div>
                        <div className="stat-info">
                            <div className="stat-value">{formatNumber(queueStats.failed)}</div>
                            <div className="stat-label">Failed</div>
                        </div>
                    </div>
                </div>

                {/* Additional Stats */}
                <div className="stats-secondary">
                    <div className="secondary-stat">
                        <span className="secondary-label">Delayed:</span>
                        <span className="secondary-value">{formatNumber(queueStats.delayed)}</span>
                    </div>
                    <div className="secondary-stat">
                        <span className="secondary-label">Paused:</span>
                        <span className="secondary-value">{formatNumber(queueStats.paused)}</span>
                    </div>
                    <div className="secondary-stat">
                        <span className="secondary-label">Total:</span>
                        <span className="secondary-value">{formatNumber(totalJobs)}</span>
                    </div>
                </div>
            </div>

            {/* Last Updated */}
            <div className="monitoring-footer">
                <span className="last-updated">
                    Last updated: {healthStatus.timestamp.toLocaleTimeString()}
                </span>
            </div>
        </div>
    );
}
