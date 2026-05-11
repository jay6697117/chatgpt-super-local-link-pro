import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AppConfig } from '../src/config/env.js';
import { resolveAllowedPath } from '../src/security/pathGuards.js';
import { createDirectory, readTextFile, writeTextFile } from '../src/filesystem/service.js';

function makeConfig(root: string): AppConfig {
  const realPath = fs.realpathSync.native(root);
  return {
    nodeEnv: 'test',
    appName: 'test',
    port: 2091,
    host: '127.0.0.1',
    trustProxy: true,
    logLevel: 'error',
    logDir: path.join(root, 'logs'),
    mcpPath: '/mcp',
    enableLegacySse: false,
    ssePath: '/sse',
    sseMessagesPath: '/messages',
    mcpStatefulSessions: false,
    mcpEnableJsonResponse: true,
    authMode: 'no-auth',
    authToken: '',
    corsAllowedOrigins: ['*'],
    rateLimitWindowMs: 0,
    rateLimitMax: 0,
    allowedRoots: [{ id: 'root-1', input: root, path: root, realPath }],
    allowRelativePaths: true,
    maxReadBytes: 64 * 1024,
    maxReadManyFiles: 10,
    maxReadManyTotalBytes: 128 * 1024,
    maxSearchFileBytes: 64 * 1024,
    maxSearchFiles: 100,
    maxSearchResults: 100,
    maxSearchResultLineChars: 260,
    defaultTreeDepth: 3,
    maxTreeDepth: 8,
    maxTreeEntries: 100,
    maxProjectOverviewFiles: 50,
    allowWrite: false,
    allowOverwrite: false,
    dryRunWrite: false,
    backupBeforeOverwrite: true,
    backupDir: '.backups',
    maxWriteBytes: 64 * 1024,
    maxReplaceOccurrences: 10,
    defaultExcludePatterns: ['**/.env', '**/.env.*', '**/node_modules/**', '**/.git/**', '**/*secret*'],
    extraExcludePatterns: [],
    blockedExtensions: ['.pem', '.key'],
    enableDebugEndpoints: false,
    localAgent: {
      enabled: false,
      modelBaseUrl: 'https://api.openai.com/v1',
      modelApiKey: '',
      modelName: 'gpt-4.1',
      maxTurns: 8,
      maxToolCalls: 30,
      maxOutputBytes: 65536,
      sessionTtlMs: 1800000,
      maxSessionCount: 20
    },
    agentBash: {
      enabled: false,
      allowlist: [],
      timeoutMs: 120000,
      maxOutputBytes: 65536,
      inheritEnv: false
    }
  };
}

test('resolveAllowedPath allows files under root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sll-'));
  fs.writeFileSync(path.join(root, 'README.md'), 'hello');
  const config = makeConfig(root);
  const resolved = await resolveAllowedPath('README.md', config, 'read');
  assert.equal(resolved.relativePathPosix, 'README.md');
});

test('resolveAllowedPath blocks traversal outside root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sll-'));
  const config = makeConfig(root);
  await assert.rejects(() => resolveAllowedPath('../outside.txt', config, 'read'), /outside every configured ROOTS/);
});

test('resolveAllowedPath blocks secret-like file names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sll-'));
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=abc');
  const config = makeConfig(root);
  await assert.rejects(() => resolveAllowedPath('.env', config, 'read'), /blocked by safety pattern/);
});

test('writeTextFile refuses writes when ALLOW_WRITE is disabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sll-'));
  const config = makeConfig(root);
  await assert.rejects(() => writeTextFile('new.txt', 'hello', false, config), /Write tools are disabled/);
});

test('writeTextFile creates and readTextFile reads when enabled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sll-'));
  const config = { ...makeConfig(root), allowWrite: true };
  await writeTextFile('notes/readme.txt', 'hello world', false, config);
  const result = await readTextFile('notes/readme.txt', config);
  assert.equal(result.content, 'hello world');
});

test('createDirectory supports dry-run writes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sll-'));
  const config = { ...makeConfig(root), allowWrite: true, dryRunWrite: true };
  const result = await createDirectory('dry-run-dir', config);
  assert.equal(result.dryRun, true);
  assert.equal(fs.existsSync(path.join(root, 'dry-run-dir')), false);
});
