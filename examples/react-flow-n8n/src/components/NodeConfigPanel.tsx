import React from 'react';
import { TriggerNodeData } from '../nodes/TriggerNode';
import { ActionNodeData } from '../nodes/ActionNode';
import { ConditionNodeData } from '../nodes/ConditionNode';
import { DelayNodeData } from '../nodes/DelayNode';
import { AutocompleteInput } from './AutocompleteInput';

interface NodeConfigPanelProps {
    node: any | null;
    nodeResults?: Record<string, any>; // Optional execution results
    onClose: () => void;
    onUpdate: (nodeId: string, data: Partial<any>) => void;
}

const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({ node, nodeResults, onClose, onUpdate }) => {
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
                <>
                    <div className="config-field">
                        <label>Webhook URL Path</label>
                        <AutocompleteInput
                            storageKey="webhook-urls"
                            value={data.config?.url || ''}
                            onValueChange={(value) => handleConfigChange({ url: value })}
                            placeholder="/webhook/my-workflow"
                            executionData={nodeResults}
                        />
                        <div className="config-field-hint">
                            The path where this webhook will be accessible
                        </div>
                    </div>
                    {renderCircuitBreakerConfig()}
                </>
            );
        }
        return null;
    };

    const [showCircuitBreaker, setShowCircuitBreaker] = React.useState(false);

    const handleCircuitBreakerChange = (cbConfig: any) => {
        const currentCb = node.data.config?.circuitBreaker || {};
        handleConfigChange({ circuitBreaker: { ...currentCb, ...cbConfig } });
    };

    const renderCircuitBreakerConfig = () => {
        const cb = node.data.config?.circuitBreaker || {};
        return (
            <div className="circuit-breaker-config">
                <div
                    className="config-section-header"
                    onClick={() => setShowCircuitBreaker(!showCircuitBreaker)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <span>{showCircuitBreaker ? '▼' : '▶'}</span>
                    <label style={{ cursor: 'pointer', margin: 0 }}>Circuit Breaker Settings</label>
                </div>
                {showCircuitBreaker && (
                    <div className="circuit-breaker-fields" style={{ marginTop: '12px', paddingLeft: '16px' }}>
                        <div className="config-field">
                            <label>Failure Threshold</label>
                            <input
                                type="number"
                                min="1"
                                value={cb.failureThreshold || ''}
                                onChange={(e) => handleCircuitBreakerChange({
                                    failureThreshold: e.target.value ? parseInt(e.target.value) : undefined
                                })}
                                placeholder="5 (default)"
                            />
                            <div className="config-field-hint">
                                Number of failures before circuit opens
                            </div>
                        </div>
                        <div className="config-field">
                            <label>Success Threshold</label>
                            <input
                                type="number"
                                min="1"
                                value={cb.successThreshold || ''}
                                onChange={(e) => handleCircuitBreakerChange({
                                    successThreshold: e.target.value ? parseInt(e.target.value) : undefined
                                })}
                                placeholder="2 (default)"
                            />
                            <div className="config-field-hint">
                                Successes needed to close circuit
                            </div>
                        </div>
                        <div className="config-field">
                            <label>Timeout (ms)</label>
                            <input
                                type="number"
                                min="1000"
                                step="1000"
                                value={cb.timeout || ''}
                                onChange={(e) => handleCircuitBreakerChange({
                                    timeout: e.target.value ? parseInt(e.target.value) : undefined
                                })}
                                placeholder="60000 (default - 1 min)"
                            />
                            <div className="config-field-hint">
                                Time before circuit tries again
                            </div>
                        </div>
                        <div className="config-field">
                            <label>Monitoring Period (ms)</label>
                            <input
                                type="number"
                                min="1000"
                                step="1000"
                                value={cb.monitoringPeriod || ''}
                                onChange={(e) => handleCircuitBreakerChange({
                                    monitoringPeriod: e.target.value ? parseInt(e.target.value) : undefined
                                })}
                                placeholder="120000 (default - 2 min)"
                            />
                            <div className="config-field-hint">
                                Time window for counting failures
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
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
                        <AutocompleteInput
                            storageKey="http-urls"
                            value={data.config?.url || ''}
                            onValueChange={(value) => handleConfigChange({ url: value })}
                            placeholder="https://api.example.com/endpoint"
                            executionData={nodeResults}
                        />
                    </div>
                    {renderCircuitBreakerConfig()}
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
                    {renderCircuitBreakerConfig()}
                </>
            );
        }
        if (data.type === 'database') {
            return (
                <>
                    <div className="config-field">
                        <label>SQL Query</label>
                        <textarea
                            value={data.config?.query || ''}
                            onChange={(e) => handleConfigChange({ query: e.target.value })}
                            placeholder="SELECT * FROM users WHERE id = ?"
                            rows={6}
                        />
                    </div>
                    {renderCircuitBreakerConfig()}
                </>
            );
        }
        return null;
    };

    const renderConditionConfig = (data: ConditionNodeData) => {
        return (
            <>
                <div className="config-field">
                    <label>Condition Expression</label>
                    <AutocompleteInput
                        storageKey="condition-expressions"
                        value={data.config?.condition || ''}
                        onValueChange={(value) => handleConfigChange({ condition: value })}
                        placeholder="input.price > 50"
                        executionData={nodeResults}
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
                {node.type === 'delay' && renderDelayConfig(node.data as DelayNodeData)}
            </div>
        </div>
    );

    /**
     * Renders configuration UI for delay nodes.
     * 
     * Delay nodes support three duration configuration options with precedence:
     * 1. duration (milliseconds) - highest priority
     * 2. durationSeconds - converted to ms
     * 3. durationMinutes - converted to ms
     * 
     * Requirements: 3.1, 3.2, 3.3, 3.4
     */
    function renderDelayConfig(data: DelayNodeData) {
        const [durationUnit, setDurationUnit] = React.useState<'ms' | 'seconds' | 'minutes'>(() => {
            // Determine initial unit based on existing config
            if (data.config?.durationMinutes !== undefined) return 'minutes';
            if (data.config?.durationSeconds !== undefined) return 'seconds';
            return 'seconds'; // Default to seconds for better UX
        });

        const getCurrentValue = (): string => {
            if (durationUnit === 'minutes' && data.config?.durationMinutes !== undefined) {
                return String(data.config.durationMinutes);
            }
            if (durationUnit === 'seconds' && data.config?.durationSeconds !== undefined) {
                return String(data.config.durationSeconds);
            }
            if (durationUnit === 'ms' && data.config?.duration !== undefined) {
                return String(data.config.duration);
            }
            return '';
        };

        const handleDurationChange = (value: string) => {
            const numValue = value === '' ? undefined : parseFloat(value);

            // Clear all duration fields and set only the selected unit
            const newConfig: any = {
                duration: undefined,
                durationSeconds: undefined,
                durationMinutes: undefined,
            };

            if (numValue !== undefined && !isNaN(numValue)) {
                if (durationUnit === 'minutes') {
                    newConfig.durationMinutes = numValue;
                } else if (durationUnit === 'seconds') {
                    newConfig.durationSeconds = numValue;
                } else {
                    newConfig.duration = numValue;
                }
            }

            handleConfigChange(newConfig);
        };

        const handleUnitChange = (newUnit: 'ms' | 'seconds' | 'minutes') => {
            // Convert existing value to new unit
            const currentValue = getCurrentValue();
            setDurationUnit(newUnit);

            if (currentValue) {
                // Re-apply the value with the new unit
                handleDurationChange(currentValue);
            }
        };

        return (
            <>
                <div className="config-field">
                    <label>Delay Duration</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            type="number"
                            min="0"
                            step={durationUnit === 'ms' ? '100' : '1'}
                            value={getCurrentValue()}
                            onChange={(e) => handleDurationChange(e.target.value)}
                            placeholder={`Enter ${durationUnit}`}
                            style={{ flex: 1 }}
                        />
                        <select
                            value={durationUnit}
                            onChange={(e) => handleUnitChange(e.target.value as 'ms' | 'seconds' | 'minutes')}
                            style={{ width: '100px' }}
                        >
                            <option value="ms">ms</option>
                            <option value="seconds">seconds</option>
                            <option value="minutes">minutes</option>
                        </select>
                    </div>
                    <div className="config-field-hint">
                        How long to pause before continuing to the next node
                    </div>
                </div>
                <div className="config-field">
                    <label>Quick Presets</label>
                    <div className="config-examples">
                        <button
                            type="button"
                            className="example-btn"
                            onClick={() => {
                                setDurationUnit('seconds');
                                handleConfigChange({
                                    duration: undefined,
                                    durationSeconds: 5,
                                    durationMinutes: undefined
                                });
                            }}
                        >
                            5 seconds
                        </button>
                        <button
                            type="button"
                            className="example-btn"
                            onClick={() => {
                                setDurationUnit('seconds');
                                handleConfigChange({
                                    duration: undefined,
                                    durationSeconds: 30,
                                    durationMinutes: undefined
                                });
                            }}
                        >
                            30 seconds
                        </button>
                        <button
                            type="button"
                            className="example-btn"
                            onClick={() => {
                                setDurationUnit('minutes');
                                handleConfigChange({
                                    duration: undefined,
                                    durationSeconds: undefined,
                                    durationMinutes: 1
                                });
                            }}
                        >
                            1 minute
                        </button>
                        <button
                            type="button"
                            className="example-btn"
                            onClick={() => {
                                setDurationUnit('minutes');
                                handleConfigChange({
                                    duration: undefined,
                                    durationSeconds: undefined,
                                    durationMinutes: 5
                                });
                            }}
                        >
                            5 minutes
                        </button>
                    </div>
                </div>
                <div className="config-field">
                    <label>How It Works</label>
                    <div className="branch-info">
                        <div className="branch-item true">
                            <span className="branch-indicator">⏳</span>
                            <span>Pauses workflow for the specified duration</span>
                        </div>
                        <div className="branch-item true">
                            <span className="branch-indicator">📤</span>
                            <span>Passes input data through unchanged</span>
                        </div>
                        <div className="branch-item true">
                            <span className="branch-indicator">🚫</span>
                            <span>Respects workflow cancellation</span>
                        </div>
                    </div>
                </div>
            </>
        );
    }
};

export default NodeConfigPanel;
