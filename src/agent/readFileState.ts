import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../core/errors.js';

export interface FileStateSnapshot {
  path: string;
  realPath: string;
  size: number;
  mtimeMs: number;
  modifiedAt: string;
  sha256: string;
  capturedAt: string;
}

export type FileStateCache = Map<string, FileStateSnapshot>;

export function createFileStateCache(): FileStateCache {
  return new Map();
}

function cacheKey(filePath: string): string {
  return path.resolve(filePath);
}

function sha256Hex(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function getCachedState(cache: FileStateCache, filePath: string): Promise<FileStateSnapshot | undefined> {
  const direct = cache.get(cacheKey(filePath));
  if (direct) return direct;
  try {
    const realPath = await fs.realpath(filePath);
    return cache.get(cacheKey(realPath));
  } catch {
    return undefined;
  }
}

function remember(cache: FileStateCache, snapshot: FileStateSnapshot): FileStateSnapshot {
  cache.set(cacheKey(snapshot.path), snapshot);
  cache.set(cacheKey(snapshot.realPath), snapshot);
  return snapshot;
}

export async function captureFileState(filePath: string, content?: string | Buffer): Promise<FileStateSnapshot> {
  const absolutePath = path.resolve(filePath);
  const initialStat = await fs.stat(absolutePath);
  if (!initialStat.isFile()) throw new AppError('NOT_A_FILE', 'Path is not a file', 400, { path: absolutePath });

  const contentBuffer = content === undefined ? await fs.readFile(absolutePath) : Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const [stat, realPath] = await Promise.all([fs.stat(absolutePath), fs.realpath(absolutePath)]);
  if (!stat.isFile()) throw new AppError('NOT_A_FILE', 'Path is not a file', 400, { path: absolutePath });

  return {
    path: absolutePath,
    realPath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256Hex(contentBuffer),
    capturedAt: new Date().toISOString()
  };
}

export async function capture(cache: FileStateCache, filePath: string, content?: string | Buffer): Promise<FileStateSnapshot> {
  return remember(cache, await captureFileState(filePath, content));
}

export async function updateFromContent(cache: FileStateCache, filePath: string, content: string | Buffer): Promise<FileStateSnapshot> {
  return capture(cache, filePath, content);
}

export async function assertFresh(cache: FileStateCache, filePath: string): Promise<FileStateSnapshot> {
  const prior = await getCachedState(cache, filePath);
  const absolutePath = path.resolve(filePath);
  if (!prior) {
    throw new AppError('READ_REQUIRED_BEFORE_WRITE', 'Existing files must be fully read in this agent session before they can be changed.', 409, {
      path: absolutePath
    });
  }

  let current: FileStateSnapshot;
  try {
    current = await captureFileState(absolutePath);
  } catch (error) {
    throw new AppError('FILE_STALE_READ', 'The file changed or became unavailable after it was read.', 409, {
      path: absolutePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  const stale = prior.realPath !== current.realPath || prior.size !== current.size || prior.mtimeMs !== current.mtimeMs || prior.sha256 !== current.sha256;
  if (stale) {
    throw new AppError('FILE_STALE_READ', 'The file changed after it was read. Read it again before writing.', 409, {
      path: absolutePath,
      expected: {
        size: prior.size,
        modifiedAt: prior.modifiedAt,
        sha256: prior.sha256
      },
      current: {
        size: current.size,
        modifiedAt: current.modifiedAt,
        sha256: current.sha256
      }
    });
  }

  return current;
}
