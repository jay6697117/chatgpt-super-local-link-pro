import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const truthy = new Set(['1', 'true', 'yes', 'y', 'on']);
const falsy = new Set(['0', 'false', 'no', 'n', 'off', '']);

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (truthy.has(normalized)) return true;
    if (falsy.has(normalized)) return false;
  }
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  APP_NAME: z.string().default('ChatGPT Super Local Link Pro'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2091),
  HOST: z.string().default('127.0.0.1'),
  TRUST_PROXY: z.string().optional().default('1'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  LOG_DIR: z.string().default('./logs'),

  MCP_PATH: z.string().default('/mcp'),
  ENABLE_LEGACY_SSE: z.string().optional().default('1'),
  SSE_PATH: z.string().default('/sse'),
  SSE_MESSAGES_PATH: z.string().default('/messages'),
  MCP_STATEFUL_SESSIONS: z.string().optional().default('0'),
  MCP_ENABLE_JSON_RESPONSE: z.string().optional().default('1'),

  AUTH_MODE: z.enum(['no-auth', 'bearer']).default('no-auth'),
  AUTH_TOKEN: z.string().optional().default(''),
  CORS_ALLOWED_ORIGINS: z.string().default('*'),
  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(0).default(60000),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().min(0).default(240),

  ROOTS: z.string().default('./workspace'),
  ALLOW_RELATIVE_PATHS: z.string().optional().default('1'),

  MAX_READ_BYTES: z.coerce.number().int().min(1024).default(262144),
  MAX_READ_MANY_FILES: z.coerce.number().int().min(1).default(20),
  MAX_READ_MANY_TOTAL_BYTES: z.coerce.number().int().min(1024).default(1048576),
  MAX_SEARCH_FILE_BYTES: z.coerce.number().int().min(1024).default(524288),
  MAX_SEARCH_FILES: z.coerce.number().int().min(1).default(2500),
  MAX_SEARCH_RESULTS: z.coerce.number().int().min(1).default(200),
  MAX_SEARCH_RESULT_LINE_CHARS: z.coerce.number().int().min(40).default(260),
  DEFAULT_TREE_DEPTH: z.coerce.number().int().min(0).default(3),
  MAX_TREE_DEPTH: z.coerce.number().int().min(1).default(8),
  MAX_TREE_ENTRIES: z.coerce.number().int().min(1).default(2500),
  MAX_PROJECT_OVERVIEW_FILES: z.coerce.number().int().min(1).default(80),

  ALLOW_WRITE: z.string().optional().default('0'),
  ALLOW_OVERWRITE: z.string().optional().default('0'),
  DRY_RUN_WRITE: z.string().optional().default('0'),
  BACKUP_BEFORE_OVERWRITE: z.string().optional().default('1'),
  BACKUP_DIR: z.string().default('.super-local-link-backups'),
  MAX_WRITE_BYTES: z.coerce.number().int().min(1).default(524288),
  MAX_REPLACE_OCCURRENCES: z.coerce.number().int().min(1).default(50),

  DEFAULT_EXCLUDE_PATTERNS: z.string().default(''),
  EXTRA_EXCLUDE_PATTERNS: z.string().optional().default(''),
  BLOCKED_EXTENSIONS: z.string().optional().default(''),
  ENABLE_DEBUG_ENDPOINTS: z.string().optional().default('1')
});

export interface AllowedRoot {
  id: string;
  input: string;
  path: string;
  realPath: string;
}

export interface AppConfig {
  nodeEnv: string;
  appName: string;
  port: number;
  host: string;
  trustProxy: boolean;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  logDir: string;
  mcpPath: string;
  enableLegacySse: boolean;
  ssePath: string;
  sseMessagesPath: string;
  mcpStatefulSessions: boolean;
  mcpEnableJsonResponse: boolean;
  authMode: 'no-auth' | 'bearer';
  authToken: string;
  corsAllowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  allowedRoots: AllowedRoot[];
  allowRelativePaths: boolean;
  maxReadBytes: number;
  maxReadManyFiles: number;
  maxReadManyTotalBytes: number;
  maxSearchFileBytes: number;
  maxSearchFiles: number;
  maxSearchResults: number;
  maxSearchResultLineChars: number;
  defaultTreeDepth: number;
  maxTreeDepth: number;
  maxTreeEntries: number;
  maxProjectOverviewFiles: number;
  allowWrite: boolean;
  allowOverwrite: boolean;
  dryRunWrite: boolean;
  backupBeforeOverwrite: boolean;
  backupDir: string;
  maxWriteBytes: number;
  maxReplaceOccurrences: number;
  defaultExcludePatterns: string[];
  extraExcludePatterns: string[];
  blockedExtensions: string[];
  enableDebugEndpoints: boolean;
}

export function splitSemicolonList(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCommaList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHttpPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '/mcp';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function resolveDirectory(input: string): { absolute: string; realPath: string } {
  const absolute = path.resolve(input);
  if (!fs.existsSync(absolute)) {
    throw new Error(`ROOTS contains a path that does not exist: ${input} -> ${absolute}`);
  }
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) {
    throw new Error(`ROOTS path is not a directory: ${input} -> ${absolute}`);
  }
  return { absolute, realPath: fs.realpathSync.native(absolute) };
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  const rootInputs = splitSemicolonList(parsed.ROOTS);
  if (rootInputs.length === 0) {
    throw new Error('ROOTS is empty. Configure at least one allowed local project directory in .env.');
  }

  const allowedRoots = rootInputs.map((rootInput, index) => {
    const resolved = resolveDirectory(rootInput);
    return {
      id: `root-${index + 1}`,
      input: rootInput,
      path: resolved.absolute,
      realPath: resolved.realPath
    } satisfies AllowedRoot;
  });

  const authToken = parsed.AUTH_TOKEN.trim();
  if (parsed.AUTH_MODE === 'bearer' && authToken.length < 16) {
    throw new Error('AUTH_MODE=bearer requires AUTH_TOKEN with at least 16 characters.');
  }

  const logDir = path.resolve(parsed.LOG_DIR);
  fs.mkdirSync(logDir, { recursive: true });

  return {
    nodeEnv: parsed.NODE_ENV,
    appName: parsed.APP_NAME,
    port: parsed.PORT,
    host: parsed.HOST,
    trustProxy: toBoolean(parsed.TRUST_PROXY, true),
    logLevel: parsed.LOG_LEVEL,
    logDir,
    mcpPath: normalizeHttpPath(parsed.MCP_PATH),
    enableLegacySse: toBoolean(parsed.ENABLE_LEGACY_SSE, true),
    ssePath: normalizeHttpPath(parsed.SSE_PATH),
    sseMessagesPath: normalizeHttpPath(parsed.SSE_MESSAGES_PATH),
    mcpStatefulSessions: toBoolean(parsed.MCP_STATEFUL_SESSIONS, false),
    mcpEnableJsonResponse: toBoolean(parsed.MCP_ENABLE_JSON_RESPONSE, true),
    authMode: parsed.AUTH_MODE,
    authToken,
    corsAllowedOrigins: splitSemicolonList(parsed.CORS_ALLOWED_ORIGINS).length > 0 ? splitSemicolonList(parsed.CORS_ALLOWED_ORIGINS) : ['*'],
    rateLimitWindowMs: toNumber(parsed.HTTP_RATE_LIMIT_WINDOW_MS, 60000),
    rateLimitMax: toNumber(parsed.HTTP_RATE_LIMIT_MAX, 240),
    allowedRoots,
    allowRelativePaths: toBoolean(parsed.ALLOW_RELATIVE_PATHS, true),
    maxReadBytes: parsed.MAX_READ_BYTES,
    maxReadManyFiles: parsed.MAX_READ_MANY_FILES,
    maxReadManyTotalBytes: parsed.MAX_READ_MANY_TOTAL_BYTES,
    maxSearchFileBytes: parsed.MAX_SEARCH_FILE_BYTES,
    maxSearchFiles: parsed.MAX_SEARCH_FILES,
    maxSearchResults: parsed.MAX_SEARCH_RESULTS,
    maxSearchResultLineChars: parsed.MAX_SEARCH_RESULT_LINE_CHARS,
    defaultTreeDepth: Math.min(parsed.DEFAULT_TREE_DEPTH, parsed.MAX_TREE_DEPTH),
    maxTreeDepth: parsed.MAX_TREE_DEPTH,
    maxTreeEntries: parsed.MAX_TREE_ENTRIES,
    maxProjectOverviewFiles: parsed.MAX_PROJECT_OVERVIEW_FILES,
    allowWrite: toBoolean(parsed.ALLOW_WRITE, false),
    allowOverwrite: toBoolean(parsed.ALLOW_OVERWRITE, false),
    dryRunWrite: toBoolean(parsed.DRY_RUN_WRITE, false),
    backupBeforeOverwrite: toBoolean(parsed.BACKUP_BEFORE_OVERWRITE, true),
    backupDir: parsed.BACKUP_DIR,
    maxWriteBytes: parsed.MAX_WRITE_BYTES,
    maxReplaceOccurrences: parsed.MAX_REPLACE_OCCURRENCES,
    defaultExcludePatterns: splitSemicolonList(parsed.DEFAULT_EXCLUDE_PATTERNS),
    extraExcludePatterns: splitSemicolonList(parsed.EXTRA_EXCLUDE_PATTERNS),
    blockedExtensions: splitCommaList(parsed.BLOCKED_EXTENSIONS).map((ext) => ext.toLowerCase()),
    enableDebugEndpoints: toBoolean(parsed.ENABLE_DEBUG_ENDPOINTS, true)
  };
}

export function publicConfigSummary(config: AppConfig): Record<string, unknown> {
  return {
    appName: config.appName,
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    endpoints: {
      mcp: config.mcpPath,
      legacySse: config.enableLegacySse ? config.ssePath : null,
      legacySseMessages: config.enableLegacySse ? config.sseMessagesPath : null,
      health: '/health'
    },
    transport: {
      streamableHttp: true,
      statefulSessions: config.mcpStatefulSessions,
      jsonResponse: config.mcpEnableJsonResponse,
      legacySse: config.enableLegacySse
    },
    auth: config.authMode === 'no-auth' ? 'No Authentication' : 'Bearer token required',
    writePolicy: {
      allowWrite: config.allowWrite,
      allowOverwrite: config.allowOverwrite,
      dryRunWrite: config.dryRunWrite,
      backupBeforeOverwrite: config.backupBeforeOverwrite
    },
    limits: {
      maxReadBytes: config.maxReadBytes,
      maxWriteBytes: config.maxWriteBytes,
      maxTreeDepth: config.maxTreeDepth,
      maxTreeEntries: config.maxTreeEntries,
      maxSearchFiles: config.maxSearchFiles,
      maxSearchResults: config.maxSearchResults
    },
    allowedRoots: config.allowedRoots.map((root) => ({ id: root.id, path: root.path, input: root.input }))
  };
}
