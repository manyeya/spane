// ============================================================================
// NODE REGISTRY
// ============================================================================

import type { INodeExecutor } from "../types";

/**
 * Extracts a unique identifier from node config for circuit breaker grouping.
 * Returns null to use 'default' as the identifier.
 */
export type CircuitBreakerKeyExtractor = (config: any) => string | null;

/**
 * Default external node key extractors for built-in node types.
 * These are registered automatically when calling registerDefaultExternalNodes().
 */
export const DEFAULT_EXTERNAL_NODE_EXTRACTORS: Record<string, CircuitBreakerKeyExtractor> = {
    http: (config) => {
        const url = config?.url;
        if (url && typeof url === 'string') {
            try {
                return new URL(url).host;
            } catch {
                return null;
            }
        }
        return null;
    },
    webhook: (config) => {
        const path = config?.path;
        return (path && typeof path === 'string') ? path : null;
    },
    database: (config) => {
        const id = config?.connectionId || config?.connection_id;
        return (id && typeof id === 'string') ? id : null;
    },
    email: (config) => {
        const host = config?.smtpHost || config?.smtp_host || config?.host;
        return (host && typeof host === 'string') ? host : null;
    },
};

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

  // Circuit breaker support for external nodes
  private circuitBreakerExtractors: Map<string, CircuitBreakerKeyExtractor> = new Map();

  /**
   * Register a node type as external (makes network calls to external services).
   * External nodes are protected by circuit breakers to prevent cascading failures.
   * 
   * @param nodeType - The node type (e.g., 'http', 'slack', 's3')
   * @param keyExtractor - Function to extract a unique identifier from node config
   *                       for circuit breaker grouping (e.g., API host, bucket name).
   *                       Return null to use 'default'.
   * 
   * @example
   * // Register a Slack node type
   * registry.registerExternalNode('slack', (config) => config?.workspace || null);
   * 
   * // Register an S3 node type  
   * registry.registerExternalNode('s3', (config) => config?.bucket || null);
   */
  registerExternalNode(nodeType: string, keyExtractor: CircuitBreakerKeyExtractor): void {
    this.circuitBreakerExtractors.set(nodeType, keyExtractor);
  }

  /**
   * Check if a node type is registered as external (needs circuit breaker).
   */
  isExternalNode(nodeType: string): boolean {
    return this.circuitBreakerExtractors.has(nodeType);
  }

  /**
   * Get the circuit breaker key for an external node.
   * Returns `{nodeType}:{identifier}` or `{nodeType}:default`.
   * Returns null if the node type is not registered as external.
   */
  getCircuitBreakerKey(nodeType: string, nodeConfig: any): string | null {
    const extractor = this.circuitBreakerExtractors.get(nodeType);
    if (!extractor) {
      return null; // Not an external node
    }
    const identifier = extractor(nodeConfig);
    return `${nodeType}:${identifier || 'default'}`;
  }

  /**
   * Register the default external node types (http, webhook, database, email).
   * Call this after creating the registry to enable circuit breaker protection
   * for built-in external node types.
   * 
   * @example
   * const registry = new NodeRegistry();
   * registry.registerDefaultExternalNodes();
   * 
   * // Now http, webhook, database, email nodes will use circuit breakers
   * registry.register('http', myHttpExecutor);
   */
  registerDefaultExternalNodes(): void {
    for (const [nodeType, extractor] of Object.entries(DEFAULT_EXTERNAL_NODE_EXTRACTORS)) {
      this.registerExternalNode(nodeType, extractor);
    }
  }
}