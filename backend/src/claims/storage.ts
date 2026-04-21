// File-upload helpers for claim evidence.
// MVP storage is the local filesystem (`backend/data/claims/<claim_id>/...`);
// an S3 adapter interface is declared here so production can swap without
// touching call sites.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import type { Request } from 'express';
import type { EvidenceRef } from './types.js';

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file
export const ALLOWED_MIMETYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'video/mp4',
  'application/pdf',
]);

export interface EvidenceStorage {
  /**
   * Persist raw bytes and return a reference. The URI is opaque to callers —
   * local-fs impl returns `file://...`; S3 impl returns `s3://bucket/key`.
   */
  save(claimId: string, filename: string, mimetype: string, bytes: Buffer):
    Promise<EvidenceRef>;
  /** Read a stored object back. Used by admin inspector downloads. */
  read(storageUri: string): Promise<Buffer>;
  /** Remove all evidence for a claim (GDPR erase). */
  deleteForClaim(claimId: string): Promise<void>;
}

export class ValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateUploadBatch(
  files: Array<{ filename: string; mimetype: string; sizeBytes: number }>,
): void {
  if (files.length > MAX_FILES) {
    throw new ValidationError(
      'too_many_files',
      `max ${MAX_FILES} files per claim (got ${files.length})`,
    );
  }
  for (const file of files) {
    if (file.sizeBytes > MAX_FILE_BYTES) {
      throw new ValidationError(
        'file_too_large',
        `${file.filename} is ${file.sizeBytes}B (max ${MAX_FILE_BYTES}B)`,
      );
    }
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      throw new ValidationError(
        'mimetype_not_allowed',
        `${file.filename} mimetype ${file.mimetype} not in allowlist`,
      );
    }
  }
}

// Local-filesystem adapter: `backend/data/claims/<claim_id>/<timestamp>-<name>`.
export function makeLocalFsStorage(baseDir: string): EvidenceStorage {
  const root = path.resolve(baseDir);

  async function ensureDir(dir: string): Promise<void> {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  return {
    async save(claimId, filename, mimetype, bytes) {
      validateUploadBatch([
        { filename, mimetype, sizeBytes: bytes.length },
      ]);
      const dir = path.join(root, claimId);
      await ensureDir(dir);
      const safeName = sanitiseFilename(filename);
      const stamped = `${Date.now()}-${crypto
        .randomBytes(4)
        .toString('hex')}-${safeName}`;
      const full = path.join(dir, stamped);
      await fs.promises.writeFile(full, bytes);
      return {
        filename: safeName,
        mimetype,
        sizeBytes: bytes.length,
        storageUri: `file://${full.replace(/\\/g, '/')}`,
        uploadedAt: Date.now(),
      };
    },
    async read(uri) {
      if (!uri.startsWith('file://')) {
        throw new Error(`unsupported storage uri: ${uri}`);
      }
      const p = uri.slice('file://'.length);
      return fs.promises.readFile(p);
    },
    async deleteForClaim(claimId) {
      const dir = path.join(root, claimId);
      if (fs.existsSync(dir)) {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function sanitiseFilename(name: string): string {
  const base = name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Collapse all runs of "." so ".." cannot traverse.
    .replace(/\.{2,}/g, '_');
  return base.slice(0, 120) || 'file';
}

// Multer config used by routes for multipart/form-data uploads.
export function makeMulterUpload(): multer.Multer {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      files: MAX_FILES,
      fileSize: MAX_FILE_BYTES,
    },
    fileFilter: (_req: Request, file, cb) => {
      if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
        cb(new ValidationError('mimetype_not_allowed', `mimetype ${file.mimetype} not in allowlist`));
        return;
      }
      cb(null, true);
    },
  });
}
