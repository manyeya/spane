# React Flow n8n Clone

A visual workflow builder inspired by n8n, built with React Flow and integrated with the spane workflow engine.

## Features

- 🎨 **Drag-and-drop interface** - Build workflows visually by dragging nodes from the palette
- 🔄 **Multiple node types** - Triggers, Actions, and Control flow nodes
- ⚙️ **Node configuration** - Configure each node with custom parameters
- 🚀 **Real-time execution** - Execute workflows and see real-time status updates
- 💾 **Save/Load workflows** - Export workflows as JSON
- 🎯 **Validation** - Automatic workflow validation before execution

## Node Types

### Triggers
- **Schedule** - Run workflows on a cron schedule
- **Webhook** - Trigger via HTTP webhook
- **Manual** - Start workflows manually

### Actions
- **HTTP Request** - Make HTTP API calls
- **Transform** - Transform data with JavaScript code
- **Send Email** - Send email notifications
- **Database** - Query databases

### Control
- **Condition** - Branch based on conditions

## Getting Started

### Prerequisites

- Bun runtime
- Redis server running on localhost:6379

### Installation

```bash
cd examples/react-flow-n8n
bun install
```

### Running the Application

1. **Start the backend server** (in one terminal):
```bash
cd ../..
bun run examples/react-flow-backend.ts
```

2. **Start the frontend dev server** (in another terminal):
```bash
cd examples/react-flow-n8n
bun run dev
```

3. Open your browser to `http://localhost:3000`

## Usage

1. **Add nodes** - Drag nodes from the left palette onto the canvas
2. **Connect nodes** - Click and drag from one node's handle to another to create connections
3. **Configure nodes** - Click on a node to open its configuration panel
4. **Execute workflow** - Click the "Execute" button to run your workflow
5. **Monitor execution** - Watch as nodes update their status in real-time

## Example Workflows

### Simple HTTP Workflow
1. Add a "Manual" trigger
2. Add an "HTTP Request" action
3. Connect trigger to HTTP action
4. Configure HTTP action with a URL
5. Execute and see results

### Conditional Workflow
1. Add a "Manual" trigger
2. Add a "Transform" action to prepare data
3. Add a "Condition" node
4. Add two different actions for true/false branches
5. Connect and configure
6. Execute to see conditional branching

## Architecture

- **Frontend**: React + Vite + React Flow
- **Backend**: Elysia + spane workflow engine
- **State Management**: React hooks
- **Workflow Execution**: BullMQ + Redis

## API Endpoints

- `POST /api/workflows/execute` - Execute a workflow
- `GET /api/workflows/executions/:id` - Get execution status
- `GET /api/health` - Health check

## Development

### Project Structure

```
react-flow-n8n/
├── src/
│   ├── components/
│   │   ├── NodePalette.tsx      # Draggable node templates
│   │   └── NodeConfigPanel.tsx  # Node configuration UI
│   ├── nodes/
│   │   ├── TriggerNode.tsx      # Trigger node component
│   │   ├── ActionNode.tsx       # Action node component
│   │   └── ConditionNode.tsx    # Condition node component
│   ├── engine/
│   │   ├── workflowConverter.ts # Convert React Flow to spane
│   │   └── executionManager.ts  # Handle workflow execution
│   ├── styles/
│   │   ├── app.css              # Application styles
│   │   └── nodes.css            # Node styles
│   ├── App.tsx                  # Main application
│   └── main.tsx                 # Entry point
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Building for Production

```bash
bun run build
```

The built files will be in the `dist/` directory.

## License

MIT
