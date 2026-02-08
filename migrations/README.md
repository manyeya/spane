# Database Migration Notes

## Unique Constraint on node_results Table

### Migration Required

After pulling the latest changes, you need to add a unique constraint to the `node_results` table to enable atomic upsert operations.

### Why This Change?

The unique constraint on `(execution_id, node_id)` enables:
1. **Atomic upserts** using `INSERT ... ON CONFLICT DO UPDATE`
2. **Prevents duplicate node results** for the same execution/node pair
3. **Improves concurrency** by avoiding check-then-act race conditions

### Migration SQL

```sql
-- Create unique index on (execution_id, node_id)
CREATE UNIQUE INDEX IF NOT EXISTS node_results_execution_node_unique_idx
ON node_results (execution_id, node_id);
```

### Verify Migration

After running the migration, verify the constraint exists:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'node_results';
```

You should see `node_results_execution_node_unique_idx` in the list.

### Rollback (if needed)

```sql
DROP INDEX IF EXISTS node_results_execution_node_unique_idx;
```

### Drizzle Migration

If using Drizzle migrations, run:

```bash
bun run db:generate  # Generate migration from schema changes
bun run db:push      # Apply migration to database
```
