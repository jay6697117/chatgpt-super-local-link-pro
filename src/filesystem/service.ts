import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import type { AppConfig } from '../config/env.js';
import { publicConfigSummary } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { assertNotBlocked, resolveAllowedPath, shouldSkipDirectoryEntry } from '../security/pathGuards.js';
import type { DirectoryTreeOptions, ProjectOverviewOptions, ReadFileOptions, ReadManyOptions, SearchOptions } from './types.js';

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function clamp(n: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n!)));
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

function detectBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return true;
    const isAllowedControl = b === 9 || b === 10 || b === 13;
    if (b < 32 && !isAllowedControl) suspicious += 1;
  }
  return sample.length > 32 && suspicious / sample.length > 0.25;
}

async function assertFile(absPath: string): Promise<fsSync.Stats> {
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) throw new AppError('NOT_A_FILE', 'Path is not a file', 400);
  return stat;
}

async function assertDirectory(absPath: string): Promise<fsSync.Stats> {
  const stat = await fs.stat(absPath);
  if (!stat.isDirectory()) throw new AppError('NOT_A_DIRECTORY', 'Path is not a directory', 400);
  return stat;
}

function toolOk<T extends Record<string, unknown>>(data: T): T & { ok: true } {
  return { ok: true, ...data };
}

export function summarizeServer(config: AppConfig) {
  return publicConfigSummary(config);
}

export async function fileStat(inputPath: string, config: AppConfig) {
  const resolved = await resolveAllowedPath(inputPath, config, 'read');
  const stat = await fs.lstat(resolved.absolutePath);
  return toolOk({
    path: resolved.absolutePath,
    rootId: resolved.root.id,
    relativePath: resolved.relativePathPosix,
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other',
    size: stat.size,
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    accessedAt: stat.atime.toISOString(),
    readonly: !config.allowWrite
  });
}

export async function directoryTree(inputPath: string, config: AppConfig, options: DirectoryTreeOptions = {}) {
  const maxDepth = clamp(options.depth, config.defaultTreeDepth, 0, config.maxTreeDepth);
  const maxEntries = clamp(options.maxEntries, config.maxTreeEntries, 1, config.maxTreeEntries);
  const extra = options.excludePatterns ?? [];
  const resolved = await resolveAllowedPath(inputPath, config, 'read', extra);
  await assertDirectory(resolved.absolutePath);

  let count = 0;
  let truncated = false;
  const skipped: Array<{ path: string; reason: string }> = [];

  async function walk(absDir: string, relDir: string, currentDepth: number): Promise<unknown[]> {
    if (count >= maxEntries) {
      truncated = true;
      return [];
    }
    const dirents = await fs.readdir(absDir, { withFileTypes: true });
    dirents.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const children: unknown[] = [];
    for (const dirent of dirents) {
      if (count >= maxEntries) {
        truncated = true;
        break;
      }
      const childAbs = path.join(absDir, dirent.name);
      const childRel = relDir === '.' ? dirent.name : `${relDir}/${dirent.name}`;
      const skip = shouldSkipDirectoryEntry(childRel, childAbs, config, extra);
      if (skip.skip) {
        skipped.push({ path: childRel, reason: skip.reason ?? 'blocked' });
        continue;
      }

      const type = dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : dirent.isSymbolicLink() ? 'symlink' : 'other';
      const item: Record<string, unknown> = { name: dirent.name, type, path: childRel };
      count += 1;

      if (type === 'file') {
        try {
          const stat = await fs.stat(childAbs);
          item.size = stat.size;
        } catch {
          item.size = null;
        }
      }

      if (type === 'directory' && currentDepth < maxDepth) {
        item.children = await walk(childAbs, childRel, currentDepth + 1);
      }

      children.push(item);
    }
    return children;
  }

  const children = await walk(resolved.absolutePath, '.', 0);
  return toolOk({
    rootId: resolved.root.id,
    path: resolved.absolutePath,
    relativePath: resolved.relativePathPosix,
    depth: maxDepth,
    entriesReturned: count,
    truncated,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 80),
    tree: { name: path.basename(resolved.absolutePath), type: 'directory', path: resolved.relativePathPosix, children }
  });
}

export async function readTextFile(inputPath: string, config: AppConfig, options: ReadFileOptions = {}) {
  const maxBytes = clamp(options.maxBytes, config.maxReadBytes, 1, config.maxReadBytes);
  const resolved = await resolveAllowedPath(inputPath, config, 'read');
  const stat = await assertFile(resolved.absolutePath);

  if (stat.size > maxBytes) {
    const handle = await fs.open(resolved.absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      const chunk = buffer.subarray(0, bytesRead);
      if (detectBinary(chunk)) throw new AppError('BINARY_FILE', 'Refusing to read binary-looking file', 415);
      return toolOk({
        path: resolved.absolutePath,
        rootId: resolved.root.id,
        relativePath: resolved.relativePathPosix,
        size: stat.size,
        truncated: true,
        maxBytes,
        content: chunk.toString('utf8')
      });
    } finally {
      await handle.close();
    }
  }

  const buffer = await fs.readFile(resolved.absolutePath);
  if (detectBinary(buffer)) throw new AppError('BINARY_FILE', 'Refusing to read binary-looking file', 415);
  return toolOk({
    path: resolved.absolutePath,
    rootId: resolved.root.id,
    relativePath: resolved.relativePathPosix,
    size: stat.size,
    truncated: false,
    content: buffer.toString('utf8')
  });
}

export async function readManyTextFiles(inputPaths: string[], config: AppConfig, options: ReadManyOptions = {}) {
  if (inputPaths.length > config.maxReadManyFiles) {
    throw new AppError('READ_LIMIT_EXCEEDED', `Too many files. Maximum is ${config.maxReadManyFiles}.`, 400);
  }
  const maxBytesPerFile = clamp(options.maxBytesPerFile, config.maxReadBytes, 1, config.maxReadBytes);
  const maxTotalBytes = clamp(options.maxTotalBytes, config.maxReadManyTotalBytes, 1, config.maxReadManyTotalBytes);
  const files: unknown[] = [];
  let totalBytes = 0;
  let truncatedByTotal = false;

  for (const inputPath of inputPaths) {
    if (totalBytes >= maxTotalBytes) {
      truncatedByTotal = true;
      break;
    }
    const remaining = Math.max(1, maxTotalBytes - totalBytes);
    const result = await readTextFile(inputPath, config, { maxBytes: Math.min(maxBytesPerFile, remaining) });
    const content = typeof result.content === 'string' ? result.content : '';
    totalBytes += byteLength(content);
    files.push(result);
  }

  return toolOk({ files, totalBytes, truncatedByTotal, maxTotalBytes });
}

function createSearchMatcher(query: string, options: SearchOptions): (line: string) => Array<{ index: number; text: string }> {
  const mode = options.mode ?? 'literal';
  const caseSensitive = options.caseSensitive ?? false;
  if (mode === 'regex') {
    let regex: RegExp;
    try {
      regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch (error) {
      throw new AppError('INVALID_INPUT', `Invalid regex: ${error instanceof Error ? error.message : String(error)}`, 400);
    }
    return (line: string) => {
      const matches: Array<{ index: number; text: string }> = [];
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line))) {
        matches.push({ index: match.index, text: match[0] });
        if (match[0].length === 0) regex.lastIndex += 1;
      }
      return matches;
    };
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  return (line: string) => {
    const haystack = caseSensitive ? line : line.toLowerCase();
    const matches: Array<{ index: number; text: string }> = [];
    let start = 0;
    while (true) {
      const index = haystack.indexOf(needle, start);
      if (index < 0) break;
      matches.push({ index, text: line.slice(index, index + query.length) });
      start = index + Math.max(1, query.length);
    }
    return matches;
  };
}

export async function searchFiles(inputPath: string, query: string, config: AppConfig, options: SearchOptions = {}) {
  const resolved = await resolveAllowedPath(inputPath, config, 'read', options.excludePatterns ?? []);
  await assertDirectory(resolved.absolutePath);

  const maxFiles = clamp(options.maxFiles, config.maxSearchFiles, 1, config.maxSearchFiles);
  const maxResults = clamp(options.maxResults, config.maxSearchResults, 1, config.maxSearchResults);
  const includeGlob = options.includeGlob?.replace(/\\/g, '/');
  const matcher = createSearchMatcher(query, options);
  const results: unknown[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let filesScanned = 0;
  let filesMatched = 0;
  let truncated = false;

  async function walk(absDir: string, relDir: string): Promise<void> {
    if (filesScanned >= maxFiles || results.length >= maxResults) {
      truncated = true;
      return;
    }
    const dirents = await fs.readdir(absDir, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirents) {
      if (filesScanned >= maxFiles || results.length >= maxResults) {
        truncated = true;
        break;
      }
      const childAbs = path.join(absDir, dirent.name);
      const childRel = relDir === '.' ? dirent.name : `${relDir}/${dirent.name}`;
      const skip = shouldSkipDirectoryEntry(childRel, childAbs, config, options.excludePatterns ?? []);
      if (skip.skip) {
        skipped.push({ path: childRel, reason: skip.reason ?? 'blocked' });
        continue;
      }

      if (dirent.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (!dirent.isFile()) continue;
      if (includeGlob && !minimatch(childRel, includeGlob, { dot: true, nocase: process.platform === 'win32' })) continue;

      let stat: fsSync.Stats;
      try {
        stat = await fs.stat(childAbs);
      } catch {
        skipped.push({ path: childRel, reason: 'stat_failed' });
        continue;
      }
      if (stat.size > config.maxSearchFileBytes) {
        skipped.push({ path: childRel, reason: `too_large:${stat.size}` });
        continue;
      }
      filesScanned += 1;
      const buffer = await fs.readFile(childAbs);
      if (detectBinary(buffer)) {
        skipped.push({ path: childRel, reason: 'binary' });
        continue;
      }

      const content = buffer.toString('utf8');
      const lines = content.split(/\r?\n/);
      let matchedThisFile = false;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        const matches = matcher(line);
        if (!matches.length) continue;
        matchedThisFile = true;
        for (const match of matches) {
          const start = Math.max(0, match.index - 60);
          const end = Math.min(line.length, match.index + match.text.length + 160);
          let preview = line.slice(start, end);
          if (preview.length > config.maxSearchResultLineChars) preview = `${preview.slice(0, config.maxSearchResultLineChars)}…`;
          results.push({
            path: childRel,
            absolutePath: childAbs,
            line: i + 1,
            column: match.index + 1,
            preview
          });
          if (results.length >= maxResults) {
            truncated = true;
            break;
          }
        }
        if (results.length >= maxResults) break;
      }
      if (matchedThisFile) filesMatched += 1;
    }
  }

  await walk(resolved.absolutePath, '.');
  return toolOk({
    path: resolved.absolutePath,
    relativePath: resolved.relativePathPosix,
    query,
    mode: options.mode ?? 'literal',
    includeGlob: includeGlob ?? null,
    filesScanned,
    filesMatched,
    resultCount: results.length,
    truncated,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 60),
    results
  });
}

function assertWriteEnabled(config: AppConfig): void {
  if (!config.allowWrite) {
    throw new AppError('WRITE_DISABLED', 'Write tools are disabled. Set ALLOW_WRITE=1 in .env and restart.', 403);
  }
}

function assertOverwriteEnabled(config: AppConfig): void {
  if (!config.allowOverwrite) {
    throw new AppError('OVERWRITE_DISABLED', 'Existing file modification requires ALLOW_OVERWRITE=1 in .env and restart.', 403);
  }
}

async function backupFile(filePath: string, resolvedRootPath: string, config: AppConfig): Promise<string | null> {
  if (!config.backupBeforeOverwrite) return null;
  const rel = path.relative(resolvedRootPath, filePath);
  const backupAbs = path.join(resolvedRootPath, config.backupDir, `${rel}.backup-${nowStamp()}`);
  await fs.mkdir(path.dirname(backupAbs), { recursive: true });
  await fs.copyFile(filePath, backupAbs);
  return backupAbs;
}

export async function createDirectory(inputPath: string, config: AppConfig) {
  assertWriteEnabled(config);
  const resolved = await resolveAllowedPath(inputPath, config, 'mkdir');
  if (config.dryRunWrite) {
    return toolOk({ dryRun: true, action: 'create_directory', path: resolved.absolutePath, relativePath: resolved.relativePathPosix });
  }
  await fs.mkdir(resolved.absolutePath, { recursive: true });
  return toolOk({ dryRun: false, action: 'create_directory', path: resolved.absolutePath, relativePath: resolved.relativePathPosix });
}

export async function writeTextFile(inputPath: string, content: string, overwrite: boolean, config: AppConfig) {
  assertWriteEnabled(config);
  const size = byteLength(content);
  if (size > config.maxWriteBytes) {
    throw new AppError('WRITE_LIMIT_EXCEEDED', `Content is too large. Maximum is ${config.maxWriteBytes} bytes.`, 400, { size });
  }
  const resolved = await resolveAllowedPath(inputPath, config, 'write');
  const exists = fsSync.existsSync(resolved.absolutePath);
  if (exists && !overwrite) {
    throw new AppError('OVERWRITE_DISABLED', 'File already exists. Pass overwrite=true only after the user explicitly asks to replace it.', 409);
  }
  if (exists) assertOverwriteEnabled(config);

  const backupPath = exists && !config.dryRunWrite ? await backupFile(resolved.absolutePath, resolved.root.path, config) : null;
  if (!config.dryRunWrite) {
    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.writeFile(resolved.absolutePath, content, 'utf8');
  }

  return toolOk({
    dryRun: config.dryRunWrite,
    action: exists ? 'overwrite_file' : 'create_file',
    path: resolved.absolutePath,
    relativePath: resolved.relativePathPosix,
    bytes: size,
    backupPath
  });
}

export async function appendTextFile(inputPath: string, content: string, createIfMissing: boolean, config: AppConfig) {
  assertWriteEnabled(config);
  const size = byteLength(content);
  if (size > config.maxWriteBytes) {
    throw new AppError('WRITE_LIMIT_EXCEEDED', `Append content is too large. Maximum is ${config.maxWriteBytes} bytes.`, 400, { size });
  }
  const resolved = await resolveAllowedPath(inputPath, config, 'write');
  const exists = fsSync.existsSync(resolved.absolutePath);
  if (!exists && !createIfMissing) {
    throw new AppError('PATH_NOT_FOUND', 'File does not exist. Pass createIfMissing=true to create it.', 404);
  }
  if (exists) assertOverwriteEnabled(config);

  const backupPath = exists && !config.dryRunWrite ? await backupFile(resolved.absolutePath, resolved.root.path, config) : null;
  if (!config.dryRunWrite) {
    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.appendFile(resolved.absolutePath, content, 'utf8');
  }
  return toolOk({
    dryRun: config.dryRunWrite,
    action: exists ? 'append_file' : 'create_file',
    path: resolved.absolutePath,
    relativePath: resolved.relativePathPosix,
    appendedBytes: size,
    backupPath
  });
}

export async function replaceInTextFile(inputPath: string, oldText: string, newText: string, replaceAll: boolean, config: AppConfig) {
  assertWriteEnabled(config);
  assertOverwriteEnabled(config);
  if (!oldText) throw new AppError('INVALID_INPUT', 'oldText cannot be empty', 400);
  const resolved = await resolveAllowedPath(inputPath, config, 'read');
  const stat = await assertFile(resolved.absolutePath);
  if (stat.size > config.maxReadBytes) {
    throw new AppError('READ_LIMIT_EXCEEDED', `File is too large for targeted replacement. Maximum read size is ${config.maxReadBytes}.`, 400);
  }
  const buffer = await fs.readFile(resolved.absolutePath);
  if (detectBinary(buffer)) throw new AppError('BINARY_FILE', 'Refusing to edit binary-looking file', 415);
  const original = buffer.toString('utf8');
  const occurrences = original.split(oldText).length - 1;
  if (occurrences === 0) throw new AppError('REPLACE_TEXT_NOT_FOUND', 'oldText was not found in the file', 404);
  const replaceCount = replaceAll ? occurrences : 1;
  if (replaceCount > config.maxReplaceOccurrences) {
    throw new AppError('TOO_MANY_REPLACEMENTS', `Replacement would touch ${replaceCount} occurrences; max is ${config.maxReplaceOccurrences}.`, 400);
  }
  const next = replaceAll ? original.split(oldText).join(newText) : original.replace(oldText, newText);
  const size = byteLength(next);
  if (size > config.maxWriteBytes) {
    throw new AppError('WRITE_LIMIT_EXCEEDED', `Edited file would be too large. Maximum is ${config.maxWriteBytes} bytes.`, 400, { size });
  }
  const backupPath = !config.dryRunWrite ? await backupFile(resolved.absolutePath, resolved.root.path, config) : null;
  if (!config.dryRunWrite) await fs.writeFile(resolved.absolutePath, next, 'utf8');

  return toolOk({
    dryRun: config.dryRunWrite,
    action: 'replace_in_file',
    path: resolved.absolutePath,
    relativePath: resolved.relativePathPosix,
    occurrencesFound: occurrences,
    occurrencesReplaced: replaceCount,
    bytesBefore: byteLength(original),
    bytesAfter: size,
    backupPath
  });
}

const keyFileNames = new Set([
  'AGENTS.md',
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'package-lock.json',
  'vite.config.ts',
  'vite.config.js',
  'vue.config.js',
  'nuxt.config.ts',
  'tsconfig.json',
  'src/main.ts',
  'src/main.js',
  'src/App.vue',
  'src/router/index.ts',
  'src/store/index.ts',
  'docs/README.md'
]);

function technologyHints(paths: string[]): string[] {
  const hints = new Set<string>();
  for (const p of paths) {
    if (p.endsWith('package.json')) hints.add('Node.js package');
    if (p.endsWith('.vue')) hints.add('Vue');
    if (p.includes('vite.config')) hints.add('Vite');
    if (p.includes('nuxt.config')) hints.add('Nuxt');
    if (p.endsWith('.ts') || p.endsWith('tsconfig.json')) hints.add('TypeScript');
    if (p.includes('ant-design') || p.includes('antdv')) hints.add('Ant Design Vue possible');
  }
  return [...hints];
}

export async function projectOverview(inputPath: string, config: AppConfig, options: ProjectOverviewOptions = {}) {
  const depth = clamp(options.depth, 4, 1, config.maxTreeDepth);
  const maxFiles = clamp(options.maxFiles, config.maxProjectOverviewFiles, 1, config.maxProjectOverviewFiles);
  const includePatterns = options.includePatterns ?? [];
  const resolved = await resolveAllowedPath(inputPath, config, 'read', includePatterns);
  await assertDirectory(resolved.absolutePath);

  const discovered: string[] = [];
  const keyFiles: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  async function walk(absDir: string, relDir: string, currentDepth: number): Promise<void> {
    if (discovered.length >= maxFiles || currentDepth > depth) return;
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (discovered.length >= maxFiles) break;
      const abs = path.join(absDir, entry.name);
      const rel = relDir === '.' ? entry.name : `${relDir}/${entry.name}`;
      const skip = shouldSkipDirectoryEntry(rel, abs, config, includePatterns);
      if (skip.skip) {
        skipped.push({ path: rel, reason: skip.reason ?? 'blocked' });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs, rel, currentDepth + 1);
      } else if (entry.isFile()) {
        discovered.push(rel);
        if (keyFileNames.has(rel) || keyFileNames.has(entry.name)) keyFiles.push(rel);
      }
    }
  }

  await walk(resolved.absolutePath, '.', 0);

  let packageJson: unknown = null;
  const packagePath = path.join(resolved.absolutePath, 'package.json');
  if (fsSync.existsSync(packagePath)) {
    const packageResolved = { absolutePath: packagePath, relativePathPosix: 'package.json' };
    assertNotBlocked(packageResolved, config);
    try {
      packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    } catch {
      packageJson = 'package.json exists but could not be parsed';
    }
  }

  const recommendedNextReads = Array.from(new Set(['AGENTS.md', 'README.md', 'package.json', ...keyFiles])).filter((p) =>
    fsSync.existsSync(path.join(resolved.absolutePath, p))
  );

  return toolOk({
    path: resolved.absolutePath,
    relativePath: resolved.relativePathPosix,
    depth,
    filesSampled: discovered.length,
    truncated: discovered.length >= maxFiles,
    technologyHints: technologyHints(discovered),
    keyFiles,
    recommendedNextReads,
    packageJson,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 60)
  });
}
