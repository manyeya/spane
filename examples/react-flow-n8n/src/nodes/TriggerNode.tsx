import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

export interface TriggerNodeData {
    label: string;
    type: 'schedule' | 'webhook' | 'manual';
    config?: {
        cron?: string;
        url?: string;
    };
    status?: 'idle' | 'running' | 'success' | 'error';
}

const TriggerNode = ({ data, selected }: NodeProps) => {
    const nodeData = data as unknown as TriggerNodeData;
    const getIcon = () => {
        switch (nodeData.type) {
            case 'schedule':
                return '⏰';
            case 'webhook':
                return '🔗';
            case 'manual':
                return '▶️';
            default:
                return '⚡';
        }
    };

    const getConfigSummary = () => {
        if (nodeData.type === 'schedule' && nodeData.config?.cron) {
            return `Cron: ${nodeData.config.cron}`;
        }
        if (nodeData.type === 'webhook' && nodeData.config?.url) {
            return `URL: ${nodeData.config.url}`;
        }
        return 'Not configured';
    };

    return (
        <div className={`custom-node ${selected ? 'selected' : ''} ${nodeData.status || ''}`}>
            <div className="node-header node-drag-handle">
                <div className="node-icon trigger">{getIcon()}</div>
                <div className="node-title-container">
                    <div className="node-type">Trigger</div>
                    <div className="node-title">{nodeData.label}</div>
                </div>
            </div>
            <div className="node-body">
                <div className="node-description">
                    {nodeData.type === 'schedule' && 'Triggers on a schedule'}
                    {nodeData.type === 'webhook' && 'Triggers via HTTP webhook'}
                    {nodeData.type === 'manual' && 'Triggers manually'}
                </div>
                <div className="node-config-summary">{getConfigSummary()}</div>
            </div>
            {nodeData.status && (
                <div className="node-status">
                    <div className={`node-status-icon ${nodeData.status}`}></div>
                    <div className="node-status-text">{nodeData.status}</div>
                </div>
            )}
            <Handle type="source" position={Position.Right} id="output" />
        </div>
    );
};

export default memo(TriggerNode);
