import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AppConfig } from '../src/config/env.js';

type ConfigOverrides = Partial<Omit<AppConfig, 'localAgent' | 'agentBash'>> & {
  localAgent?: Partial<AppConfig['localAgent']>;
  agentBash?: Partial<AppConfig['agentBash']>;
};

export function makeTempRoot(prefix = 'sll-agent-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeConfig(root: string, overrides: ConfigOverrides = {}): AppConfig {
  const realPath = fs.realpathSync.native(root);
  const base: AppConfig = {
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
    backupBeforeOverwrite: false,
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
      modelName: 'gpt-test',
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

  return {
    ...base,
    ...overrides,
    localAgent: { ...base.localAgent, ...overrides.localAgent },
    agentBash: { ...base.agentBash, ...overrides.agentBash }
  };
}
