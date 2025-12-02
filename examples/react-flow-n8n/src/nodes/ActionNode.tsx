import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

export interface ActionNodeData {
    label: string;
    type: 'http' | 'transform' | 'email' | 'database';
    config?: {
        url?: string;
        method?: string;
        code?: string;
        to?: string;
        query?: string;
    };
    status?: 'idle' | 'running' | 'success' | 'error';
}

const ActionNode = ({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as ActionNodeData;
    const getIcon = () => {
        switch (nodeData.type) {
            case 'http':
                return '🌐';
            case 'transform':
                return '⚙️';
            case 'email':
                return '📧';
            case 'database':
                return '🗄️';
            default:
                return '📦';
        }
    };

    const getConfigSummary = () => {
        if (nodeData.type === 'http' && nodeData.config?.url) {
            return `${nodeData.config.method || 'GET'} ${nodeData.config.url}`;
        }
        if (nodeData.type === 'transform' && nodeData.config?.code) {
            return `${nodeData.config.code.substring(0, 30)}...`;
        }
        if (nodeData.type === 'email' && nodeData.config?.to) {
            return `To: ${nodeData.config.to}`;
        }
        if (nodeData.type === 'database' && nodeData.config?.query) {
            return `${nodeData.config.query.substring(0, 30)}...`;
        }
        return 'Not configured';
    };

    return (
        <div className={`custom-node ${selected ? 'selected' : ''} ${nodeData.status || ''}`}>
            <Handle type="target" position={Position.Left} id="input" />
            <div className="node-header node-drag-handle">
                <div className="node-icon action">{getIcon()}</div>
                <div className="node-title-container">
                    <div className="node-type">Action</div>
                    <div className="node-title">{nodeData.label}</div>
                </div>
            </div>
            <div className="node-body">
                <div className="node-description">
                    {nodeData.type === 'http' && 'Make HTTP request'}
                    {nodeData.type === 'transform' && 'Transform data with code'}
                    {nodeData.type === 'email' && 'Send email notification'}
                    {nodeData.type === 'database' && 'Query database'}
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

export default memo(ActionNode);
