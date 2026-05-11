import fs from 'node:fs/promises';

import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { directoryTree, fileStat, readTextFile, replaceInTextFile, searchFiles, writeTextFile } from '../../filesystem/service.js';
import { resolveAllowedPath } from '../../security/pathGuards.js';
import { assertFresh, updateFromContent } from '../readFileState.js';
import type { AgentToolContext, AgentToolDefinition } from '../types.js';

const directoryTreeInput = z
  .object({
    path: z.string().min(1),
    depth: z.number().int().min(0).optional(),
    maxEntries: z.number().int().min(1).optional(),
    excludePatterns: z.array(z.string()).optional()
  })
  .strict();

const fileStatInput = z.object({ path: z.string().min(1) }).strict();

const readFileInput = z
  .object({
    path: z.string().min(1),
    maxBytes: z.number().int().min(1).optional()
  })
  .strict();

const searchFilesInput = z
  .object({
    path: z.string().min(1),
    query: z.string().min(1),
    mode: z.enum(['literal', 'regex']).optional(),
    includeGlob: z.string().optional(),
    excludePatterns: z.array(z.string()).optional(),
    caseSensitive: z.boolean().optional(),
    maxFiles: z.number().int().min(1).optional(),
    maxResults: z.number().int().min(1).optional()
  })
  .strict();

const writeFileInput = z
  .object({
    path: z.string().min(1),
    content: z.string(),
    overwrite: z.boolean().optional()
  })
  .strict();

const replaceInFileInput = z
  .object({
    path: z.string().min(1),
    oldText: z.string().min(1),
    newText: z.string(),
    replaceAll: z.boolean().optional()
  })
  .strict();

function effectiveConfig(context: AgentToolContext): AppConfig {
  return context.dryRun ? { ...context.config, dryRunWrite: true } : context.config;
}

function stringField(value: Record<string, unknown>, key: string, fallback: string): string {
  const field = value[key];
  return typeof field === 'string' ? field : fallback;
}

const directoryTreeParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'Directory path under ROOTS.' },
    depth: { type: 'integer', minimum: 0, description: 'Directory scan depth.' },
    maxEntries: { type: 'integer', minimum: 1, description: 'Maximum entries to return.' },
    excludePatterns: { type: 'array', items: { type: 'string' }, description: 'Additional minimatch exclude patterns.' }
  },
  required: ['path']
};

const fileStatParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'File or directory path under ROOTS.' }
  },
  required: ['path']
};

const readFileParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'UTF-8 text file path under ROOTS.' },
    maxBytes: { type: 'integer', minimum: 1, description: 'Maximum bytes to read.' }
  },
  required: ['path']
};

const searchFilesParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'Directory path under ROOTS.' },
    query: { type: 'string', description: 'Literal text or JavaScript regex pattern.' },
    mode: { type: 'string', enum: ['literal', 'regex'], description: 'Search mode. Defaults to literal.' },
    includeGlob: { type: 'string', description: 'Optional glob such as **/*.ts.' },
    excludePatterns: { type: 'array', items: { type: 'string' }, description: 'Additional minimatch exclude patterns.' },
    caseSensitive: { type: 'boolean', description: 'Defaults to false.' },
    maxFiles: { type: 'integer', minimum: 1, description: 'Maximum files to scan.' },
    maxResults: { type: 'integer', minimum: 1, description: 'Maximum search matches to return.' }
  },
  required: ['path', 'query']
};

const writeFileParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'File path under ROOTS.' },
    content: { type: 'string', description: 'Full UTF-8 file content to write.' },
    overwrite: { type: 'boolean', description: 'Required true for existing files; existing files must be read first.' }
  },
  required: ['path', 'content']
};

const replaceInFileParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'Existing UTF-8 file path under ROOTS.' },
    oldText: { type: 'string', description: 'Exact text to replace.' },
    newText: { type: 'string', description: 'Replacement text.' },
    replaceAll: { type: 'boolean', description: 'Replace every occurrence when true.' }
  },
  required: ['path', 'oldText', 'newText']
};

export function createFilesystemTools(_config: AppConfig): AgentToolDefinition[] {
  return [
    {
      name: 'directory_tree',
      description: 'Read a guarded directory tree under ROOTS. Skips blocked files and directories.',
      inputSchema: directoryTreeInput,
      modelParameters: directoryTreeParameters,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      call: async (input, context) => directoryTree(input.path, context.config, input) as Promise<Record<string, unknown>>
    },
    {
      name: 'file_stat',
      description: 'Return guarded file or directory metadata for a path under ROOTS.',
      inputSchema: fileStatInput,
      modelParameters: fileStatParameters,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      call: async (input, context) => fileStat(input.path, context.config) as Promise<Record<string, unknown>>
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file under ROOTS. A complete, non-truncated read is required before editing that file.',
      inputSchema: readFileInput,
      modelParameters: readFileParameters,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      call: async (input, context) => {
        const result = (await readTextFile(input.path, context.config, { maxBytes: input.maxBytes })) as Record<string, unknown>;
        const filePath = stringField(result, 'path', input.path);
        context.filesRead.add(filePath);
        if (result.truncated === false && typeof result.content === 'string') {
          await updateFromContent(context.readFileState, filePath, result.content);
        }
        return result;
      }
    },
    {
      name: 'search_files',
      description: 'Search file contents under a guarded directory. Use includeGlob to narrow file types.',
      inputSchema: searchFilesInput,
      modelParameters: searchFilesParameters,
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      call: async (input, context) => searchFiles(input.path, input.query, context.config, input) as Promise<Record<string, unknown>>
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a UTF-8 text file under ROOTS. Existing files require a fresh full read first.',
      inputSchema: writeFileInput,
      modelParameters: writeFileParameters,
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
      isDestructive: (input) => input.overwrite === true,
      call: async (input, context) => {
        const resolved = await resolveAllowedPath(input.path, context.config, 'write');
        if (resolved.existed) await assertFresh(context.readFileState, resolved.absolutePath);
        const result = (await writeTextFile(input.path, input.content, input.overwrite ?? false, effectiveConfig(context))) as Record<string, unknown>;
        const filePath = stringField(result, 'path', resolved.absolutePath);
        if (result.dryRun !== true) {
          context.filesChanged.add(filePath);
          await updateFromContent(context.readFileState, filePath, input.content);
        }
        return result;
      }
    },
    {
      name: 'replace_in_file',
      description: 'Perform an exact text replacement in an existing UTF-8 file. Requires a fresh full read first.',
      inputSchema: replaceInFileInput,
      modelParameters: replaceInFileParameters,
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
      isDestructive: () => false,
      call: async (input, context) => {
        const resolved = await resolveAllowedPath(input.path, context.config, 'read');
        await assertFresh(context.readFileState, resolved.absolutePath);
        const result = (await replaceInTextFile(input.path, input.oldText, input.newText, input.replaceAll ?? false, effectiveConfig(context))) as Record<string, unknown>;
        const filePath = stringField(result, 'path', resolved.absolutePath);
        if (result.dryRun !== true) {
          context.filesChanged.add(filePath);
          await updateFromContent(context.readFileState, filePath, await fs.readFile(filePath, 'utf8'));
        }
        return result;
      }
    }
  ];
}

export const createFilesystemAgentTools = createFilesystemTools;
