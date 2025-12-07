import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

/**
 * DelayNode - A workflow node that pauses execution for a configurable duration.
 * 
 * The delay node supports three duration configuration options:
 * - duration: Duration in milliseconds (highest priority)
 * - durationSeconds: Duration in seconds (converted to ms)
 * - durationMinutes: Duration in minutes (converted to ms)
 * 
 * When the delay expires, the node passes through input data unchanged
 * to downstream nodes.
 * 
 * Requirements: 1.1, 3.1, 3.2, 3.3
 */
export interface DelayNodeData {
    label: string;
    type: 'delay';
    config?: {
        /** Duration in milliseconds (highest priority) */
        duration?: number;
        /** Duration in seconds (converted to ms) */
        durationSeconds?: number;
        /** Duration in minutes (converted to ms) */
        durationMinutes?: number;
    };
    status?: 'idle' | 'running' | 'success' | 'error' | 'delayed';
}

const DelayNode = ({ data, selected }: NodeProps) => {
    const nodeData = data as unknown as DelayNodeData;

    /**
     * Formats the configured delay duration for display.
     * Shows the duration in the most appropriate unit based on configuration.
     */
    const getConfigSummary = () => {
        const config = nodeData.config;
        if (!config) return 'Not configured';

        // Check duration properties in precedence order (same as backend)
        if (typeof config.duration === 'number' && config.duration > 0) {
            // Display milliseconds in a human-readable format
            if (config.duration >= 60000) {
                return `${(config.duration / 60000).toFixed(1)} minutes`;
            } else if (config.duration >= 1000) {
                return `${(config.duration / 1000).toFixed(1)} seconds`;
            }
            return `${config.duration} ms`;
        }

        if (typeof config.durationSeconds === 'number' && config.durationSeconds > 0) {
            if (config.durationSeconds >= 60) {
                return `${(config.durationSeconds / 60).toFixed(1)} minutes`;
            }
            return `${config.durationSeconds} seconds`;
        }

        if (typeof config.durationMinutes === 'number' && config.durationMinutes > 0) {
            return `${config.durationMinutes} minute${config.durationMinutes !== 1 ? 's' : ''}`;
        }

        return 'Not configured';
    };

    /**
     * Returns the appropriate status indicator based on node state.
     * The 'delayed' status indicates the node is waiting for the timer to expire.
     */
    const getStatusDisplay = () => {
        if (nodeData.status === 'delayed') {
            return 'waiting';
        }
        return nodeData.status || 'idle';
    };

    return (
        <div className={`custom-node ${selected ? 'selected' : ''} ${nodeData.status || ''}`}>
            <Handle type="target" position={Position.Left} id="input" />
            <div className="node-header node-drag-handle">
                <div className="node-icon delay">⏳</div>
                <div className="node-title-container">
                    <div className="node-type">Control</div>
                    <div className="node-title">{nodeData.label}</div>
                </div>
            </div>
            <div className="node-body">
                <div className="node-description">
                    Pause workflow execution
                </div>
                <div className="node-config-summary">{getConfigSummary()}</div>
            </div>
            {nodeData.status && (
                <div className="node-status">
                    <div className={`node-status-icon ${nodeData.status}`}></div>
                    <div className="node-status-text">{getStatusDisplay()}</div>
                </div>
            )}
            <Handle type="source" position={Position.Right} id="output" />
        </div>
    );
};

export default memo(DelayNode);
