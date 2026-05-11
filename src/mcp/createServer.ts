import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../config/env.js';
import { registerAgentTools } from './tools/registerAgent.js';
import { registerFilesystemTools } from './tools/register.js';

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer(
    {
      name: 'super-local-link-filesystem',
      version: '1.1.0'
    },
    {
      instructions: [
        'You are connected to a guarded local filesystem and local coding agent MCP server.',
        'Use only the advertised tools. Direct shell execution is not available through the filesystem tools.',
        'Always call list_allowed_roots or project_overview before reading deep project files.',
        'Never request .env files, tokens, keys, credentials, SSH keys, browser profiles, database dumps, or blocked paths.',
        'Prefer project_overview, directory_tree, search_files, read_file, and read_many_files before writing.',
        'Write tools are disabled unless ALLOW_WRITE=1. Existing file edits also require ALLOW_OVERWRITE=1.',
        'For edits, prefer replace_in_file with small exact text spans and keep backups enabled.',
        'Use local_agent_run only when the caller wants a bounded coding-agent loop; it is disabled unless LOCAL_AGENT_ENABLED=1.'
      ].join('\n')
    }
  );

  registerFilesystemTools(server, config);
  registerAgentTools(server, config);
  return server;
}
