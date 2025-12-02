import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

export interface ConditionNodeData {
    label: string;
    config?: {
        condition?: string;
    };
    status?: 'idle' | 'running' | 'success' | 'error';
}

const ConditionNode = ({ data, selected }: NodeProps) => {
    const nodeData = data as unknown as ConditionNodeData;
    return (
        <div className={`custom-node ${selected ? 'selected' : ''} ${nodeData.status || ''}`}>
            <Handle type="target" position={Position.Left} id="input" />
            <div className="node-header node-drag-handle">
                <div className="node-icon condition">🔀</div>
                <div className="node-title-container">
                    <div className="node-type">Condition</div>
                    <div className="node-title">{nodeData.label}</div>
                </div>
            </div>
            <div className="node-body">
                <div className="node-description">Branch based on condition</div>
                <div className="node-config-summary">
                    {nodeData.config?.condition || 'No condition set'}
                </div>
                <div className="condition-branch true">
                    <span className="condition-label">TRUE</span>
                    <span>→</span>
                </div>
                <div className="condition-branch false">
                    <span className="condition-label">FALSE</span>
                    <span>→</span>
                </div>
            </div>
            {nodeData.status && (
                <div className="node-status">
                    <div className={`node-status-icon ${nodeData.status}`}></div>
                    <div className="node-status-text">{nodeData.status}</div>
                </div>
            )}
            <Handle type="source" position={Position.Right} id="true" style={{ top: '60%' }} />
            <Handle type="source" position={Position.Right} id="false" style={{ top: '80%' }} />
        </div>
    );
};

export default memo(ConditionNode);
