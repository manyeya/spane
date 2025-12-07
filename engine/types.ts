
export interface NodeJobData {
    executionId: string;
    workflowId: string;
    nodeId: string;
    inputData?: any;
    // Sub-workflow execution state
    subWorkflowStep?: 'initial' | 'waiting-children' | 'complete';
    childExecutionId?: string;
    // Delay node execution state
    /** Current step in delay node processing: 'initial' when first processed, 'resumed' after delay expires */
    delayStep?: 'initial' | 'resumed';
    /** Unix timestamp (ms) when the delay started, used for tracking delay duration */
    delayStartTime?: number;
}

export interface WorkflowJobData {
    workflowId: string;
    initialData?: any;
}

export interface DLQItem {
    jobId: string;
    data: NodeJobData;
    failedReason: string;
    timestamp: number;
    stacktrace?: string[];
}
