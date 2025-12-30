/**
 * Job data for node execution jobs in BullMQ.
 * 
 * Note: The following deprecated fields have been removed as part of the BullMQ improvements:
 * - `subWorkflowStep`: Replaced by FlowProducer pattern (no checkpoint/resume needed)
 * - `childExecutionId`: Replaced by FlowProducer parent-child job dependencies
 * 
 * Sub-workflow execution now uses BullMQ's native FlowProducer with aggregator nodes
 * instead of the old checkpoint/resume pattern.
 */
export interface NodeJobData {
    executionId: string;
    workflowId: string;
    nodeId: string;
    inputData?: any;
    
    // Delay node execution state
    /** Current step in delay node processing: 'initial' when first processed, 'resumed' after delay expires */
    delayStep?: 'initial' | 'resumed';
    /** Unix timestamp (ms) when the delay started, used for tracking delay duration */
    delayStartTime?: number;
    
    // FlowProducer sub-workflow aggregator fields (replaces old checkpoint/resume pattern)
    /** Flag indicating this is a sub-workflow aggregator node that collects child results */
    isSubWorkflowAggregator?: boolean;
    /** Parent execution ID for sub-workflow aggregator to notify on completion */
    parentExecutionId?: string;
    /** Parent node ID for sub-workflow aggregator to notify on completion */
    parentNodeId?: string;
    /** Output mapping configuration for transforming aggregated results */
    outputMapping?: Record<string, string>;
}

/**
 * Job data for workflow execution jobs in BullMQ.
 * Used for scheduled workflow triggers and manual workflow starts.
 */
export interface WorkflowJobData {
    workflowId: string;
    initialData?: any;
}

/**
 * Dead Letter Queue item structure.
 * Contains failed job data for debugging and manual retry.
 */
export interface DLQItem {
    jobId: string;
    data: NodeJobData;
    failedReason: string;
    timestamp: number;
    stacktrace?: string[];
}
