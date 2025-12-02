import React from 'react';

interface ExecutionResultsPanelProps {
    nodeResults: Record<string, any>;
    selectedNodeId: string | null;
    onClose: () => void;
}

const ExecutionResultsPanel: React.FC<ExecutionResultsPanelProps> = ({
    nodeResults,
    selectedNodeId,
    onClose
}) => {
    const hasResults = Object.keys(nodeResults).length > 0;
    
    if (!hasResults) return null;

    const displayResults = selectedNodeId && nodeResults[selectedNodeId] 
        ? { [selectedNodeId]: nodeResults[selectedNodeId] }
        : nodeResults;

    const formatValue = (value: any): string => {
        if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value, null, 2);
        }
        return String(value);
    };

    return (
        <div className="execution-results-panel">
            <div className="results-panel-header">
                <h3>
                    {selectedNodeId ? `Results: ${selectedNodeId}` : 'Execution Results'}
                </h3>
                <button className="results-panel-close" onClick={onClose}>
                    ×
                </button>
            </div>
            <div className="results-panel-body">
                {Object.entries(displayResults).map(([nodeId, result]) => (
                    <div key={nodeId} className="result-item">
                        <div className="result-header">
                            <span className="result-node-id">{nodeId}</span>
                            <span className={`result-status ${result?.success ? 'success' : 'error'}`}>
                                {result?.success ? '✓ Success' : '✗ Error'}
                            </span>
                        </div>
                        {result?.error && (
                            <div className="result-error">
                                <strong>Error:</strong> {result.error}
                            </div>
                        )}
                        {result?.data && (
                            <div className="result-data">
                                <strong>Data:</strong>
                                <pre className="result-json">
                                    {formatValue(result.data)}
                                </pre>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ExecutionResultsPanel;
