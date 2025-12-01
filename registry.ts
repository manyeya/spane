// ============================================================================
// NODE REGISTRY
// ============================================================================

import type { INodeExecutor } from "./types";

export class NodeRegistry {
  private executors: Map<string, INodeExecutor> = new Map();

  register(nodeType: string, executor: INodeExecutor): void {
    this.executors.set(nodeType, executor);
  }

  get(nodeType: string): INodeExecutor | undefined {
    return this.executors.get(nodeType);
  }

  has(nodeType: string): boolean {
    return this.executors.has(nodeType);
  }
}