import { describe, test, expect, beforeEach } from "bun:test";
import * as fc from "fast-check";
import { NodeRegistry, DEFAULT_EXTERNAL_NODE_EXTRACTORS } from "../registry";

/**
 * Property-based tests for circuit breaker key generation.
 * 
 * **Feature: circuit-breaker-integration, Property 3: Circuit breaker key contains identifying information**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 * 
 * These tests verify that:
 * - HTTP nodes generate keys based on URL host
 * - Webhook nodes generate keys based on path
 * - Database nodes generate keys based on connection ID
 * - Email nodes generate keys based on SMTP host
 * - All keys contain the node type prefix
 */

// ============================================================================
// ARBITRARIES FOR CONFIG GENERATION
// ============================================================================

// Valid URL hosts
const hostArb = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,50}[a-z0-9]\.[a-z]{2,6}$/);

// Valid URL with host
const urlWithHostArb = fc.tuple(
  fc.constantFrom('http', 'https'),
  hostArb,
  fc.option(fc.stringMatching(/^\/[a-z0-9/-]{0,30}$/), { nil: '' })
).map(([protocol, host, path]) => `${protocol}://${host}${path || ''}`);

// HTTP node config with URL
const httpConfigWithUrlArb = urlWithHostArb.map(url => ({ url }));

// HTTP node config without URL
const httpConfigWithoutUrlArb = fc.oneof(
  fc.constant({}),
  fc.constant({ url: '' }),
  fc.constant({ url: 123 }),
  fc.constant({ url: null }),
  fc.constant({ otherField: 'value' })
);

// Webhook path
const webhookPathArb = fc.stringMatching(/^\/[a-z0-9/-]{1,50}$/);

// Webhook config with path
const webhookConfigWithPathArb = webhookPathArb.map(path => ({ path }));

// Webhook config without path
const webhookConfigWithoutPathArb = fc.oneof(
  fc.constant({}),
  fc.constant({ path: '' }),
  fc.constant({ path: 123 }),
  fc.constant({ path: null })
);

// Database connection ID
const connectionIdArb = fc.stringMatching(/^[a-z0-9-]{1,30}$/);

// Database config with connection ID (supports both camelCase and snake_case)
const databaseConfigWithIdArb = fc.tuple(
  connectionIdArb,
  fc.constantFrom('connectionId', 'connection_id')
).map(([id, key]) => ({ [key]: id }));

// Database config without connection ID
const databaseConfigWithoutIdArb = fc.oneof(
  fc.constant({}),
  fc.constant({ connectionId: '' }),
  fc.constant({ connectionId: 123 }),
  fc.constant({ connectionId: null })
);

// SMTP host
const smtpHostArb = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,30}\.[a-z]{2,6}$/);

// Email config with SMTP host (supports multiple field names)
const emailConfigWithHostArb = fc.tuple(
  smtpHostArb,
  fc.constantFrom('smtpHost', 'smtp_host', 'host')
).map(([host, key]) => ({ [key]: host }));

// Email config without SMTP host
const emailConfigWithoutHostArb = fc.oneof(
  fc.constant({}),
  fc.constant({ smtpHost: '' }),
  fc.constant({ smtpHost: 123 }),
  fc.constant({ smtpHost: null })
);

// Default external node types set
const DEFAULT_EXTERNAL_TYPES = new Set(Object.keys(DEFAULT_EXTERNAL_NODE_EXTRACTORS));

// ============================================================================
// PROPERTY TESTS
// ============================================================================

describe("Circuit breaker key generation property tests", () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.registerDefaultExternalNodes();
  });

  /**
   * **Feature: circuit-breaker-integration, Property 3: Circuit breaker key contains identifying information**
   * 
   * *For any* external node with configuration, the generated circuit breaker key 
   * SHALL contain the node type prefix and a configuration-derived identifier 
   * (URL host, webhook path, connection ID, or SMTP host).
   * 
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   */
  describe("Property 3: Circuit breaker key contains identifying information", () => {
    
    // Requirement 2.1: HTTP nodes use URL host
    describe("HTTP node keys", () => {
      test("HTTP key contains 'http:' prefix and URL host when URL is valid", async () => {
        await fc.assert(
          fc.asyncProperty(httpConfigWithUrlArb, async (config) => {
            const key = registry.getCircuitBreakerKey('http', config);
            
            // Property: key starts with 'http:'
            expect(key?.startsWith('http:')).toBe(true);
            
            // Property: key contains the host from the URL
            const url = new URL(config.url);
            expect(key).toBe(`http:${url.host}`);
          }),
          { numRuns: 100 }
        );
      });

      test("HTTP key defaults to 'http:default' when URL is missing or invalid", async () => {
        await fc.assert(
          fc.asyncProperty(httpConfigWithoutUrlArb, async (config) => {
            const key = registry.getCircuitBreakerKey('http', config);
            
            // Property: key should be the default
            expect(key).toBe('http:default');
          }),
          { numRuns: 100 }
        );
      });
    });

    // Requirement 2.2: Webhook nodes use path
    describe("Webhook node keys", () => {
      test("Webhook key contains 'webhook:' prefix and path when path is valid", async () => {
        await fc.assert(
          fc.asyncProperty(webhookConfigWithPathArb, async (config) => {
            const key = registry.getCircuitBreakerKey('webhook', config);
            
            // Property: key starts with 'webhook:'
            expect(key?.startsWith('webhook:')).toBe(true);
            
            // Property: key contains the path
            expect(key).toBe(`webhook:${config.path}`);
          }),
          { numRuns: 100 }
        );
      });

      test("Webhook key defaults to 'webhook:default' when path is missing or invalid", async () => {
        await fc.assert(
          fc.asyncProperty(webhookConfigWithoutPathArb, async (config) => {
            const key = registry.getCircuitBreakerKey('webhook', config);
            
            // Property: key should be the default
            expect(key).toBe('webhook:default');
          }),
          { numRuns: 100 }
        );
      });
    });

    // Requirement 2.3: Database nodes use connection ID
    describe("Database node keys", () => {
      test("Database key contains 'database:' prefix and connection ID when ID is valid", async () => {
        await fc.assert(
          fc.asyncProperty(databaseConfigWithIdArb, async (config) => {
            const key = registry.getCircuitBreakerKey('database', config);
            
            // Property: key starts with 'database:'
            expect(key?.startsWith('database:')).toBe(true);
            
            // Property: key contains the connection ID
            const expectedId = config.connectionId || config.connection_id;
            expect(key).toBe(`database:${expectedId}`);
          }),
          { numRuns: 100 }
        );
      });

      test("Database key defaults to 'database:default' when connection ID is missing or invalid", async () => {
        await fc.assert(
          fc.asyncProperty(databaseConfigWithoutIdArb, async (config) => {
            const key = registry.getCircuitBreakerKey('database', config);
            
            // Property: key should be the default
            expect(key).toBe('database:default');
          }),
          { numRuns: 100 }
        );
      });
    });

    // Requirement 2.4: Email nodes use SMTP host
    describe("Email node keys", () => {
      test("Email key contains 'email:' prefix and SMTP host when host is valid", async () => {
        await fc.assert(
          fc.asyncProperty(emailConfigWithHostArb, async (config) => {
            const key = registry.getCircuitBreakerKey('email', config);
            
            // Property: key starts with 'email:'
            expect(key?.startsWith('email:')).toBe(true);
            
            // Property: key contains the SMTP host
            const expectedHost = config.smtpHost || config.smtp_host || config.host;
            expect(key).toBe(`email:${expectedHost}`);
          }),
          { numRuns: 100 }
        );
      });

      test("Email key defaults to 'email:default' when SMTP host is missing or invalid", async () => {
        await fc.assert(
          fc.asyncProperty(emailConfigWithoutHostArb, async (config) => {
            const key = registry.getCircuitBreakerKey('email', config);
            
            // Property: key should be the default
            expect(key).toBe('email:default');
          }),
          { numRuns: 100 }
        );
      });
    });

    // General properties
    describe("General key properties", () => {
      test("all external node keys contain node type prefix", async () => {
        // Only test external node types
        const externalNodeTypes = ['http', 'webhook', 'database', 'email'];
        
        for (const nodeType of externalNodeTypes) {
          const key = registry.getCircuitBreakerKey(nodeType, {});
          expect(key?.startsWith(`${nodeType}:`)).toBe(true);
        }
      });

      test("null or undefined config produces default key", async () => {
        const nodeTypes = ['http', 'webhook', 'database', 'email'];
        
        for (const nodeType of nodeTypes) {
          const keyWithNull = registry.getCircuitBreakerKey(nodeType, null);
          const keyWithUndefined = registry.getCircuitBreakerKey(nodeType, undefined);
          
          expect(keyWithNull).toBe(`${nodeType}:default`);
          expect(keyWithUndefined).toBe(`${nodeType}:default`);
        }
      });

      test("non-external node types return null", async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => 
              !DEFAULT_EXTERNAL_TYPES.has(s)
            ),
            async (nodeType) => {
              // Property: non-external types should return null (not registered)
              const key = registry.getCircuitBreakerKey(nodeType, {});
              expect(key).toBeNull();
            }
          ),
          { numRuns: 100 }
        );
      });
    });
  });
});
