import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { executionPayloads } from '../db/schema';
import { logger } from '../utils/logger';

// Threshold for offloading to database (50KB)
const PAYLOAD_SIZE_THRESHOLD = 50 * 1024;

export interface PayloadReference {
    _payloadId: string;
    _size: number;
}

export class PayloadManager {
    constructor(private db: PostgresJsDatabase<any>) { }

    /**
     * Check if data exceeds threshold and save to DB if so.
     * Returns either the original data or a reference object.
     */
    async offloadIfNeeded(executionId: string, path: string, data: any): Promise<any> {
        if (!data) return data;

        // Fast check for likely small objects
        // const size = Buffer.byteLength(JSON.stringify(data)); // expensive for large objects?
        // Optimization: Rough estimate or use efficient sizing if possible. 
        // For now, JSON.stringify is safe enough for Node.js < 500MB

        let jsonString: string;
        try {
            jsonString = JSON.stringify(data);
        } catch (e) {
            logger.warn({ executionId, path, error: e }, 'Failed to stringify payload for size check');
            return data; // Return original if circular (shouldn't happen in workflows) or other error
        }

        const size = Buffer.byteLength(jsonString);

        if (size <= PAYLOAD_SIZE_THRESHOLD) {
            return data;
        }

        // Offload
        const id = crypto.randomUUID();

        try {
            await this.db.insert(executionPayloads).values({
                id,
                executionId,
                path,
                data: data, // Drizzle handles JSON stringification
                sizeBytes: size,
            });

            logger.info({ executionId, path, size, payloadId: id }, '📦 Offloaded large payload to database');

            return {
                _payloadId: id,
                _size: size
            } as PayloadReference;
        } catch (error) {
            logger.error({ executionId, path, error }, 'Failed to offload payload to database. Using inline data.');
            return data; // Fallback to inline (might crash Redis but better than data loss?)
        }
    }

    /**
     * Load data if it is a reference, otherwise return as is.
     */
    async loadIfNeeded(data: any): Promise<any> {
        if (this.isPayloadReference(data)) {
            const ref = data as PayloadReference;
            try {
                const result = await this.db.select().from(executionPayloads).where(eq(executionPayloads.id, ref._payloadId)).limit(1);
                if (result.length > 0) {
                    logger.debug({ payloadId: ref._payloadId }, '📦 Loaded large payload from database');
                    return result[0]?.data;
                } else {
                    logger.error({ payloadId: ref._payloadId }, '❌ Payload reference found but data missing in database');
                    return null; // or throw?
                }
            } catch (error) {
                logger.error({ payloadId: ref._payloadId, error }, '❌ Failed to load payload from database');
                throw error;
            }
        }
        return data;
    }

    isPayloadReference(data: any): boolean {
        return data && typeof data === 'object' && '_payloadId' in data && typeof data._payloadId === 'string';
    }
}
