import { type IBlobStorage, FileSystemBlobStorage } from '../utils/blob-storage';
import { config } from '../config';
import { logger } from '../utils/logger';

interface BlobReference {
    __type: 'blob_ref';
    key: string;
    originalSize: number;
}

export class PayloadManager {
    private storage: IBlobStorage;
    private threshold: number;

    constructor() {
        // Initialize storage based on config type
        if (config.blobStorage.type === 'filesystem') {
            this.storage = new FileSystemBlobStorage(config.blobStorage.localPath);
        } else {
            // Placeholder for S3 implementation
            // this.storage = new S3BlobStorage(...);
            throw new Error(`Blob storage type ${config.blobStorage.type} not yet implemented`);
        }
        this.threshold = config.blobStorage.threshold;
    }

    /**
     * Serializes data and uploads to blob storage if size exceeds threshold.
     */
    async serialize(data: any): Promise<any> {
        if (data === undefined || data === null) {
            return data;
        }

        try {
            const jsonString = JSON.stringify(data);
            const size = Buffer.byteLength(jsonString);

            if (size <= this.threshold) {
                return data; // Return as-is if small enough
            }

            // Upload to blob storage
            const key = `payload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
            await this.storage.upload(key, jsonString);

            logger.info({ key, size }, '📦 Large payload offloaded to blob storage');

            // Return reference
            const ref: BlobReference = {
                __type: 'blob_ref',
                key,
                originalSize: size
            };
            return ref;

        } catch (error) {
            logger.error({ error }, 'Failed to serialize/offload payload');
            // Fallback: return original data if offloading fails? 
            // Better to throw so we don't accidentally crash Redis with the large payload
            throw error;
        }
    }

    /**
     * Deserializes data, downloading from blob storage if it's a reference.
     */
    async deserialize(data: any): Promise<any> {
        if (this.isBlobReference(data)) {
            try {
                logger.info({ key: data.key }, '📦 Downloading large payload from blob storage');
                const buffer = await this.storage.download(data.key);
                return JSON.parse(buffer.toString());
            } catch (error) {
                logger.error({ error, key: data.key }, 'Failed to download/deserialize payload');
                throw error;
            }
        }
        return data; // Return as-is if not a blob reference
    }

    private isBlobReference(data: any): data is BlobReference {
        return (
            data &&
            typeof data === 'object' &&
            data.__type === 'blob_ref' &&
            typeof data.key === 'string'
        );
    }
}
