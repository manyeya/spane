/**
 * Migration script: Convert existing repeatable jobs to BullMQ Job Schedulers
 * 
 * This script migrates from the legacy repeatable job pattern to the new
 * upsertJobScheduler API, which provides idempotent schedule management.
 * 
 * Usage:
 *   bun run scripts/migrate-to-job-schedulers.ts [--dry-run] [--verbose]
 * 
 * Options:
 *   --dry-run   Preview changes without applying them
 *   --verbose   Show detailed logging
 */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

interface MigrationResult {
    migrated: number;
    skipped: number;
    failed: number;
    details: Array<{
        oldKey: string;
        newSchedulerId: string | null;
        status: 'migrated' | 'skipped' | 'failed';
        reason?: string;
    }>;
}

interface RepeatableJobInfo {
    key: string;
    id: string | null;
    name: string;
    endDate: number | null;
    tz: string | null;
    pattern: string | null;
    every: string | null;
    next: number;
}

/**
 * Parse a repeatable job to extract workflow ID and cron pattern.
 * Repeatable job IDs follow the pattern: schedule:{workflowId}:{cron}
 */
function parseRepeatableJobId(jobId: string | null): { workflowId: string; cron: string } | null {
    if (!jobId) return null;
    
    // Expected format: schedule:{workflowId}:{cron}
    const match = jobId.match(/^schedule:([^:]+):(.+)$/);
    if (!match) return null;
    
    return {
        workflowId: match[1],
        cron: match[2],
    };
}

/**
 * Migrate a single repeatable job to a job scheduler.
 */
async function migrateRepeatableJob(
    queue: Queue,
    job: RepeatableJobInfo,
    dryRun: boolean,
    verbose: boolean
): Promise<{ success: boolean; schedulerId: string | null; reason?: string }> {
    const parsed = parseRepeatableJobId(job.id);
    
    if (!parsed) {
        return {
            success: false,
            schedulerId: null,
            reason: `Could not parse job ID: ${job.id}`,
        };
    }
    
    const { workflowId, cron } = parsed;
    const schedulerId = `schedule:${workflowId}:${cron}`;
    
    if (verbose) {
        console.log(`  Processing: ${job.key}`);
        console.log(`    Workflow ID: ${workflowId}`);
        console.log(`    Cron: ${cron}`);
        console.log(`    Timezone: ${job.tz || 'default'}`);
    }
    
    if (dryRun) {
        console.log(`  [DRY RUN] Would migrate ${job.key} → ${schedulerId}`);
        return { success: true, schedulerId };
    }
    
    try {
        // Create the new job scheduler
        await queue.upsertJobScheduler(
            schedulerId,
            {
                pattern: job.pattern || cron,
                ...(job.tz && { tz: job.tz }),
                ...(job.endDate && { endDate: job.endDate }),
            },
            {
                name: 'workflow-execution',
                data: { workflowId },
            }
        );
        
        // Remove the old repeatable job
        await queue.removeRepeatableByKey(job.key);
        
        if (verbose) {
            console.log(`  ✓ Migrated ${job.key} → ${schedulerId}`);
        }
        
        return { success: true, schedulerId };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            schedulerId,
            reason: errorMsg,
        };
    }
}

/**
 * Main migration function.
 * Converts all existing repeatable jobs to job schedulers.
 */
export async function migrateRepeatableJobsToSchedulers(
    redisConnection: Redis,
    options: {
        dryRun?: boolean;
        verbose?: boolean;
        prefix?: string;
    } = {}
): Promise<MigrationResult> {
    const { dryRun = false, verbose = false, prefix = 'spane' } = options;
    
    const result: MigrationResult = {
        migrated: 0,
        skipped: 0,
        failed: 0,
        details: [],
    };
    
    const queue = new Queue('workflow-execution', {
        connection: redisConnection,
        prefix,
    });
    
    try {
        console.log('🔄 Starting migration from repeatable jobs to job schedulers...');
        if (dryRun) {
            console.log('   (DRY RUN - no changes will be made)');
        }
        console.log('');
        
        // Get all existing repeatable jobs
        const repeatableJobs = await queue.getRepeatableJobs();
        
        if (repeatableJobs.length === 0) {
            console.log('✓ No repeatable jobs found. Nothing to migrate.');
            return result;
        }
        
        console.log(`Found ${repeatableJobs.length} repeatable job(s) to process.\n`);
        
        for (const job of repeatableJobs) {
            // Only migrate jobs that follow our schedule pattern
            if (!job.id?.startsWith('schedule:')) {
                if (verbose) {
                    console.log(`  Skipping non-schedule job: ${job.key}`);
                }
                result.skipped++;
                result.details.push({
                    oldKey: job.key,
                    newSchedulerId: null,
                    status: 'skipped',
                    reason: 'Not a schedule job (ID does not start with "schedule:")',
                });
                continue;
            }
            
            const migrationResult = await migrateRepeatableJob(
                queue,
                job as RepeatableJobInfo,
                dryRun,
                verbose
            );
            
            if (migrationResult.success) {
                result.migrated++;
                result.details.push({
                    oldKey: job.key,
                    newSchedulerId: migrationResult.schedulerId,
                    status: 'migrated',
                });
            } else {
                result.failed++;
                result.details.push({
                    oldKey: job.key,
                    newSchedulerId: migrationResult.schedulerId,
                    status: 'failed',
                    reason: migrationResult.reason,
                });
                console.error(`  ✗ Failed to migrate ${job.key}: ${migrationResult.reason}`);
            }
        }
        
        // Print summary
        console.log('\n--- Migration Summary ---');
        console.log(`  Migrated: ${result.migrated}`);
        console.log(`  Skipped:  ${result.skipped}`);
        console.log(`  Failed:   ${result.failed}`);
        
        if (dryRun && result.migrated > 0) {
            console.log('\n💡 Run without --dry-run to apply these changes.');
        }
        
        return result;
    } finally {
        await queue.close();
    }
}

/**
 * Check if migration is needed by looking for existing repeatable jobs.
 */
export async function isMigrationNeeded(
    redisConnection: Redis,
    prefix: string = 'spane'
): Promise<boolean> {
    const queue = new Queue('workflow-execution', {
        connection: redisConnection,
        prefix,
    });
    
    try {
        const repeatableJobs = await queue.getRepeatableJobs();
        // Check if any jobs follow our schedule pattern
        return repeatableJobs.some(job => job.id?.startsWith('schedule:'));
    } finally {
        await queue.close();
    }
}

// CLI entry point
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const verbose = args.includes('--verbose');
    
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    console.log(`Connecting to Redis: ${redisUrl}`);
    
    const redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
    });
    
    try {
        const result = await migrateRepeatableJobsToSchedulers(redis, {
            dryRun,
            verbose,
        });
        
        if (result.failed > 0) {
            process.exit(1);
        }
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await redis.quit();
    }
}

// Run if executed directly
main().catch(console.error);
