import fs from 'node:fs/promises';
import path from 'node:path';
import { newId } from '../lib/crypto';

/**
 * Binary object storage for receipt attachments. The local-disk driver is suitable for a single
 * server; a cloud deployment should implement this interface with S3/GCS (see docs/ARCHITECTURE.md).
 * Keys are random — user-supplied filenames never touch the filesystem.
 */
export interface StorageService {
  put(data: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}$/;

export function createDiskStorage(root: string): StorageService {
  const resolve = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
    return path.join(root, key.slice(0, 2), key);
  };
  return {
    async put(data) {
      const key = newId();
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data, { flag: 'wx' });
      return key;
    },
    get: (key) => fs.readFile(resolve(key)),
    async remove(key) {
      await fs.rm(resolve(key), { force: true });
    },
  };
}

export function createMemoryStorage(): StorageService {
  const m = new Map<string, Buffer>();
  return {
    async put(data) {
      const key = newId();
      m.set(key, data);
      return key;
    },
    async get(key) {
      const v = m.get(key);
      if (!v) throw new Error('not found');
      return v;
    },
    async remove(key) {
      m.delete(key);
    },
  };
}
