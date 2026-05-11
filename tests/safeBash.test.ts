import test from 'node:test';
import assert from 'node:assert/strict';

import { createFileStateCache } from '../src/agent/readFileState.js';
import { createSafeBashTool, validateSafeCommand } from '../src/agent/tools/safeBash.js';
import { makeConfig, makeTempRoot } from './helpers.js';

test('validateSafeCommand rejects metacharacters, dangerous families, and non-allowlisted commands', () => {
  assert.throws(() => validateSafeCommand('git status; rm -rf .', ['git status']), /metacharacter/);
  assert.throws(() => validateSafeCommand('rm -rf tmp', ['rm -rf tmp']), /dangerous command family/);
  assert.throws(() => validateSafeCommand('git status', []), /not in AGENT_BASH_ALLOWLIST/);
  assert.deepEqual(validateSafeCommand('git status', ['git status']), {
    command: 'git status',
    executable: 'git',
    args: ['status']
  });
});

test('safe_bash is disabled unless AGENT_BASH_ENABLED is true', async () => {
  const root = makeTempRoot();
  const config = makeConfig(root, { agentBash: { enabled: false, allowlist: ['pwd'] } });
  const tool = createSafeBashTool();

  await assert.rejects(
    () =>
      tool.call(
        { command: 'pwd', cwd: root },
        {
          config,
          cwd: root,
          dryRun: true,
          readFileState: createFileStateCache(),
          filesRead: new Set<string>(),
          filesChanged: new Set<string>(),
          bashCommands: []
        }
      ),
    /Safe Bash is disabled/
  );
});

test('safe_bash dry-run accepts exact allowlisted command under ROOTS', async () => {
  const root = makeTempRoot();
  const config = makeConfig(root, { agentBash: { enabled: true, allowlist: ['pwd'] } });
  const tool = createSafeBashTool();
  const result = await tool.call(
    { command: 'pwd', cwd: root },
    {
      config,
      cwd: root,
      dryRun: true,
      readFileState: createFileStateCache(),
      filesRead: new Set<string>(),
      filesChanged: new Set<string>(),
      bashCommands: []
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.command, 'pwd');
});
