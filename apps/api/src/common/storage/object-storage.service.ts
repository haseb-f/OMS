import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export type ObjectStorageProvider = 'local' | 'supabase';

/**
 * Object store for payment/order receipts. Local filesystem is used for
 * tests and local-first development. Production serverless uses the
 * existing Supabase project as a private bucket — the API never returns
 * a raw public object URL.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly root: string;
  private readonly driver: ObjectStorageProvider;
  private readonly supabaseUrl: string | null;
  private readonly supabaseKey: string | null;
  private readonly bucket: string;
  private bucketReady: Promise<void> | null = null;

  constructor() {
    this.root = resolve(
      process.env.OMS_ATTACHMENTS_DIR ?? join(tmpdir(), 'oms-attachments'),
    );
    this.supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '') || null;
    this.supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      null;
    this.bucket = process.env.OMS_ATTACHMENTS_BUCKET ?? 'oms-attachments';
    const forced = process.env.OMS_ATTACHMENTS_DRIVER;
    if (forced === 'local' || process.env.OMS_ATTACHMENTS_DIR) {
      this.driver = 'local';
    } else if (
      forced === 'supabase' ||
      (process.env.NODE_ENV === 'production' &&
        this.supabaseUrl &&
        this.supabaseKey)
    ) {
      this.driver = 'supabase';
    } else {
      this.driver = 'local';
    }
  }

  provider(): ObjectStorageProvider {
    return this.driver;
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    if (this.driver === 'supabase') {
      await this.ensureBucket();
      const response = await fetch(this.objectUrl(key), {
        method: 'POST',
        headers: {
          ...this.supabaseHeaders(),
          'Content-Type': contentType ?? 'application/octet-stream',
          'x-upsert': 'false',
        },
        body: new Uint8Array(body),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.error(`Supabase put failed ${response.status} ${detail}`);
        throw new Error('تعذر رفع الإيصال، حاول مرة أخرى');
      }
      return;
    }
    const full = this.resolveKey(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    if (this.driver === 'supabase') {
      const response = await fetch(this.objectUrl(key), {
        headers: this.supabaseHeaders(),
      });
      if (!response.ok) {
        throw new Error('تعذر فتح الإيصال');
      }
      return Buffer.from(await response.arrayBuffer());
    }
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 'supabase') {
      const response = await fetch(this.objectUrl(key), {
        method: 'DELETE',
        headers: this.supabaseHeaders(),
      });
      if (!response.ok && response.status !== 404) {
        this.logger.warn(`Failed to delete ${key}: ${response.status}`);
      }
      return;
    }
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

  private supabaseHeaders(): Record<string, string> {
    if (!this.supabaseKey) {
      throw new Error('Supabase storage is not configured');
    }
    return {
      Authorization: `Bearer ${this.supabaseKey}`,
      apikey: this.supabaseKey,
    };
  }

  private objectUrl(key: string): string {
    const safe = this.normalizeKey(key);
    return `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${safe}`;
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return this.bucketReady;
    this.bucketReady = this.createBucketIfNeeded();
    try {
      await this.bucketReady;
    } catch (error) {
      this.bucketReady = null;
      throw error;
    }
  }

  private async createBucketIfNeeded(): Promise<void> {
    if (!this.supabaseUrl || !this.supabaseKey) {
      throw new Error('Supabase storage is not configured');
    }
    const list = await fetch(
      `${this.supabaseUrl}/storage/v1/bucket/${this.bucket}`,
      {
        headers: this.supabaseHeaders(),
      },
    );
    if (list.ok) return;
    const created = await fetch(`${this.supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        ...this.supabaseHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: this.bucket,
        name: this.bucket,
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/pdf',
        ],
      }),
    });
    if (!created.ok && created.status !== 409) {
      const detail = await created.text().catch(() => '');
      this.logger.error(
        `Failed to create storage bucket: ${created.status} ${detail}`,
      );
      throw new Error('تعذر رفع الإيصال، حاول مرة أخرى');
    }
  }

  private normalizeKey(key: string): string {
    const normalized = normalize(key)
      .replace(/^[/\\]+/, '')
      .replace(/\\/g, '/');
    if (normalized.split('/').includes('..')) {
      throw new Error('Invalid storage key');
    }
    return normalized;
  }

  private resolveKey(key: string): string {
    const normalized = normalize(key).replace(/^[/\\]+/, '');
    if (normalized.split(sep).includes('..')) {
      throw new Error('Invalid storage key');
    }
    return join(this.root, normalized);
  }
}
