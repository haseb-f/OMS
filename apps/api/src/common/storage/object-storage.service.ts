import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Local filesystem object store. Tests and local/dev write under
 * `OMS_ATTACHMENTS_DIR` (or the OS temp dir). Production serverless hosts
 * should point this at a persistent volume; the API never returns the
 * raw storage path to the browser.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly root: string;

  constructor() {
    this.root = resolve(
      process.env.OMS_ATTACHMENTS_DIR ?? join(tmpdir(), 'oms-attachments'),
    );
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolveKey(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(`Failed to delete ${key}: ${String(error)}`);
        throw error;
      }
    }
  }

  private resolveKey(key: string): string {
    const normalized = normalize(key).replace(/^[/\\]+/, '');
    if (normalized.split(sep).includes('..')) {
      throw new Error('Invalid storage key');
    }
    return join(this.root, normalized);
  }
}
