import type { Queue, Worker } from 'bullmq';

export interface MetricsData {
    // Counters
    workflows_enqueued_total: number;
    workflows_completed_total: number;
    workflows_failed_total: number;
    workflows_cancelled_total: number;
    nodes_executed_total: number;
    nodes_failed_total: number;
    dlq_items_total: number;

    // Gauges
    workflows_active: number;
    workflows_paused: number;
    queue_waiting: number;
    queue_active: number;
    queue_delayed: number;
    queue_failed: number;
    workers_active: number;

    // Histograms (stored as arrays for percentile calculation)
    workflow_duration_ms: number[];
    node_duration_ms: number[];
    queue_wait_time_ms: number[];
}

export class MetricsCollector {
    private metrics: MetricsData = {
        workflows_enqueued_total: 0,
        workflows_completed_total: 0,
        workflows_failed_total: 0,
        workflows_cancelled_total: 0,
        nodes_executed_total: 0,
        nodes_failed_total: 0,
        dlq_items_total: 0,
        workflows_active: 0,
        workflows_paused: 0,
        queue_waiting: 0,
        queue_active: 0,
        queue_delayed: 0,
        queue_failed: 0,
        workers_active: 0,
        workflow_duration_ms: [],
        node_duration_ms: [],
        queue_wait_time_ms: [],
    };

    private queues: Queue[] = [];
    private workers: Worker[] = [];
    private maxHistogramSize = 1000; // Keep last 1000 samples

    // Counter increments
    incrementWorkflowsEnqueued(): void {
        this.metrics.workflows_enqueued_total++;
    }

    incrementWorkflowsCompleted(): void {
        this.metrics.workflows_completed_total++;
    }

    incrementWorkflowsFailed(): void {
        this.metrics.workflows_failed_total++;
    }

    incrementWorkflowsCancelled(): void {
        this.metrics.workflows_cancelled_total++;
    }

    incrementNodesExecuted(): void {
        this.metrics.nodes_executed_total++;
    }

    incrementNodesFailed(): void {
        this.metrics.nodes_failed_total++;
    }

    incrementDLQItems(): void {
        this.metrics.dlq_items_total++;
    }

    // Gauge setters
    setWorkflowsActive(count: number): void {
        this.metrics.workflows_active = count;
    }

    setWorkflowsPaused(count: number): void {
        this.metrics.workflows_paused = count;
    }

    // Histogram observations
    observeWorkflowDuration(durationMs: number): void {
        this.metrics.workflow_duration_ms.push(durationMs);
        if (this.metrics.workflow_duration_ms.length > this.maxHistogramSize) {
            this.metrics.workflow_duration_ms.shift();
        }
    }

    observeNodeDuration(durationMs: number): void {
        this.metrics.node_duration_ms.push(durationMs);
        if (this.metrics.node_duration_ms.length > this.maxHistogramSize) {
            this.metrics.node_duration_ms.shift();
        }
    }

    observeQueueWaitTime(waitTimeMs: number): void {
        this.metrics.queue_wait_time_ms.push(waitTimeMs);
        if (this.metrics.queue_wait_time_ms.length > this.maxHistogramSize) {
            this.metrics.queue_wait_time_ms.shift();
        }
    }

    // Register queues and workers for automatic metric collection
    registerQueue(queue: Queue): void {
        this.queues.push(queue);
    }

    registerWorker(worker: Worker): void {
        this.workers.push(worker);
    }

    // Update queue metrics from BullMQ
    async updateQueueMetrics(): Promise<void> {
        let totalWaiting = 0;
        let totalActive = 0;
        let totalDelayed = 0;
        let totalFailed = 0;

        for (const queue of this.queues) {
            try {
                const counts = await queue.getJobCounts();
                totalWaiting += counts.waiting || 0;
                totalActive += counts.active || 0;
                totalDelayed += counts.delayed || 0;
                totalFailed += counts.failed || 0;
            } catch (error) {
                console.error(`Failed to get job counts for queue ${queue.name}:`, error);
                // Continue with other queues
            }
        }

        this.metrics.queue_waiting = totalWaiting;
        this.metrics.queue_active = totalActive;
        this.metrics.queue_delayed = totalDelayed;
        this.metrics.queue_failed = totalFailed;

        // Update workers_active gauge
        let activeWorkers = 0;
        for (const worker of this.workers) {
            try {
                if (worker.isRunning()) {
                    activeWorkers++;
                }
            } catch (error) {
                console.error(`Failed to check worker status for ${worker.name}:`, error);
                // Continue with other workers
            }
        }
        this.metrics.workers_active = activeWorkers;
    }

    // Get current metrics snapshot (deep copy to prevent mutation)
    getMetrics(): MetricsData {
        return {
            ...this.metrics,
            // Deep copy histogram arrays to prevent mutation
            workflow_duration_ms: [...this.metrics.workflow_duration_ms],
            node_duration_ms: [...this.metrics.node_duration_ms],
            queue_wait_time_ms: [...this.metrics.queue_wait_time_ms],
        };
    }

    // Calculate percentiles for histograms
    private calculatePercentile(values: number[], percentile: number): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)]!;
    }

    // Get metrics in Prometheus format
    toPrometheus(): string {
        const lines: string[] = [];

        // Counters
        lines.push('# HELP workflows_enqueued_total Total number of workflows enqueued');
        lines.push('# TYPE workflows_enqueued_total counter');
        lines.push(`workflows_enqueued_total ${this.metrics.workflows_enqueued_total}`);

        lines.push('# HELP workflows_completed_total Total number of workflows completed');
        lines.push('# TYPE workflows_completed_total counter');
        lines.push(`workflows_completed_total ${this.metrics.workflows_completed_total}`);

        lines.push('# HELP workflows_failed_total Total number of workflows failed');
        lines.push('# TYPE workflows_failed_total counter');
        lines.push(`workflows_failed_total ${this.metrics.workflows_failed_total}`);

        lines.push('# HELP workflows_cancelled_total Total number of workflows cancelled');
        lines.push('# TYPE workflows_cancelled_total counter');
        lines.push(`workflows_cancelled_total ${this.metrics.workflows_cancelled_total}`);

        lines.push('# HELP nodes_executed_total Total number of nodes executed');
        lines.push('# TYPE nodes_executed_total counter');
        lines.push(`nodes_executed_total ${this.metrics.nodes_executed_total}`);

        lines.push('# HELP nodes_failed_total Total number of nodes failed');
        lines.push('# TYPE nodes_failed_total counter');
        lines.push(`nodes_failed_total ${this.metrics.nodes_failed_total}`);

        lines.push('# HELP dlq_items_total Total number of items in DLQ');
        lines.push('# TYPE dlq_items_total counter');
        lines.push(`dlq_items_total ${this.metrics.dlq_items_total}`);

        // Gauges
        lines.push('# HELP workflows_active Current number of active workflows');
        lines.push('# TYPE workflows_active gauge');
        lines.push(`workflows_active ${this.metrics.workflows_active}`);

        lines.push('# HELP workflows_paused Current number of paused workflows');
        lines.push('# TYPE workflows_paused gauge');
        lines.push(`workflows_paused ${this.metrics.workflows_paused}`);

        lines.push('# HELP queue_waiting Current number of waiting jobs');
        lines.push('# TYPE queue_waiting gauge');
        lines.push(`queue_waiting ${this.metrics.queue_waiting}`);

        lines.push('# HELP queue_active Current number of active jobs');
        lines.push('# TYPE queue_active gauge');
        lines.push(`queue_active ${this.metrics.queue_active}`);

        lines.push('# HELP queue_delayed Current number of delayed jobs');
        lines.push('# TYPE queue_delayed gauge');
        lines.push(`queue_delayed ${this.metrics.queue_delayed}`);

        lines.push('# HELP queue_failed Current number of failed jobs');
        lines.push('# TYPE queue_failed gauge');
        lines.push(`queue_failed ${this.metrics.queue_failed}`);

        lines.push('# HELP workers_active Current number of active workers');
        lines.push('# TYPE workers_active gauge');
        lines.push(`workers_active ${this.metrics.workers_active}`);

        // Histograms - workflow duration
        if (this.metrics.workflow_duration_ms.length > 0) {
            lines.push('# HELP workflow_duration_ms Workflow execution duration in milliseconds');
            lines.push('# TYPE workflow_duration_ms summary');
            lines.push(`workflow_duration_ms{quantile="0.5"} ${this.calculatePercentile(this.metrics.workflow_duration_ms, 50)}`);
            lines.push(`workflow_duration_ms{quantile="0.9"} ${this.calculatePercentile(this.metrics.workflow_duration_ms, 90)}`);
            lines.push(`workflow_duration_ms{quantile="0.95"} ${this.calculatePercentile(this.metrics.workflow_duration_ms, 95)}`);
            lines.push(`workflow_duration_ms{quantile="0.99"} ${this.calculatePercentile(this.metrics.workflow_duration_ms, 99)}`);
            lines.push(`workflow_duration_ms_count ${this.metrics.workflow_duration_ms.length}`);
            lines.push(`workflow_duration_ms_sum ${this.metrics.workflow_duration_ms.reduce((a, b) => a + b, 0)}`);
        }

        // Histograms - node duration
        if (this.metrics.node_duration_ms.length > 0) {
            lines.push('# HELP node_duration_ms Node execution duration in milliseconds');
            lines.push('# TYPE node_duration_ms summary');
            lines.push(`node_duration_ms{quantile="0.5"} ${this.calculatePercentile(this.metrics.node_duration_ms, 50)}`);
            lines.push(`node_duration_ms{quantile="0.9"} ${this.calculatePercentile(this.metrics.node_duration_ms, 90)}`);
            lines.push(`node_duration_ms{quantile="0.95"} ${this.calculatePercentile(this.metrics.node_duration_ms, 95)}`);
            lines.push(`node_duration_ms{quantile="0.99"} ${this.calculatePercentile(this.metrics.node_duration_ms, 99)}`);
            lines.push(`node_duration_ms_count ${this.metrics.node_duration_ms.length}`);
            lines.push(`node_duration_ms_sum ${this.metrics.node_duration_ms.reduce((a, b) => a + b, 0)}`);
        }

        // Histograms - queue wait time
        if (this.metrics.queue_wait_time_ms.length > 0) {
            lines.push('# HELP queue_wait_time_ms Time jobs spend waiting in queue in milliseconds');
            lines.push('# TYPE queue_wait_time_ms summary');
            lines.push(`queue_wait_time_ms{quantile="0.5"} ${this.calculatePercentile(this.metrics.queue_wait_time_ms, 50)}`);
            lines.push(`queue_wait_time_ms{quantile="0.9"} ${this.calculatePercentile(this.metrics.queue_wait_time_ms, 90)}`);
            lines.push(`queue_wait_time_ms{quantile="0.95"} ${this.calculatePercentile(this.metrics.queue_wait_time_ms, 95)}`);
            lines.push(`queue_wait_time_ms{quantile="0.99"} ${this.calculatePercentile(this.metrics.queue_wait_time_ms, 99)}`);
            lines.push(`queue_wait_time_ms_count ${this.metrics.queue_wait_time_ms.length}`);
            lines.push(`queue_wait_time_ms_sum ${this.metrics.queue_wait_time_ms.reduce((a, b) => a + b, 0)}`);
        }

        return lines.join('\n') + '\n';
    }

    // Get metrics in JSON format
    toJSON(): object {
        return {
            counters: {
                workflows_enqueued_total: this.metrics.workflows_enqueued_total,
                workflows_completed_total: this.metrics.workflows_completed_total,
                workflows_failed_total: this.metrics.workflows_failed_total,
                workflows_cancelled_total: this.metrics.workflows_cancelled_total,
                nodes_executed_total: this.metrics.nodes_executed_total,
                nodes_failed_total: this.metrics.nodes_failed_total,
                dlq_items_total: this.metrics.dlq_items_total,
            },
            gauges: {
                workflows_active: this.metrics.workflows_active,
                workflows_paused: this.metrics.workflows_paused,
                queue_waiting: this.metrics.queue_waiting,
                queue_active: this.metrics.queue_active,
                queue_delayed: this.metrics.queue_delayed,
                queue_failed: this.metrics.queue_failed,
                workers_active: this.metrics.workers_active,
            },
            histograms: {
                workflow_duration_ms: {
                    p50: this.calculatePercentile(this.metrics.workflow_duration_ms, 50),
                    p90: this.calculatePercentile(this.metrics.workflow_duration_ms, 90),
                    p95: this.calculatePercentile(this.metrics.workflow_duration_ms, 95),
                    p99: this.calculatePercentile(this.metrics.workflow_duration_ms, 99),
                    count: this.metrics.workflow_duration_ms.length,
                    sum: this.metrics.workflow_duration_ms.reduce((a, b) => a + b, 0),
                },
                node_duration_ms: {
                    p50: this.calculatePercentile(this.metrics.node_duration_ms, 50),
                    p90: this.calculatePercentile(this.metrics.node_duration_ms, 90),
                    p95: this.calculatePercentile(this.metrics.node_duration_ms, 95),
                    p99: this.calculatePercentile(this.metrics.node_duration_ms, 99),
                    count: this.metrics.node_duration_ms.length,
                    sum: this.metrics.node_duration_ms.reduce((a, b) => a + b, 0),
                },
                queue_wait_time_ms: {
                    p50: this.calculatePercentile(this.metrics.queue_wait_time_ms, 50),
                    p90: this.calculatePercentile(this.metrics.queue_wait_time_ms, 90),
                    p95: this.calculatePercentile(this.metrics.queue_wait_time_ms, 95),
                    p99: this.calculatePercentile(this.metrics.queue_wait_time_ms, 99),
                    count: this.metrics.queue_wait_time_ms.length,
                    sum: this.metrics.queue_wait_time_ms.reduce((a, b) => a + b, 0),
                },
            },
        };
    }
}
