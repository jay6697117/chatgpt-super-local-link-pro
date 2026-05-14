import test from 'node:test';
import assert from 'node:assert/strict';

import { createFileStateCache } from '../src/agent/readFileState.js';
import { createDangerousCommandConfirmationToken, createSafeBashTool, validateSafeCommand } from '../src/agent/tools/safeBash.js';
import { makeConfig, makeTempRoot } from './helpers.js';

function agentContext(root: string, config: ReturnType<typeof makeConfig>, userPrompt?: string) {
  return {
    config,
    cwd: root,
    dryRun: true,
    readFileState: createFileStateCache(),
    filesRead: new Set<string>(),
    filesChanged: new Set<string>(),
    bashCommands: [],
    userPrompt
  };
}

test('validateSafeCommand requires confirmation for metacharacters and dangerous families', () => {
  assert.throws(() => validateSafeCommand('git status; rm -rf .', ['*']), /requires explicit user confirmation/);
  assert.throws(() => validateSafeCommand('rm -rf tmp', ['rm -rf tmp']), /requires explicit user confirmation/);
  assert.throws(() => validateSafeCommand('git status', []), /not in AGENT_BASH_ALLOWLIST/);

  const safe = validateSafeCommand('git status', ['git status']);
  assert.equal(safe.command, 'git status');
  assert.equal(safe.executable, 'git');
  assert.deepEqual(safe.args, ['status']);
  assert.equal(safe.useShell, false);
  assert.deepEqual(safe.riskReasons, []);

  const dangerousCommand = 'rm -rf tmp';
  const dangerous = validateSafeCommand(dangerousCommand, ['rm -rf tmp'], createDangerousCommandConfirmationToken(dangerousCommand));
  assert.equal(dangerous.executable, 'rm');
  assert.deepEqual(dangerous.args, ['-rf', 'tmp']);
  assert.equal(dangerous.useShell, false);
  assert.deepEqual(dangerous.riskReasons, ['dangerous command family: rm']);

  const shellCommand = 'echo hello > output.txt';
  const shell = validateSafeCommand(shellCommand, ['*'], createDangerousCommandConfirmationToken(shellCommand));
  assert.equal(shell.command, shellCommand);
  assert.equal(shell.useShell, true);
  assert.deepEqual(shell.riskReasons, ['shell metacharacter']);
});

test('safe_bash is disabled unless AGENT_BASH_ENABLED is true', async () => {
  const root = makeTempRoot();
  const config = makeConfig(root, { agentBash: { enabled: false, allowlist: ['pwd'] } });
  const tool = createSafeBashTool();

  await assert.rejects(() => tool.call({ command: 'pwd', cwd: root }, agentContext(root, config)), /Safe Bash is disabled/);
});

test('safe_bash dry-run accepts exact allowlisted command under ROOTS', async () => {
  const root = makeTempRoot();
  const config = makeConfig(root, { agentBash: { enabled: true, allowlist: ['pwd'] } });
  const tool = createSafeBashTool();
  const result = await tool.call({ command: 'pwd', cwd: root }, agentContext(root, config));

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.command, 'pwd');
});

test('safe_bash dry-run requires current user prompt confirmation for risky commands', async () => {
  const root = makeTempRoot();
  const command = 'rm -rf tmp';
  const config = makeConfig(root, { agentBash: { enabled: true, allowlist: ['*'] } });
  const tool = createSafeBashTool();

  await assert.rejects(() => tool.call({ command, cwd: root }, agentContext(root, config)), /requires explicit user confirmation/);

  const result = await tool.call({ command, cwd: root }, agentContext(root, config, `确认执行 ${createDangerousCommandConfirmationToken(command)}`));
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.command, command);
  assert.deepEqual(result.riskReasons, ['dangerous command family: rm']);
});
