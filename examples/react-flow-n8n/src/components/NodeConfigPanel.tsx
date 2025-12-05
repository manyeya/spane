import React from 'react';
import { TriggerNodeData } from '../nodes/TriggerNode';
import { ActionNodeData } from '../nodes/ActionNode';
import { ConditionNodeData } from '../nodes/ConditionNode';

interface NodeConfigPanelProps {
    node: any | null;
    onClose: () => void;
    onUpdate: (nodeId: string, data: Partial<any>) => void;
}

const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({ node, onClose, onUpdate }) => {
    if (!node) return null;

    const handleLabelChange = (label: string) => {
        onUpdate(node.id, { label });
    };

    const handleConfigChange = (config: any) => {
        onUpdate(node.id, { config: { ...node.data.config, ...config } });
    };

    const renderTriggerConfig = (data: TriggerNodeData) => {
        if (data.type === 'schedule') {
            return (
                <div className="config-field">
                    <label>Cron Expression</label>
                    <input
                        type="text"
                        value={data.config?.cron || ''}
                        onChange={(e) => handleConfigChange({ cron: e.target.value })}
                        placeholder="*/5 * * * *"
                    />
                    <div className="config-field-hint">
                        Example: */5 * * * * (every 5 minutes)
                    </div>
                </div>
            );
        }
        if (data.type === 'webhook') {
            return (
                <div className="config-field">
                    <label>Webhook URL Path</label>
                    <input
                        type="text"
                        value={data.config?.url || ''}
                        onChange={(e) => handleConfigChange({ url: e.target.value })}
                        placeholder="/webhook/my-workflow"
                    />
                    <div className="config-field-hint">
                        The path where this webhook will be accessible
                    </div>
                </div>
            );
        }
        return null;
    };

    const renderActionConfig = (data: ActionNodeData) => {
        if (data.type === 'http') {
            return (
                <>
                    <div className="config-field">
                        <label>Method</label>
                        <select
                            value={data.config?.method || 'GET'}
                            onChange={(e) => handleConfigChange({ method: e.target.value })}
                        >
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                            <option value="PATCH">PATCH</option>
                        </select>
                    </div>
                    <div className="config-field">
                        <label>URL</label>
                        <input
                            type="text"
                            value={data.config?.url || ''}
                            onChange={(e) => handleConfigChange({ url: e.target.value })}
                            placeholder="https://api.example.com/endpoint"
                        />
                    </div>
                </>
            );
        }
        if (data.type === 'transform') {
            return (
                <div className="config-field">
                    <label>Transform Code</label>
                    <textarea
                        value={data.config?.code || ''}
                        onChange={(e) => handleConfigChange({ code: e.target.value })}
                        placeholder="return { ...input, transformed: true };"
                        rows={8}
                    />
                    <div className="config-field-hint">
                        JavaScript code to transform the input data
                    </div>
                </div>
            );
        }
        if (data.type === 'email') {
            return (
                <>
                    <div className="config-field">
                        <label>To</label>
                        <input
                            type="email"
                            value={data.config?.to || ''}
                            onChange={(e) => handleConfigChange({ to: e.target.value })}
                            placeholder="user@example.com"
                        />
                    </div>
                </>
            );
        }
        if (data.type === 'database') {
            return (
                <div className="config-field">
                    <label>SQL Query</label>
                    <textarea
                        value={data.config?.query || ''}
                        onChange={(e) => handleConfigChange({ query: e.target.value })}
                        placeholder="SELECT * FROM users WHERE id = ?"
                        rows={6}
                    />
                </div>
            );
        }
        return null;
    };

    const renderConditionConfig = (data: ConditionNodeData) => {
        return (
            <>
                <div className="config-field">
                    <label>Condition Expression</label>
                    <textarea
                        value={data.config?.condition || ''}
                        onChange={(e) => handleConfigChange({ condition: e.target.value })}
                        placeholder="input.value > 100"
                        rows={4}
                    />
                    <div className="config-field-hint">
                        JavaScript expression that evaluates to true or false.
                        <br />
                        Use <code>input</code> or <code>data</code> to access the incoming data.
                    </div>
                </div>
                <div className="config-field">
                    <label>Examples</label>
                    <div className="config-examples">
                        <button 
                            type="button" 
                            className="example-btn"
                            onClick={() => handleConfigChange({ condition: 'input.status === "success"' })}
                        >
                            Status check
                        </button>
                        <button 
                            type="button" 
                            className="example-btn"
                            onClick={() => handleConfigChange({ condition: 'input.value > 100' })}
                        >
                            Number comparison
                        </button>
                        <button 
                            type="button" 
                            className="example-btn"
                            onClick={() => handleConfigChange({ condition: 'input.items && input.items.length > 0' })}
                        >
                            Array not empty
                        </button>
                        <button 
                            type="button" 
                            className="example-btn"
                            onClick={() => handleConfigChange({ condition: 'input.data?.ok === true' })}
                        >
                            HTTP success
                        </button>
                    </div>
                </div>
                <div className="config-field">
                    <label>Branch Info</label>
                    <div className="branch-info">
                        <div className="branch-item true">
                            <span className="branch-indicator">✓</span>
                            <span>TRUE branch: Connect from the green handle</span>
                        </div>
                        <div className="branch-item false">
                            <span className="branch-indicator">✗</span>
                            <span>FALSE branch: Connect from the red handle</span>
                        </div>
                    </div>
                </div>
            </>
        );
    };

    return (
        <div className="node-config-panel">
            <div className="config-panel-header">
                <h3>Configure Node</h3>
                <button className="config-panel-close" onClick={onClose}>
                    ×
                </button>
            </div>
            <div className="config-panel-body">
                <div className="config-field">
                    <label>Node Name</label>
                    <input
                        type="text"
                        value={node.data.label}
                        onChange={(e) => handleLabelChange(e.target.value)}
                        placeholder="Enter node name"
                    />
                </div>

                {node.type === 'trigger' && renderTriggerConfig(node.data as TriggerNodeData)}
                {node.type === 'action' && renderActionConfig(node.data as ActionNodeData)}
                {node.type === 'condition' && renderConditionConfig(node.data as ConditionNodeData)}
            </div>
        </div>
    );
};

export default NodeConfigPanel;
