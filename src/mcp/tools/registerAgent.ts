import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../../config/env.js';
import { AgentSessionManager } from '../../agent/agentSession.js';
import { OpenAIChatCompletionsModelClient } from '../../agent/modelClient.js';
import { createAgentToolRegistry } from '../../agent/toolRegistry.js';
import type { AgentToolDefinition, ModelClient } from '../../agent/types.js';
import { AppError, toSafeError } from '../../core/errors.js';

export interface RegisterAgentToolsOptions {
  modelClient?: ModelClient;
  extraTools?: AgentToolDefinition[];
  sessionManager?: AgentSessionManager;
}

const localAgentRunInput = z
  .object({
    prompt: z.string().min(1).describe('Coding task or question for the local agent.'),
    path: z.string().optional().describe('Working path under ROOTS. Defaults to the first root.'),
    sessionId: z.string().optional().describe('Optional process-memory session id to continue.'),
    maxTurns: z.number().int().min(1).optional().describe('Optional lower per-run turn limit.'),
    maxToolCalls: z.number().int().min(1).optional().describe('Optional lower per-run tool-call limit.'),
    dryRun: z.boolean().optional().describe('When true, write tools report intended changes without modifying files.')
  })
  .strict();

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toolResult(value: object) {
  return {
    structuredContent: value as Record<string, unknown>,
    content: [{ type: 'text' as const, text: jsonText(value) }]
  };
}

function structuredError(error: AppError) {
  return toolResult({ ok: false, error: toSafeError(error) });
}

function validateAgentConfig(config: AppConfig, hasInjectedModelClient: boolean): AppError | null {
  if (!config.localAgent.enabled) {
    return new AppError('LOCAL_AGENT_DISABLED', 'local_agent_run is disabled. Set LOCAL_AGENT_ENABLED=1 and restart to enable it.', 403);
  }
  if (!config.localAgent.modelName) {
    return new AppError('MODEL_CONFIG_ERROR', 'LOCAL_AGENT_MODEL_NAME is required when local_agent_run is enabled.', 500);
  }
  if (!hasInjectedModelClient && !config.localAgent.modelBaseUrl) {
    return new AppError('MODEL_CONFIG_ERROR', 'LOCAL_AGENT_MODEL_BASE_URL is required when local_agent_run is enabled.', 500);
  }
  if (!hasInjectedModelClient && config.localAgent.modelBaseUrl === 'https://api.openai.com/v1' && !config.localAgent.modelApiKey) {
    return new AppError('MODEL_CONFIG_ERROR', 'LOCAL_AGENT_MODEL_API_KEY is required for the default OpenAI-compatible endpoint.', 500);
  }
  return null;
}

export function registerAgentTools(server: McpServer, config: AppConfig, options: RegisterAgentToolsOptions = {}): void {
  const toolRegistry = createAgentToolRegistry(config, { extraTools: options.extraTools });
  const modelClient =
    options.modelClient ??
    new OpenAIChatCompletionsModelClient({
      baseUrl: config.localAgent.modelBaseUrl,
      apiKey: config.localAgent.modelApiKey
    });
  const sessionManager =
    options.sessionManager ??
    new AgentSessionManager({
      config,
      modelClient,
      toolRegistry,
      ttlMs: config.localAgent.sessionTtlMs,
      maxSessions: config.localAgent.maxSessionCount
    });

  server.registerTool(
    'local_agent_run',
    {
      title: 'Run local coding agent',
      description: 'Run a bounded local coding agent with guarded filesystem tools. Disabled unless LOCAL_AGENT_ENABLED=1.',
      inputSchema: localAgentRunInput.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async (input) => {
      const configError = validateAgentConfig(config, !!options.modelClient);
      if (configError) return structuredError(configError);

      const parsed = localAgentRunInput.safeParse(input);
      if (!parsed.success) {
        return structuredError(
          new AppError('INVALID_INPUT', 'Invalid local_agent_run input.', 400, {
            issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }))
          })
        );
      }

      const session = sessionManager.getOrCreate(parsed.data.sessionId);
      return toolResult(await session.run(parsed.data));
    }
  );
}
