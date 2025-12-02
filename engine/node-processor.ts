import { Job, DelayedError } from 'bullmq';
import { Redis } from 'ioredis';
import { NodeRegistry } from '../registry';
import type { IExecutionStateStore, WorkflowDefinition, ExecutionResult } from '../types';
import type { NodeJobData } from './types';
import { QueueManager } from './queue-manager';

export type EnqueueWorkflowFn = (
    workflowId: string,
    initialData?: any,
    parentExecutionId?: string,
    depth?: number
) => Promise<string>;

export class NodeProcessor {
    constructor(
        private registry: NodeRegistry,
        private stateStore: IExecutionStateStore,
        private redisConnection: Redis,
        private queueManager: QueueManager,
        private workflows: Map<string, WorkflowDefinition>,
        private enqueueWorkflow: EnqueueWorkflowFn
    ) { }

    // Process a single node job
    async processNodeJob(data: NodeJobData, job: Job): Promise<ExecutionResult> {
        const { executionId, workflowId, nodeId, inputData } = data;
        console.log(`🔧 Processing node job: executionId=${executionId}, workflowId=${workflowId}, nodeId=${nodeId}`);

        // Handle virtual root node (for workflows with multiple entry points)
        if (nodeId === '__root__') {
            return { success: true, data: { message: 'Virtual root node' } };
        }

        const workflow = this.workflows.get(workflowId);

        if (!workflow) {
            console.error(`❌ Workflow ${workflowId} not found in NodeProcessor.`);
            console.error(`Available workflows: ${Array.from(this.workflows.keys()).join(', ')}`);
            throw new Error(`Workflow ${workflowId} not found`);
        }

        const node = workflow.nodes.find(n => n.id === nodeId);

        if (!node) {
            throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`);
        }

        // Special handling for sub-workflow node type (before regular execution checks)
        if (node.type === 'sub-workflow') {
            // Gather results from upstream nodes
            const execution = await this.stateStore.getExecution(executionId);
            const previousResults = execution?.nodeResults || {};

            const config = node.config as { workflowId: string; inputMapping?: Record<string, string>; outputMapping?: Record<string, string> };

            if (!config.workflowId) {
                return {
                    success: false,
                    error: 'Sub-workflow node missing workflowId in config'
                };
            }

            // Process input data for sub-workflow (same logic as regular nodes)
            let processedInputData: any = inputData;

            if (node.inputs.length === 1) {
                const parentId = node.inputs[0];
                if (parentId) {
                    const parentResult = previousResults[parentId];
                    if (parentResult?.success && parentResult.data !== undefined) {
                        processedInputData = parentResult.data;
                    } else {
                        processedInputData = undefined;
                    }
                }
            } else if (node.inputs.length > 1) {
                const mergedData: Record<string, any> = {};
                for (const parentId of node.inputs) {
                    const parentResult = previousResults[parentId];
                    if (parentResult?.success && parentResult.data !== undefined) {
                        mergedData[parentId] = parentResult.data;
                    }
                }
                processedInputData = mergedData;
            }

            // Determine execution step based on job data
            const currentStep = data.subWorkflowStep || 'initial';
            const existingChildExecutionId = data.childExecutionId;

            // Execute sub-workflow with step-based approach
            const result = await this.executeSubWorkflow(
                executionId,
                workflowId,
                nodeId,
                job.id!,
                config,
                processedInputData,
                execution?.depth || 0,
                currentStep,
                existingChildExecutionId
            );

            // If checkpoint requested, parent job completes immediately (non-blocking!)
            if (result.checkpoint) {
                // Save checkpoint state with child execution ID
                // The completion hook will detect when child finishes and re-enqueue this node
                await this.stateStore.updateNodeResult(executionId, nodeId, {
                    success: true,
                    data: {
                        checkpointed: true,
                        childExecutionId: result.childExecutionId,
                        subWorkflowStep: 'waiting-children'
                    }
                });

                console.log(`💾 Checkpoint saved: Node ${nodeId} waiting for child ${result.childExecutionId}`);

                // Return success - job completes and frees the worker!
                return {
                    success: true,
                    data: {
                        checkpointed: true,
                        childExecutionId: result.childExecutionId
                    }
                };
            }

            // If no checkpoint (or resumed from checkpoint), save and return result
            await this.stateStore.updateNodeResult(executionId, nodeId, result);
            return result;
        }

        // Regular node execution
        const executor = this.registry.get(node.type);

        if (!executor) {
            throw new Error(`No executor registered for node type: ${node.type}`);
        }

        // --- IDEMPOTENCY & STATE FETCH ---
        // Optimization: Use getNodeResults for a lightweight idempotency check.
        const existingResults = await this.stateStore.getNodeResults(executionId, [nodeId]);
        const existingResult = existingResults[nodeId];
        if (existingResult && (existingResult.success || existingResult.skipped)) {
            console.log(`- Idempotency check: Node ${nodeId} already processed with status: ${existingResult.skipped ? 'skipped' : 'success'}. Skipping.`);
            return existingResult;
        }

        // Fetch execution status separately.
        const executionState = await this.stateStore.getExecution(executionId); // Keep for status check
        const parentNodeIds = node.inputs;
        const previousResults = await this.stateStore.getNodeResults(executionId, parentNodeIds);

        // Check execution status before running
        if (executionState?.status === 'cancelled') {
            console.log(`🚫 Execution ${executionId} is cancelled. Skipping node ${nodeId}.`);
            return { success: false, error: 'Workflow execution cancelled' };
        }

        if (executionState?.status === 'paused') {
            console.log(`⏸️ Execution ${executionId} is paused. Moving to delayed queue.`);
            await job.moveToDelayed(Date.now() + 5000, job.token); // Retry in 5 seconds
            throw new DelayedError();
        }

        // --- Rate Limiting Check ---
        const rateLimit = this.registry.getRateLimit(node.type);
        if (rateLimit) {
            const key = `rate-limit:${node.type}:${Math.floor(Date.now() / 1000)}`;
            const current = await this.redisConnection.incr(key);
            if (current === 1) {
                await this.redisConnection.expire(key, 2); // Expire after 2 seconds to be safe
            }

            if (current > rateLimit) {
                console.log(`⏳ Rate limit exceeded for ${node.type}. Re-queueing.`);
                await job.moveToDelayed(Date.now() + 1000, job.token);
                throw new DelayedError();
            }
        }

        // --- Concurrency Check ---
        const maxConcurrency = workflow.maxConcurrency;
        if (maxConcurrency) {
            const activeKey = `workflow:active:${executionId}`;
            // Implementation of workflow-level concurrency would go here if needed
            // For now, we rely on queue concurrency
        }

        // --- Data Passing Logic ---
        let nodeInputData: any = inputData;

        if (node.inputs.length > 0) {
            // If we have inputs, we need to gather data from parent nodes
            if (node.inputs.length === 1) {
                // Single parent: Pass data directly
                const parentId = node.inputs[0];
                if (parentId) {
                    const parentResult = previousResults[parentId];
                    if (parentResult?.success && parentResult.data !== undefined) {
                        nodeInputData = parentResult.data;
                    }
                }
            } else {
                // Multiple parents: Merge data into an object keyed by parent node ID
                const mergedData: Record<string, any> = {};
                for (const parentId of node.inputs) {
                    const parentResult = previousResults[parentId];
                    if (parentResult?.success && parentResult.data !== undefined) {
                        mergedData[parentId] = parentResult.data;
                    }
                }
                nodeInputData = mergedData;
            }
        }

        const context: any = {
            workflowId,
            executionId,
            nodeId,
            inputData: nodeInputData,
            nodeConfig: node.config,
            previousResults,
            parentExecutionId: executionState?.parentExecutionId,
            depth: executionState?.depth || 0,
        };

        // Execute the node
        console.log(`▶️ Executing node ${nodeId} (${node.type})`);
        try {
            const result = await executor.execute(context);

            // Save result
            await this.stateStore.updateNodeResult(executionId, nodeId, result);

            // If this node succeeded, check and enqueue/skip its children
            if (result.success && node.outputs.length > 0) {
                console.log(`📤 Node ${nodeId} completed successfully, checking ${node.outputs.length} children`);
                await this.checkAndEnqueueChildren(executionId, workflowId, node, result.nextNodes);
            }

            // Check if workflow is complete
            await this.checkWorkflowCompletion(executionId, workflowId);

            return result;
        } catch (error) {
            console.error(`❌ Node ${nodeId} execution failed:`, error);
            throw error; // Let BullMQ handle retries
        }
    }

    private async checkAndEnqueueChildren(executionId: string, workflowId: string, node: any, nextNodes?: string[]): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) return;

        for (const childNodeId of node.outputs) {
            // Check if this child should be skipped based on conditional branching
            // If nextNodes is provided, only those nodes should run. Others are skipped.
            const shouldRun = !nextNodes || nextNodes.includes(childNodeId);

            if (!shouldRun) {
                console.log(`🚫 Node ${childNodeId} excluded by conditional branching. Marking as skipped.`);
                await this.skipNode(executionId, workflowId, childNodeId);
                continue;
            }

            const childNode = workflow.nodes.find(n => n.id === childNodeId);
            if (!childNode) continue;

            // Check if all parents of this child have completed
            const parentIds = childNode.inputs;
            const parentResults = await this.stateStore.getNodeResults(executionId, parentIds);

            const allParentsCompleted = parentIds.every(pid => {
                const res = parentResults[pid];
                return res && (res.success || res.skipped);
            });

            if (allParentsCompleted) {
                console.log(`✅ All parents of ${childNodeId} resolved, enqueueing`);
                await this.enqueueNode(executionId, workflowId, childNodeId);
            } else {
                console.log(`⏳ Child node ${childNodeId} waiting for other parents`);
            }
        }
    }

    private async skipNode(executionId: string, workflowId: string, nodeId: string): Promise<void> {
        // Mark as skipped in state store
        await this.stateStore.updateNodeResult(executionId, nodeId, {
            success: true,
            skipped: true,
            data: null
        });

        // Propagate skip to children
        const workflow = this.workflows.get(workflowId);
        const node = workflow?.nodes.find(n => n.id === nodeId);
        if (node) {
            // Recursively check children. 
            // We pass undefined for nextNodes because a skipped node doesn't choose paths, 
            // but its children might still run if they are merges.
            await this.checkAndEnqueueChildren(executionId, workflowId, node);
        }
    }

    private async enqueueNode(executionId: string, workflowId: string, nodeId: string, options: { delay?: number } = {}): Promise<void> {
        const jobData: NodeJobData = {
            executionId,
            workflowId,
            nodeId,
            inputData: {}, // Input data is fetched during execution now
        };

        await this.queueManager.nodeQueue.add('process-node', jobData, {
            jobId: `${executionId}-node-${nodeId}-${Date.now()}`, // Unique ID for every run
            delay: options.delay,
        });
    }

    private async checkWorkflowCompletion(executionId: string, workflowId: string): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) return;

        // Check if already failed/cancelled
        const currentExecution = await this.stateStore.getExecution(executionId);
        if (currentExecution?.status === 'failed' || currentExecution?.status === 'cancelled') {
            return;
        }

        const totalNodes = workflow.nodes.length;
        const pendingCount = await this.stateStore.getPendingNodeCount(executionId, totalNodes);

        if (pendingCount === 0) {
            await this.stateStore.setExecutionStatus(executionId, 'completed');
            console.log(`🎉 Workflow ${executionId} completed successfully`);
            await this.notifyParentWorkflow(executionId, 'completed');
        }
    }

    async handleWorkflowError(executionId: string, error: any): Promise<void> {
        await this.stateStore.setExecutionStatus(executionId, 'failed');
        await this.notifyParentWorkflow(executionId, 'failed');
    }

    private async notifyParentWorkflow(executionId: string, status: 'completed' | 'failed'): Promise<void> {
        const execution = await this.stateStore.getExecution(executionId);
        if (!execution || !execution.parentExecutionId) return;

        // We need parentNodeId. It should be in metadata.
        const metadata = execution.metadata || {};
        const { parentExecutionId, parentNodeId, parentWorkflowId } = metadata;

        if (parentExecutionId && parentNodeId) {
            console.log(`🔔 Notifying parent workflow ${parentExecutionId} (node ${parentNodeId}) of child ${executionId} ${status}`);
            await this.enqueueNode(parentExecutionId, parentWorkflowId || 'unknown', parentNodeId);
        }
    }

    // Execute a sub-workflow using Checkpoint & Resume pattern (fully non-blocking)
    private async executeSubWorkflow(
        parentExecutionId: string,
        parentWorkflowId: string,
        parentNodeId: string,
        parentJobId: string,
        config: { workflowId: string; inputMapping?: Record<string, string>; outputMapping?: Record<string, string> },
        inputData: any,
        depth: number,
        step: 'initial' | 'waiting-children' | 'complete',
        childExecutionId?: string
    ): Promise<ExecutionResult & { checkpoint?: boolean; childExecutionId?: string }> {
        const { workflowId, inputMapping, outputMapping } = config;

        // Validate sub-workflow exists
        if (!this.workflows.has(workflowId)) {
            return {
                success: false,
                error: `Sub-workflow '${workflowId}' not found`
            };
        }

        try {
            // Step 1: Initial - start child and checkpoint immediately (NO WAITING)
            if (step === 'initial') {
                // Apply input mapping
                let mappedInput = inputData;
                if (inputMapping && typeof inputData === 'object' && inputData !== null) {
                    mappedInput = {};
                    for (const [targetKey, sourceKey] of Object.entries(inputMapping)) {
                        if (sourceKey in inputData) {
                            mappedInput[targetKey] = inputData[sourceKey];
                        }
                    }
                }

                console.log(`🔀 Sub-workflow ${workflowId} starting (parent: ${parentExecutionId}, depth: ${depth + 1})`);

                // Start child workflow (normal enqueue, no parent reference needed)
                const newChildExecutionId = await this.enqueueWorkflow(
                    workflowId,
                    mappedInput,
                    parentExecutionId,
                    depth + 1
                );

                // CRITICAL: Store parent node info in execution metadata for resume callback
                // This will be used by the completion hook to re-enqueue the parent node
                const metadata = {
                    parentNodeId,
                    parentWorkflowId
                };
                await this.stateStore.updateExecutionMetadata(newChildExecutionId, metadata);

                console.log(`✅ Sub-workflow checkpoint: ${workflowId} started, parent node will resume when child completes`);

                // Return with checkpoint flag - parent job will complete and free the worker!
                return {
                    success: true,
                    checkpoint: true,
                    childExecutionId: newChildExecutionId,
                    data: { childExecutionId: newChildExecutionId }
                };
            }

            // Step 2: Resume/Complete - child finished, aggregate results
            if (step === 'complete' && childExecutionId) {
                const childExecution = await this.stateStore.getExecution(childExecutionId);

                if (!childExecution) {
                    return {
                        success: false,
                        error: `Sub-workflow execution ${childExecutionId} not found`
                    };
                }

                if (childExecution.status === 'completed') {
                    // Aggregate results from final nodes
                    const workflow = this.workflows.get(workflowId)!;
                    const finalNodes = workflow.nodes.filter(node => node.outputs.length === 0);

                    let aggregatedResult: any = {};

                    if (finalNodes.length === 1 && finalNodes[0]) {
                        const finalNodeId = finalNodes[0].id;
                        const result = childExecution.nodeResults[finalNodeId];
                        aggregatedResult = result?.data;
                    } else if (finalNodes.length > 1) {
                        for (const node of finalNodes) {
                            const result = childExecution.nodeResults[node.id];
                            if (result?.success && result.data !== undefined) {
                                aggregatedResult[node.id] = result.data;
                            }
                        }
                    }

                    // Apply output mapping
                    let mappedOutput = aggregatedResult;
                    if (outputMapping && typeof aggregatedResult === 'object' && aggregatedResult !== null) {
                        mappedOutput = {};
                        for (const [targetKey, sourceKey] of Object.entries(outputMapping)) {
                            if (sourceKey in aggregatedResult) {
                                mappedOutput[targetKey] = aggregatedResult[sourceKey];
                            }
                        }
                    }

                    console.log(`✅ Sub-workflow ${workflowId} completed (execution: ${childExecutionId})`);
                    return {
                        success: true,
                        data: mappedOutput
                    };
                }

                if (childExecution.status === 'failed') {
                    console.error(`❌ Sub-workflow ${workflowId} failed (execution: ${childExecutionId})`);
                    return {
                        success: false,
                        error: `Sub-workflow '${workflowId}' failed`,
                        data: childExecution.nodeResults
                    };
                }

                if (childExecution.status === 'cancelled') {
                    console.log(`🚫 Sub-workflow ${workflowId} cancelled (execution: ${childExecutionId})`);
                    return {
                        success: false,
                        error: `Sub-workflow '${workflowId}' was cancelled`
                    };
                }

                // Child still running - this shouldn't happen in checkpoint-resume
                // but if it does, just return success and it will be retried
                console.log(`⏳ Sub-workflow ${workflowId} still running, will check again`);
                return {
                    success: true,
                    checkpoint: true,
                    childExecutionId,
                    data: { status: 'waiting' }
                };
            }

            return {
                success: false,
                error: 'Invalid sub-workflow execution step'
            };

        } catch (error) {
            console.error(`❌ Sub-workflow ${workflowId} error:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}
