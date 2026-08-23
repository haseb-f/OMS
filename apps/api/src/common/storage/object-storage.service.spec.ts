import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectStorageService } from './object-storage.service';

describe('ObjectStorageService', () => {
  let dir: string;
  let previous: string | undefined;
  let storage: ObjectStorageService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oms-attach-'));
    previous = process.env.OMS_ATTACHMENTS_DIR;
    process.env.OMS_ATTACHMENTS_DIR = dir;
    storage = new ObjectStorageService();
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env.OMS_ATTACHMENTS_DIR;
    else process.env.OMS_ATTACHMENTS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips bytes and deletes without leftover files', async () => {
    const key = 'store-order-receipts/order-1/file.pdf';
    await storage.put(key, Buffer.from('%PDF'));
    await expect(storage.get(key)).resolves.toEqual(Buffer.from('%PDF'));
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow();
  });

  it('ignores delete of a missing key', async () => {
    await expect(storage.delete('missing/key.bin')).resolves.toBeUndefined();
  });
});
