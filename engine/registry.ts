// ============================================================================
// NODE REGISTRY
// ============================================================================

import type { INodeExecutor } from "../types";

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

  // Rate limiting support
  private rateLimits: Map<string, number> = new Map();

  registerRateLimit(nodeType: string, limitPerSecond: number): void {
    if (!Number.isFinite(limitPerSecond) || limitPerSecond <= 0) {
      throw new Error(`Invalid rate limit: ${limitPerSecond}. Must be a positive finite number.`);
    }
    this.rateLimits.set(nodeType, limitPerSecond);
  }

  getRateLimit(nodeType: string): number | undefined {
    return this.rateLimits.get(nodeType);
  }
}