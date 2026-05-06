import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import type { AllowedRoot, AppConfig } from '../config/env.js';
import { AppError } from '../core/errors.js';

export type ResolveMode = 'read' | 'write' | 'mkdir';

export interface ResolvedPath {
  input: string;
  root: AllowedRoot;
  absolutePath: string;
  relativePath: string;
  relativePathPosix: string;
  realPath?: string;
  existed: boolean;
}

function canonicalForCompare(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(canonicalForCompare(parent), canonicalForCompare(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

function firstExistingParent(candidate: string): string {
  let current = candidate;
  while (!fsSync.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function chooseRoot(candidate: string, config: AppConfig): AllowedRoot | undefined {
  return config.allowedRoots.find((root) => isPathInside(root.path, candidate));
}

export function isBlockedByPattern(relativePathPosix: string, config: AppConfig, extraPatterns: string[] = []): string | null {
  const patterns = [...config.defaultExcludePatterns, ...config.extraExcludePatterns, ...extraPatterns].filter(Boolean);
  const normalizedRel = relativePathPosix.replace(/^\.\//, '');
  const basename = path.posix.basename(normalizedRel);

  for (const rawPattern of patterns) {
    const pattern = normalizePattern(rawPattern);
    const matchOptions = { dot: true, nocase: process.platform === 'win32' };
    if (minimatch(normalizedRel, pattern, matchOptions) || minimatch(`/${normalizedRel}`, pattern, matchOptions)) {
      return rawPattern;
    }
    if (!pattern.includes('/') && minimatch(basename, pattern, matchOptions)) {
      return rawPattern;
    }
  }
  return null;
}

export function isBlockedExtension(filePath: string, config: AppConfig): string | null {
  const lower = filePath.toLowerCase();
  const ext = path.extname(lower);
  if (ext && config.blockedExtensions.includes(ext)) return ext;
  return null;
}

export function assertNotBlocked(resolved: Pick<ResolvedPath, 'absolutePath' | 'relativePathPosix'>, config: AppConfig, extraPatterns: string[] = []): void {
  const pattern = isBlockedByPattern(resolved.relativePathPosix, config, extraPatterns);
  if (pattern) {
    throw new AppError('PATH_BLOCKED', `Path is blocked by safety pattern: ${pattern}`, 403, {
      path: resolved.relativePathPosix,
      pattern
    });
  }
  const ext = isBlockedExtension(resolved.absolutePath, config);
  if (ext) {
    throw new AppError('PATH_BLOCKED', `Path is blocked by extension: ${ext}`, 403, {
      path: resolved.relativePathPosix,
      extension: ext
    });
  }
}

export async function resolveAllowedPath(inputPath: string, config: AppConfig, mode: ResolveMode, extraExcludePatterns: string[] = []): Promise<ResolvedPath> {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new AppError('INVALID_INPUT', 'path is required', 400);
  }

  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : config.allowRelativePaths
      ? path.resolve(config.allowedRoots[0]!.path, inputPath)
      : (() => {
          throw new AppError('INVALID_INPUT', 'Relative paths are disabled by ALLOW_RELATIVE_PATHS=0', 400);
        })();

  const root = chooseRoot(candidate, config);
  if (!root) {
    throw new AppError('PATH_OUTSIDE_ROOTS', 'Path is outside every configured ROOTS directory', 403, {
      path: candidate,
      roots: config.allowedRoots.map((r) => r.path)
    });
  }

  const relativePath = path.relative(root.path, candidate) || '.';
  const relativePathPosix = toPosix(relativePath);
  const resolved: ResolvedPath = {
    input: inputPath,
    root,
    absolutePath: candidate,
    relativePath,
    relativePathPosix,
    existed: fsSync.existsSync(candidate)
  };

  assertNotBlocked(resolved, config, extraExcludePatterns);

  if (mode === 'read') {
    let realPath: string;
    try {
      realPath = await fs.realpath(candidate);
    } catch {
      throw new AppError('PATH_NOT_FOUND', 'Path does not exist', 404, { path: relativePathPosix });
    }
    if (!isPathInside(root.realPath, realPath)) {
      throw new AppError('PATH_OUTSIDE_ROOTS', 'Path resolves outside its allowed root, likely through a symlink', 403, {
        path: relativePathPosix,
        realPath
      });
    }
    return { ...resolved, realPath, existed: true };
  }

  const existingTarget = fsSync.existsSync(candidate);
  if (existingTarget) {
    const realPath = await fs.realpath(candidate);
    if (!isPathInside(root.realPath, realPath)) {
      throw new AppError('PATH_OUTSIDE_ROOTS', 'Path resolves outside its allowed root, likely through a symlink', 403, {
        path: relativePathPosix,
        realPath
      });
    }
    return { ...resolved, realPath, existed: true };
  }

  const parent = firstExistingParent(path.dirname(candidate));
  const parentReal = await fs.realpath(parent);
  if (!isPathInside(root.realPath, parentReal)) {
    throw new AppError('PATH_OUTSIDE_ROOTS', 'Parent directory resolves outside its allowed root, likely through a symlink', 403, {
      path: relativePathPosix,
      parentReal
    });
  }

  return { ...resolved, existed: false };
}

export function shouldSkipDirectoryEntry(relativePathPosix: string, absolutePath: string, config: AppConfig, extraPatterns: string[] = []): { skip: boolean; reason?: string } {
  const pattern = isBlockedByPattern(relativePathPosix, config, extraPatterns);
  if (pattern) return { skip: true, reason: `pattern:${pattern}` };
  const ext = isBlockedExtension(absolutePath, config);
  if (ext) return { skip: true, reason: `extension:${ext}` };
  return { skip: false };
}
