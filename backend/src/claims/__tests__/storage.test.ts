import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  ValidationError,
  makeLocalFsStorage,
  validateUploadBatch,
} from '../storage.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claims-storage-'));
}

describe('claims/storage', () => {
  describe('validateUploadBatch', () => {
    it('rejects when file count exceeds MAX_FILES', () => {
      const batch = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({
        filename: `f${i}.jpg`,
        mimetype: 'image/jpeg',
        sizeBytes: 100,
      }));
      assert.throws(() => validateUploadBatch(batch), (err: Error) => {
        return err instanceof ValidationError && err.code === 'too_many_files';
      });
    });
    it('rejects when file size exceeds limit', () => {
      assert.throws(
        () =>
          validateUploadBatch([
            {
              filename: 'big.mp4',
              mimetype: 'video/mp4',
              sizeBytes: MAX_FILE_BYTES + 1,
            },
          ]),
        (err: Error) => err instanceof ValidationError && err.code === 'file_too_large',
      );
    });
    it('rejects when mimetype is not allowlisted', () => {
      assert.throws(
        () =>
          validateUploadBatch([
            {
              filename: 'nope.exe',
              mimetype: 'application/octet-stream',
              sizeBytes: 100,
            },
          ]),
        (err: Error) =>
          err instanceof ValidationError && err.code === 'mimetype_not_allowed',
      );
    });
    it('accepts a valid batch', () => {
      validateUploadBatch([
        {
          filename: 'ok.png',
          mimetype: 'image/png',
          sizeBytes: 1024,
        },
      ]);
    });
  });

  describe('makeLocalFsStorage', () => {
    it('saves and reads back a file', async () => {
      const dir = tmpDir();
      const storage = makeLocalFsStorage(dir);
      const bytes = Buffer.from('hello world', 'utf8');
      const ref = await storage.save('clm_test', 'evidence.png', 'image/png', bytes);
      assert.equal(ref.sizeBytes, bytes.length);
      assert.ok(ref.storageUri.startsWith('file://'));
      const readBack = await storage.read(ref.storageUri);
      assert.deepEqual(readBack, bytes);
    });
    it('sanitises filename', async () => {
      const dir = tmpDir();
      const storage = makeLocalFsStorage(dir);
      const ref = await storage.save('clm_test', '../../etc/passwd', 'image/png', Buffer.from(''));
      assert.ok(!ref.filename.includes('..'));
      assert.ok(!ref.filename.includes('/'));
    });
    it('enforces mimetype allowlist at write time', async () => {
      const dir = tmpDir();
      const storage = makeLocalFsStorage(dir);
      await assert.rejects(
        () => storage.save('clm_test', 'nope.exe', 'application/octet-stream', Buffer.from('x')),
        (err: Error) =>
          err instanceof ValidationError && err.code === 'mimetype_not_allowed',
      );
    });
    it('deletes all evidence for a claim', async () => {
      const dir = tmpDir();
      const storage = makeLocalFsStorage(dir);
      const ref = await storage.save('clm_erase', 'a.png', 'image/png', Buffer.from('a'));
      await storage.deleteForClaim('clm_erase');
      const p = ref.storageUri.slice('file://'.length);
      assert.equal(fs.existsSync(p), false);
    });
  });
});
