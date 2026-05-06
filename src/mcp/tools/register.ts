import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../../config/env.js';
import { publicConfigSummary } from '../../config/env.js';
import { toSafeError } from '../../core/errors.js';
import {
  appendTextFile,
  createDirectory,
  directoryTree,
  fileStat,
  projectOverview,
  readManyTextFiles,
  readTextFile,
  replaceInTextFile,
  searchFiles,
  summarizeServer,
  writeTextFile
} from '../../filesystem/service.js';

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toolResult(value: Record<string, unknown>) {
  return {
    structuredContent: value,
    content: [{ type: 'text' as const, text: jsonText(value) }]
  };
}

async function runTool(fn: () => Promise<Record<string, unknown>> | Record<string, unknown>) {
  try {
    return toolResult(await fn());
  } catch (error) {
    return toolResult({ ok: false, error: toSafeError(error) });
  }
}

function writePolicyText(config: AppConfig): string {
  if (!config.allowWrite) return 'Write mode is currently disabled. Set ALLOW_WRITE=1 in .env and restart before using this tool.';
  if (!config.allowOverwrite) return 'Write mode is enabled for new paths, but existing file modification requires ALLOW_OVERWRITE=1.';
  return 'Write mode and existing file modification are enabled. Backups are recommended and enabled by BACKUP_BEFORE_OVERWRITE=1.';
}

export function registerFilesystemTools(server: McpServer, config: AppConfig): void {
  server.registerTool(
    'list_allowed_roots',
    {
      title: 'List allowed local roots',
      description: 'Use first. Returns allowed local directories, transport/auth mode, read/write flags, and safety limits.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => runTool(() => ({ ...summarizeServer(config), defaultExcludePatterns: config.defaultExcludePatterns, extraExcludePatterns: config.extraExcludePatterns }))
  );

  server.registerTool(
    'project_overview',
    {
      title: 'Project overview',
      description: 'Quickly inspect an allowed project root: important files, likely technologies, package.json summary, and recommended next files to read.',
      inputSchema: {
        path: z.string().describe('Project directory under ROOTS. Absolute path or relative to the first ROOT.'),
        depth: z.number().int().min(1).max(config.maxTreeDepth).optional().describe('Directory scan depth. Default 4.'),
        maxFiles: z.number().int().min(1).max(config.maxProjectOverviewFiles).optional().describe(`Maximum files to sample. Server max ${config.maxProjectOverviewFiles}.`),
        includePatterns: z.array(z.string()).optional().describe('Additional exclude patterns to apply for this call.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ path, depth, includePatterns, maxFiles }) => runTool(() => projectOverview(path, config, { depth, includePatterns, maxFiles }) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'directory_tree',
    {
      title: 'Read directory tree',
      description: 'Read a safe directory tree under ROOTS. Skips dependencies, build output, VCS data, local config, databases, and secret-like files.',
      inputSchema: {
        path: z.string().describe('Directory path under ROOTS. Absolute or relative to the first ROOT.'),
        depth: z.number().int().min(0).max(config.maxTreeDepth).optional().describe(`Default ${config.defaultTreeDepth}; server max ${config.maxTreeDepth}.`),
        maxEntries: z.number().int().min(1).max(config.maxTreeEntries).optional().describe(`Server max ${config.maxTreeEntries}.`),
        excludePatterns: z.array(z.string()).optional().describe('Additional minimatch exclude patterns relative to the selected root.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ path, depth, excludePatterns, maxEntries }) => runTool(() => directoryTree(path, config, { depth, excludePatterns, maxEntries }) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'file_stat',
    {
      title: 'Get file metadata',
      description: 'Return safe file or directory metadata for an allowed path.',
      inputSchema: { path: z.string().describe('Path under ROOTS.') },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ path }) => runTool(() => fileStat(path, config) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read local text file',
      description: 'Read a UTF-8 text file under ROOTS. Refuses blocked paths and binary-looking files; large files are truncated.',
      inputSchema: {
        path: z.string().describe('File path under ROOTS.'),
        maxBytes: z.number().int().min(1).max(config.maxReadBytes).optional().describe(`Server max ${config.maxReadBytes}.`)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ path, maxBytes }) => runTool(() => readTextFile(path, config, { maxBytes }) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'read_many_files',
    {
      title: 'Read multiple text files',
      description: 'Read several safe text files under ROOTS in one tool call, with per-file and total byte limits.',
      inputSchema: {
        paths: z.array(z.string()).min(1).max(config.maxReadManyFiles).describe(`Maximum ${config.maxReadManyFiles} files.`),
        maxBytesPerFile: z.number().int().min(1).max(config.maxReadBytes).optional().describe(`Server max ${config.maxReadBytes}.`),
        maxTotalBytes: z.number().int().min(1).max(config.maxReadManyTotalBytes).optional().describe(`Server max ${config.maxReadManyTotalBytes}.`)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ paths, maxBytesPerFile, maxTotalBytes }) => runTool(() => readManyTextFiles(paths, config, { maxBytesPerFile, maxTotalBytes }) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'search_files',
    {
      title: 'Search local project files',
      description: 'Search file contents under an allowed directory. Skips blocked, binary-looking, and oversized files. Use includeGlob to narrow file types.',
      inputSchema: {
        path: z.string().describe('Directory under ROOTS.'),
        query: z.string().min(1).describe('Literal text or JavaScript regex pattern.'),
        mode: z.enum(['literal', 'regex']).optional().describe('Default literal.'),
        includeGlob: z.string().optional().describe('Example: **/*.{ts,vue,md}'),
        excludePatterns: z.array(z.string()).optional().describe('Additional minimatch exclude patterns.'),
        caseSensitive: z.boolean().optional().describe('Default false.'),
        maxFiles: z.number().int().min(1).max(config.maxSearchFiles).optional().describe(`Server max ${config.maxSearchFiles}.`),
        maxResults: z.number().int().min(1).max(config.maxSearchResults).optional().describe(`Server max ${config.maxSearchResults}.`)
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ path, query, mode, includeGlob, excludePatterns, caseSensitive, maxFiles, maxResults }) =>
      runTool(() => searchFiles(path, query, config, { mode, includeGlob, excludePatterns, caseSensitive, maxFiles, maxResults }) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'create_directory',
    {
      title: 'Create directory',
      description: `Create a directory under ROOTS. ${writePolicyText(config)}`,
      inputSchema: { path: z.string().describe('Directory path under ROOTS.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ path }) => runTool(() => createDirectory(path, config) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write file',
      description: `Create or overwrite a UTF-8 text file under ROOTS. ${writePolicyText(config)} Existing files require overwrite=true and ALLOW_OVERWRITE=1.`,
      inputSchema: {
        path: z.string().describe('File path under ROOTS.'),
        content: z.string().describe('UTF-8 text content.'),
        overwrite: z.boolean().optional().describe('Default false. Existing file replacement requires ALLOW_OVERWRITE=1.')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ path, content, overwrite = false }) => runTool(() => writeTextFile(path, content, overwrite, config) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'append_file',
    {
      title: 'Append file',
      description: `Append UTF-8 text to a file under ROOTS. ${writePolicyText(config)} Existing file append requires ALLOW_OVERWRITE=1.`,
      inputSchema: {
        path: z.string().describe('File path under ROOTS.'),
        content: z.string().describe('UTF-8 text to append.'),
        createIfMissing: z.boolean().optional().describe('Default false. Create the file when missing.')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ path, content, createIfMissing = false }) => runTool(() => appendTextFile(path, content, createIfMissing, config) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'replace_in_file',
    {
      title: 'Replace exact text in file',
      description: `Perform a targeted exact-text replacement in an existing UTF-8 file. ${writePolicyText(config)} Creates a backup when BACKUP_BEFORE_OVERWRITE=1.`,
      inputSchema: {
        path: z.string().describe('Existing file path under ROOTS.'),
        oldText: z.string().min(1).describe('Exact text to find.'),
        newText: z.string().describe('Replacement text.'),
        replaceAll: z.boolean().optional().describe(`Default false. When true, max ${config.maxReplaceOccurrences} occurrences.`)
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ path, oldText, newText, replaceAll = false }) => runTool(() => replaceInTextFile(path, oldText, newText, replaceAll, config) as Promise<Record<string, unknown>>)
  );

  server.registerTool(
    'server_config_summary',
    {
      title: 'Server config summary',
      description: 'Returns a redacted server configuration summary. Does not include auth tokens or environment secrets.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => runTool(() => publicConfigSummary(config))
  );
}
