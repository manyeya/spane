import React from 'react';

interface NodeTemplate {
    type: string;
    label: string;
    icon: string;
    description: string;
    category: 'trigger' | 'action' | 'control';
    nodeType: 'trigger' | 'action' | 'condition' | 'delay';
    subType?: string;
}

const nodeTemplates: NodeTemplate[] = [
    // Triggers
    {
        type: 'trigger-schedule',
        label: 'Schedule',
        icon: '⏰',
        description: 'Run on a schedule',
        category: 'trigger',
        nodeType: 'trigger',
        subType: 'schedule'
    },
    {
        type: 'trigger-webhook',
        label: 'Webhook',
        icon: '🔗',
        description: 'Trigger via HTTP',
        category: 'trigger',
        nodeType: 'trigger',
        subType: 'webhook'
    },
    {
        type: 'trigger-manual',
        label: 'Manual',
        icon: '▶️',
        description: 'Start manually',
        category: 'trigger',
        nodeType: 'trigger',
        subType: 'manual'
    },
    // Actions
    {
        type: 'action-http',
        label: 'HTTP Request',
        icon: '🌐',
        description: 'Make HTTP call',
        category: 'action',
        nodeType: 'action',
        subType: 'http'
    },
    {
        type: 'action-transform',
        label: 'Transform',
        icon: '⚙️',
        description: 'Transform data',
        category: 'action',
        nodeType: 'action',
        subType: 'transform'
    },
    {
        type: 'action-email',
        label: 'Send Email',
        icon: '📧',
        description: 'Send notification',
        category: 'action',
        nodeType: 'action',
        subType: 'email'
    },
    {
        type: 'action-database',
        label: 'Database',
        icon: '🗄️',
        description: 'Query database',
        category: 'action',
        nodeType: 'action',
        subType: 'database'
    },
    // Control
    {
        type: 'control-condition',
        label: 'Condition',
        icon: '🔀',
        description: 'Branch logic',
        category: 'control',
        nodeType: 'condition'
    },
    {
        type: 'control-delay',
        label: 'Delay',
        icon: '⏳',
        description: 'Pause execution',
        category: 'control',
        nodeType: 'delay',
        subType: 'delay'
    }
];

interface NodePaletteProps {
    onDragStart: (event: React.DragEvent, nodeTemplate: NodeTemplate) => void;
}

const NodePalette: React.FC<NodePaletteProps> = ({ onDragStart }) => {
    const categories = {
        trigger: nodeTemplates.filter(n => n.category === 'trigger'),
        action: nodeTemplates.filter(n => n.category === 'action'),
        control: nodeTemplates.filter(n => n.category === 'control')
    };

    return (
        <div className="node-palette">
            <div className="node-category">
                <h3>Triggers</h3>
                {categories.trigger.map(template => (
                    <div
                        key={template.type}
                        className="palette-node"
                        draggable
                        onDragStart={(e) => onDragStart(e, template)}
                    >
                        <div className="palette-node-icon" style={{
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white'
                        }}>
                            {template.icon}
                        </div>
                        <div className="palette-node-content">
                            <div className="palette-node-title">{template.label}</div>
                            <div className="palette-node-description">{template.description}</div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="node-category">
                <h3>Actions</h3>
                {categories.action.map(template => (
                    <div
                        key={template.type}
                        className="palette-node"
                        draggable
                        onDragStart={(e) => onDragStart(e, template)}
                    >
                        <div className="palette-node-icon" style={{
                            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                            color: 'white'
                        }}>
                            {template.icon}
                        </div>
                        <div className="palette-node-content">
                            <div className="palette-node-title">{template.label}</div>
                            <div className="palette-node-description">{template.description}</div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="node-category">
                <h3>Control</h3>
                {categories.control.map(template => (
                    <div
                        key={template.type}
                        className="palette-node"
                        draggable
                        onDragStart={(e) => onDragStart(e, template)}
                    >
                        <div className="palette-node-icon" style={{
                            background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                            color: 'white'
                        }}>
                            {template.icon}
                        </div>
                        <div className="palette-node-content">
                            <div className="palette-node-title">{template.label}</div>
                            <div className="palette-node-description">{template.description}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default NodePalette;
export type { NodeTemplate };
