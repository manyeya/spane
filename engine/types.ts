
export interface NodeJobData {
    executionId: string;
    workflowId: string;
    nodeId: string;
    inputData?: any;
    // Sub-workflow execution state
    subWorkflowStep?: 'initial' | 'waiting-children' | 'complete';
    childExecutionId?: string;
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
