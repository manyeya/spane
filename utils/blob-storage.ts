import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger';

export interface IBlobStorage {
    upload(key: string, data: Buffer | string): Promise<string>;
    download(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
}

export class FileSystemBlobStorage implements IBlobStorage {
    private storagePath: string;

    constructor(storagePath: string) {
        this.storagePath = path.resolve(storagePath);
        this.ensureStorageDir();
    }

    private async ensureStorageDir() {
        try {
            await fs.mkdir(this.storagePath, { recursive: true });
        } catch (error) {
            logger.error({ error, path: this.storagePath }, 'Failed to create blob storage directory');
            throw error;
        }
    }

    async upload(key: string, data: Buffer | string): Promise<string> {
        const filePath = path.join(this.storagePath, key);
        try {
            await fs.writeFile(filePath, data);
            logger.debug({ key, size: data.length }, 'Blob uploaded to file system');
            return key;
        } catch (error) {
            logger.error({ error, key }, 'Failed to upload blob');
            throw error;
        }
    }

    async download(key: string): Promise<Buffer> {
        const filePath = path.join(this.storagePath, key);
        try {
            const data = await fs.readFile(filePath);
            return data;
        } catch (error) {
            logger.error({ error, key }, 'Failed to download blob');
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        const filePath = path.join(this.storagePath, key);
        try {
            await fs.unlink(filePath);
            logger.debug({ key }, 'Blob deleted from file system');
        } catch (error) {
            // Ignore if file doesn't exist
            if ((error as any).code !== 'ENOENT') {
                logger.error({ error, key }, 'Failed to delete blob');
                throw error;
            }
        }
    }
}
