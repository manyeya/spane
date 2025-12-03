/**
 * MonitoringService - Provides system monitoring data
 * 
 * Requirements: 6.1, 6.2, 7.1, 7.3
 * 
 * Aligned with react-flow-backend.ts API endpoints
 */

// Use relative URL to leverage Vite's proxy configuration
// This avoids CORS issues in development
const API_BASE_URL = '';

export interface QueueStats {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
}

export interface HealthStatus {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    redis: boolean;
    database: boolean;
    workers: boolean;
    timestamp: Date;
}

export interface DLQItem {
    id: string;
    jobId: string;
    executionId: string;
    nodeId: string;
    workflowId?: string;
    error: string;
    failedAt: Date;
    attemptCount: number;
    data?: unknown;
}

interface DLQAPIResponse {
    success: boolean;
    items?: Array<Record<string, unknown>>;
    count?: number;
    error?: string;
}

interface HealthAPIResponse {
    success?: boolean;
    overall?: string;
    status?: string;
    redis?: boolean;
    database?: boolean;
    workers?: boolean;
    timestamp?: string | Date;
    error?: string;
}

interface StatsAPIResponse {
    success: boolean;
    stats?: {
        waiting?: number;
        active?: number;
        completed?: number;
        failed?: number;
        delayed?: number;
        paused?: number;
    };
    error?: string;
}


/**
 * MonitoringService class for system monitoring
 * Uses the react-flow-backend.ts API endpoints
 */
export class MonitoringService {
    private baseUrl: string;

    constructor(baseUrl: string = API_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Gets current queue statistics
     * Endpoint: GET /api/stats (from main api.ts)
     * Requirements: 7.1
     */
    async getQueueStats(): Promise<QueueStats> {
        try {
            const response = await fetch(`${this.baseUrl}/api/stats`);
            const data: StatsAPIResponse = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to get queue stats');
            }

            const stats = data.stats || {};
            return {
                waiting: stats.waiting || 0,
                active: stats.active || 0,
                completed: stats.completed || 0,
                failed: stats.failed || 0,
                delayed: stats.delayed || 0,
                paused: stats.paused || 0,
            };
        } catch (error) {
            // Return default stats if endpoint fails
            console.warn('Failed to get queue stats:', error);
            return {
                waiting: 0,
                active: 0,
                completed: 0,
                failed: 0,
                delayed: 0,
                paused: 0,
            };
        }
    }

    /**
     * Gets system health status
     * Endpoint: GET /api/system/health
     * Requirements: 7.3
     */
    async getHealthStatus(): Promise<HealthStatus> {
        try {
            const response = await fetch(`${this.baseUrl}/api/system/health`);
            const data: HealthAPIResponse = await response.json();

            // Handle different response formats
            const overall = this.normalizeHealthStatus(data.overall || data.status || 'healthy');
            
            return {
                overall,
                redis: data.redis ?? true,
                database: data.database ?? true,
                workers: data.workers ?? true,
                timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            };
        } catch (error) {
            // Return unhealthy status if health check fails
            console.warn('Health check failed:', error);
            return {
                overall: 'unhealthy',
                redis: false,
                database: false,
                workers: false,
                timestamp: new Date(),
            };
        }
    }

    /**
     * Gets items from the Dead Letter Queue
     * Endpoint: GET /api/dlq
     * Requirements: 6.1
     */
    async getDLQItems(start: number = 0, end: number = 50): Promise<DLQItem[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/dlq?start=${start}&end=${end}`);
            const data: DLQAPIResponse = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to get DLQ items');
            }

            return (data.items || []).map(item => this.toDLQItem(item));
        } catch (error) {
            console.warn('Failed to get DLQ items:', error);
            return [];
        }
    }

    /**
     * Retries a DLQ item
     * Endpoint: POST /api/dlq/:dlqJobId/retry
     * Requirements: 6.2
     */
    async retryDLQItem(dlqJobId: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/dlq/${dlqJobId}/retry`, {
                method: 'POST',
            });

            const data = await response.json();

            if (!data.success) {
                if (data.error?.includes('not found')) {
                    return false;
                }
                throw new Error(data.error || 'Failed to retry DLQ item');
            }

            return true;
        } catch (error) {
            console.error('Failed to retry DLQ item:', error);
            return false;
        }
    }

    /**
     * Normalizes health status string
     */
    private normalizeHealthStatus(status: string): HealthStatus['overall'] {
        const statusMap: Record<string, HealthStatus['overall']> = {
            'healthy': 'healthy',
            'ok': 'healthy',
            'degraded': 'degraded',
            'unhealthy': 'unhealthy',
            'error': 'unhealthy',
        };
        return statusMap[status.toLowerCase()] || 'healthy';
    }

    /**
     * Converts API response to DLQItem
     */
    private toDLQItem(item: Record<string, unknown>): DLQItem {
        return {
            id: (item.id as string) || (item.jobId as string) || '',
            jobId: (item.jobId as string) || '',
            executionId: (item.executionId as string) || '',
            nodeId: (item.nodeId as string) || '',
            workflowId: item.workflowId as string | undefined,
            error: (item.error as string) || 'Unknown error',
            failedAt: item.failedAt ? new Date(item.failedAt as string) : new Date(),
            attemptCount: (item.retryCount as number) || (item.attemptCount as number) || 0,
            data: item.data,
        };
    }
}

// Export a default instance
export const monitoringService = new MonitoringService();
