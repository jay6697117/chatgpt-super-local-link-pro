import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { AgentSession } from '../src/agent/agentSession.js';
import { createAgentToolRegistry } from '../src/agent/toolRegistry.js';
import type { ModelClient, ModelCompleteInput, ModelCompleteResult } from '../src/agent/types.js';
import { makeConfig, makeTempRoot } from './helpers.js';

class ReadThenFinalModel implements ModelClient {
  calls = 0;

  async complete(_input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: '',
        toolCalls: [{ id: 'read-1', name: 'read_file', input: { path: 'README.md' } }]
      };
    }
    return { content: 'Read README.md successfully.', toolCalls: [], usage: { calls: this.calls } };
  }
}

test('AgentSession runs a fake model tool loop and returns final text', async () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'README.md'), 'hello agent');
  const config = makeConfig(root, { localAgent: { enabled: true } });
  const modelClient = new ReadThenFinalModel();
  const session = new AgentSession({ config, modelClient, toolRegistry: createAgentToolRegistry(config) });

  const result = await session.run({ prompt: 'Read the README', path: root });

  assert.equal(result.ok, true);
  assert.equal(result.finalText, 'Read README.md successfully.');
  assert.equal(result.toolCalls[0]?.name, 'read_file');
  assert.equal(modelClient.calls, 2);
  assert.equal(result.filesRead.some((filePath) => filePath.endsWith('README.md')), true);
});
