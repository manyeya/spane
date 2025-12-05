import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

export interface ConditionNodeData {
    label: string;
    type?: string;
    config?: {
        condition?: string;
        trueBranch?: string[];
        falseBranch?: string[];
    };
    status?: 'idle' | 'running' | 'success' | 'error';
    result?: {
        _conditionResult?: boolean;
    };
}

const ConditionNode = ({ data, selected }: NodeProps) => {
    const nodeData = data as unknown as ConditionNodeData;
    const conditionResult = nodeData.result?._conditionResult;
    const hasResult = conditionResult !== undefined;
    
    // Truncate long condition expressions for display
    const conditionDisplay = nodeData.config?.condition 
        ? (nodeData.config.condition.length > 30 
            ? nodeData.config.condition.substring(0, 30) + '...' 
            : nodeData.config.condition)
        : 'No condition set';

    return (
        <div className={`custom-node condition-node ${selected ? 'selected' : ''} ${nodeData.status || ''}`}>
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
                <div className="node-config-summary" title={nodeData.config?.condition || ''}>
                    <code>{conditionDisplay}</code>
                </div>
                <div className="condition-branches">
                    <div className={`condition-branch true ${hasResult && conditionResult === true ? 'active' : ''} ${hasResult && conditionResult === false ? 'inactive' : ''}`}>
                        <span className="condition-label">✓ TRUE</span>
                        <Handle 
                            type="source" 
                            position={Position.Right} 
                            id="true" 
                            className="condition-handle true-handle"
                        />
                    </div>
                    <div className={`condition-branch false ${hasResult && conditionResult === false ? 'active' : ''} ${hasResult && conditionResult === true ? 'inactive' : ''}`}>
                        <span className="condition-label">✗ FALSE</span>
                        <Handle 
                            type="source" 
                            position={Position.Right} 
                            id="false" 
                            className="condition-handle false-handle"
                        />
                    </div>
                </div>
            </div>
            {nodeData.status && (
                <div className="node-status">
                    <div className={`node-status-icon ${nodeData.status}`}></div>
                    <div className="node-status-text">
                        {nodeData.status}
                        {hasResult && ` (${conditionResult ? 'TRUE' : 'FALSE'})`}
                    </div>
                </div>
            )}
        </div>
    );
};

export default memo(ConditionNode);
