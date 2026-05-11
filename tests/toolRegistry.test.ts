import test from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { createFileStateCache } from '../src/agent/readFileState.js';
import { ToolRegistry } from '../src/agent/toolRegistry.js';
import { makeConfig, makeTempRoot } from './helpers.js';

test('ToolRegistry preserves tool-level ok=false results', async () => {
  const root = makeTempRoot();
  const config = makeConfig(root, { localAgent: { enabled: true } });
  const registry = new ToolRegistry([
    {
      name: 'returns_false',
      description: 'test tool',
      inputSchema: z.object({}).strict(),
      modelParameters: { type: 'object', additionalProperties: false, properties: {} },
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      call: async () => ({ ok: false, reason: 'nope' })
    }
  ]);

  const result = await registry.executeToolCall(
    { id: 'tool-1', name: 'returns_false', input: {} },
    {
      config,
      cwd: root,
      dryRun: false,
      readFileState: createFileStateCache(),
      filesRead: new Set<string>(),
      filesChanged: new Set<string>(),
      bashCommands: []
    }
  );

  assert.equal(result.ok, false);
});
