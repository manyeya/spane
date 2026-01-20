# Test Infrastructure - Bun Test + Fast-Check

**Generated:** Tue Jan 13 2026
**Commit:** 0e18d4a

## OVERVIEW

54 test files using **Bun test runner** with **fast-check** property-based testing. Tests co-located with engine code in `src/engine/tests/`.

## STRUCTURE

```
src/engine/tests/
├── *.property.test.ts      # 41 files - Fast-check property tests
├── *.unit.test.ts         # 8 files - Unit tests with mocks
├── *.integration.test.ts   # 5 files - Real Redis connections
└── *.test.ts              # 2 files - Interface contracts
```

## WHERE TO LOOK

| Test Type | Pattern | Example File |
|-----------|----------|---------------|
| **Property tests** | `*.property.test.ts` | `atomic-workflow-completion.property.test.ts` |
| **Unit tests** | `*.unit.test.ts` | `native-rate-limiting.unit.test.ts` |
| **Integration tests** | `*.integration.test.ts` | `event-streaming-integration.test.ts` |

## CONVENTIONS

**Test runner:** `bun:test` (import `describe, test, expect, beforeEach, afterEach, mock, spyOn`)
**Property testing:** `fast-check` (import `fc`, use `fc.asyncProperty`, `{ numRuns: 100 }`)

**Mock patterns:**
- Unit tests: Inline mock factories (`createMockRedis()`, `createMockStateStore()`)
- `mock()` from bun:test → `mock.restore()` in `afterEach`
- `spyOn()` for method mocking

**Integration test setup:**
- Real Redis in `beforeAll` with 5s timeout
- Fresh queues in `beforeEach` → `obliterate({ force: true })`
- Close all resources in `afterEach`

**State reset:**
- `beforeEach`: Instantiate fresh mocks/objects
- `afterEach`: `mock.restore()` for all mocks
- Tracking classes: `clearAll()` methods for custom stores

## ANTI-PATTERNS (TEST INFRASTRUCTURE)

**No major anti-patterns found.** Test infrastructure is well-organized.

**Minor notes:**
- Some integration tests have hardcoded delays (`setTimeout(..., 100)`) for queue readiness
- Property tests use 100 runs by default (can reduce to 20 for faster iteration during dev)

## UNIQUE STYLES

**Custom arbitraries (module-level):**
```typescript
const executionIdArb = fc.stringMatching(/^exec-[a-z0-9]{8,16}$/);
const executionStatusArb = fc.constantFrom('running', 'completed', 'failed');
```

**Requirement documentation:**
```typescript
/**
 * **Validates: Requirements FR-1.1, FR-1.2**
 * These tests verify nested sub-workflow structure
 */
```

**Helper functions mirroring implementation:**
- Tests include functions that mirror production logic for algorithm validation
- Example: `buildFlowTreeFromEntryNodes()` in tests matches implementation

**TrackingExecutionStore pattern:**
- Extends `InMemoryExecutionStore` with custom counters
- `resetCounters()`, `clearAll()` methods for test isolation

## NOTES

**Test execution:**
```bash
bun test                                    # Run all tests
bun test atomic-workflow-completion       # Run specific file
bun test --property "atomic completion"  # Run tests matching name
```

**Mock Redis in unit tests:**
```typescript
const mockRedis = {
    incr: mock(() => 1),
    expire: mock(() => 1),
    set: mock(() => "OK"),
    // ...
};
```

**Real Redis in integration tests:**
```typescript
beforeAll(async () => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    await waitForRedis(redis);
});
```

**Property test structure:**
```typescript
test("workflow status updated exactly once", async () => {
    await fc.assert(
        fc.asyncProperty(executionIdArb, workflowIdArb, async (execId, wfId) => {
            // Property assertion
        }),
        { numRuns: 100 }
    );
});
```

**Fixtures (inline, no separate files):**
```typescript
function createSimpleWorkflow(): WorkflowDefinition {
    return { id: 'wf-1', nodes: [...], entryNodeId: 'start' };
}
```

**Documentation standards:**
- File header: Feature/Validates/Requirements sections
- Property documentation: "*For any* workflow ... SHALL be updated exactly once"
