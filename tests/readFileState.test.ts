import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { assertFresh, createFileStateCache, updateFromContent } from '../src/agent/readFileState.js';
import { createAgentToolRegistry } from '../src/agent/toolRegistry.js';
import { makeConfig, makeTempRoot } from './helpers.js';

test('readFileState rejects writes before a full read is cached', async () => {
  const root = makeTempRoot();
  const filePath = path.join(root, 'note.txt');
  fs.writeFileSync(filePath, 'hello');
  const cache = createFileStateCache();

  await assert.rejects(() => assertFresh(cache, filePath), /fully read/);
});

test('readFileState rejects stale cached reads after external modification', async () => {
  const root = makeTempRoot();
  const filePath = path.join(root, 'note.txt');
  fs.writeFileSync(filePath, 'hello');
  const cache = createFileStateCache();

  await updateFromContent(cache, filePath, 'hello');
  await assertFresh(cache, filePath);

  fs.writeFileSync(filePath, 'changed');
  await assert.rejects(() => assertFresh(cache, filePath), /changed after it was read/);
});

test('agent write_file wrapper requires cached read before overwriting existing files', async () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'note.txt'), 'hello');
  const config = makeConfig(root, { allowWrite: true, allowOverwrite: true, localAgent: { enabled: true } });
  const registry = createAgentToolRegistry(config);

  const result = await registry.executeToolCall(
    { id: 'write-1', name: 'write_file', input: { path: 'note.txt', content: 'changed', overwrite: true } },
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
  assert.equal(result.error?.code, 'READ_REQUIRED_BEFORE_WRITE');
  assert.equal(fs.readFileSync(path.join(root, 'note.txt'), 'utf8'), 'hello');
});
