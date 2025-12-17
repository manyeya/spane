import { z } from 'zod';

const envSchema = z.object({
    // Core
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    DATABASE_URL: z.string().optional(),

    // Blob Storage (Large Payloads)
    BLOB_STORAGE_TYPE: z.enum(['filesystem', 's3']).default('filesystem'),
    BLOB_STORAGE_PATH: z.string().default('./.spane-storage'),
    BLOB_STORAGE_THRESHOLD: z.coerce.number().default(51200), // 50KB default

    // Execution Pruning
    EXECUTIONS_DATA_PRUNE: z.coerce.boolean().default(false),
    EXECUTIONS_DATA_MAX_AGE: z.coerce.number().default(336), // 14 days (in hours)
    EXECUTIONS_DATA_MAX_COUNT: z.coerce.number().default(50000),
});

const processEnv = envSchema.parse(process.env);

export const config = {
    env: processEnv.NODE_ENV,
    redis: {
        url: processEnv.REDIS_URL,
    },
    database: {
        url: processEnv.DATABASE_URL,
    },
    blobStorage: {
        type: processEnv.BLOB_STORAGE_TYPE,
        localPath: processEnv.BLOB_STORAGE_PATH,
        threshold: processEnv.BLOB_STORAGE_THRESHOLD,
    },
    pruning: {
        enabled: processEnv.EXECUTIONS_DATA_PRUNE,
        maxAgeHours: processEnv.EXECUTIONS_DATA_MAX_AGE,
        maxCount: processEnv.EXECUTIONS_DATA_MAX_COUNT,
    },
};
