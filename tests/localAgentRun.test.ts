import test from 'node:test';
import assert from 'node:assert/strict';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAgentTools } from '../src/mcp/tools/registerAgent.js';
import type { ModelClient, ModelCompleteInput, ModelCompleteResult } from '../src/agent/types.js';
import { makeConfig, makeTempRoot } from './helpers.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<{ structuredContent: Record<string, unknown> }>;

function createServerStub(): { server: McpServer; handlers: Record<string, ToolHandler> } {
  const handlers: Record<string, ToolHandler> = {};
  const server = {
    registerTool(name: string, _definition: unknown, handler: ToolHandler) {
      handlers[name] = handler;
    }
  } as unknown as McpServer;
  return { server, handlers };
}

class FinalModel implements ModelClient {
  async complete(_input: ModelCompleteInput): Promise<ModelCompleteResult> {
    return { content: 'done', toolCalls: [] };
  }
}

test('local_agent_run returns a structured disabled error when disabled', async () => {
  const root = makeTempRoot();
  const config = makeConfig(root, { localAgent: { enabled: false } });
  const { server, handlers } = createServerStub();

  registerAgentTools(server, config);
  const result = await handlers.local_agent_run!({ prompt: 'hello' });

  assert.equal(result.structuredContent.ok, false);
  assert.equal((result.structuredContent.error as Record<string, unknown>).code, 'LOCAL_AGENT_DISABLED');
});

test('local_agent_run uses an injected fake model client without API key', async () => {
  const root = makeTempRoot();
  const config = makeConfig(root, { localAgent: { enabled: true, modelApiKey: '' } });
  const { server, handlers } = createServerStub();

  registerAgentTools(server, config, { modelClient: new FinalModel() });
  const result = await handlers.local_agent_run!({ prompt: 'finish', path: root });

  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.finalText, 'done');
  assert.equal(typeof result.structuredContent.sessionId, 'string');
});
