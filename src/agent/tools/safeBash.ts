import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

import { z } from 'zod';

import { AppError } from '../../core/errors.js';
import { resolveAllowedPath } from '../../security/pathGuards.js';
import type { AppConfig } from '../../config/env.js';
import type { AgentToolContext, AgentToolDefinition } from '../types.js';

export const safeBashInputSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional()
});

export type SafeBashInput = z.infer<typeof safeBashInputSchema>;

export interface ValidatedSafeCommand {
  command: string;
  executable: string;
  args: string[];
  useShell: boolean;
  riskReasons: string[];
}

interface OutputCapture {
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  outputBytes: number;
}

interface WorkingDirectory {
  absolutePath: string;
  relativePath: string;
}

interface SpawnResult extends OutputCapture {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

const META_CHARACTER_PATTERN = /[;&|><`$\n\r]/;
const DANGEROUS_EXECUTABLES = new Set(['rm', 'mv', 'cp', 'chmod', 'chown', 'sudo', 'su', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'bash', 'sh', 'zsh']);
const MINIMAL_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR'];
const CONFIRMATION_PREFIX = 'CONFIRM_SAFE_BASH';

function commandRejection(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('COMMAND_REJECTED', message, 403, details);
}

function dangerousFamily(tokens: string[]): string | null {
  const executable = tokens[0]?.toLowerCase();
  if (!executable) return null;
  if (DANGEROUS_EXECUTABLES.has(executable)) return executable;

  const subcommand = tokens[1]?.toLowerCase();
  if (executable === 'git' && (subcommand === 'reset' || subcommand === 'clean' || subcommand === 'push')) return `git ${subcommand}`;
  if (executable === 'npm' && subcommand === 'install') return 'npm install';
  if (executable === 'node' && subcommand === '-e') return 'node -e';
  if (executable === 'python' && subcommand === '-c') return 'python -c';
  if (executable === 'find' && tokens.some((token) => token.toLowerCase() === '-exec')) return 'find -exec';
  if (executable === 'xargs') return 'xargs';

  return null;
}

function isCommandAllowlisted(command: string, allowlist: readonly string[]): boolean {
  return allowlist.includes('*') || allowlist.includes(command);
}

export function createDangerousCommandConfirmationToken(command: string): string {
  const digest = crypto.createHash('sha256').update(command).digest('hex').slice(0, 16);
  return `${CONFIRMATION_PREFIX}:${digest}`;
}

function hasUserConfirmation(command: string, userPrompt: string | undefined): boolean {
  return (userPrompt ?? '').includes(createDangerousCommandConfirmationToken(command));
}

function commandRiskReasons(command: string, tokens: string[]): string[] {
  const reasons: string[] = [];
  if (META_CHARACTER_PATTERN.test(command)) reasons.push('shell metacharacter');

  const executable = tokens[0] ?? '';
  if (executable.includes('/') || executable.includes('\\')) reasons.push('executable path separator');

  const dangerous = dangerousFamily(tokens);
  if (dangerous) reasons.push(`dangerous command family: ${dangerous}`);

  return reasons;
}

function confirmationRequired(command: string, reasons: string[]): AppError {
  const confirmationToken = createDangerousCommandConfirmationToken(command);
  return new AppError('COMMAND_REQUIRES_CONFIRMATION', 'Command requires explicit user confirmation before execution.', 403, {
    command,
    reasons,
    confirmationToken,
    instruction: `Ask the user to confirm this exact command, then retry in a new request that includes: ${confirmationToken}`
  });
}

export function validateSafeCommand(command: string, allowlist: readonly string[], userPrompt?: string): ValidatedSafeCommand {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new AppError('INVALID_INPUT', 'command is required', 400);
  }

  const tokens = normalizedCommand.split(/\s+/);
  const executable = tokens[0];
  if (!executable) {
    throw new AppError('INVALID_INPUT', 'command is required', 400);
  }

  if (!isCommandAllowlisted(normalizedCommand, allowlist)) {
    throw new AppError('COMMAND_NOT_ALLOWED', 'Command is not in AGENT_BASH_ALLOWLIST', 403, { command: normalizedCommand });
  }

  const riskReasons = commandRiskReasons(normalizedCommand, tokens);
  if (riskReasons.length > 0 && !hasUserConfirmation(normalizedCommand, userPrompt)) {
    throw confirmationRequired(normalizedCommand, riskReasons);
  }

  return {
    command: normalizedCommand,
    executable,
    args: tokens.slice(1),
    useShell: META_CHARACTER_PATTERN.test(normalizedCommand),
    riskReasons
  };
}

function createMinimalEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of MINIMAL_ENV_KEYS) {
    const value = source[key];
    if (typeof value === 'string') env[key] = value;
  }
  if (!env.PATH) env.PATH = process.platform === 'win32' ? source.PATH ?? '' : '/usr/bin:/bin:/usr/sbin:/sbin';
  return env;
}

function commandEnv(config: AppConfig): NodeJS.ProcessEnv {
  return config.agentBash.inheritEnv ? { ...process.env } : createMinimalEnv(process.env);
}

function captureOutput(maxOutputBytes: number) {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let outputBytes = 0;
  let outputTruncated = false;

  function append(target: Buffer[], chunk: Buffer): void {
    if (outputBytes >= maxOutputBytes) {
      outputTruncated = true;
      return;
    }

    const remaining = maxOutputBytes - outputBytes;
    const stored = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    target.push(stored);
    outputBytes += stored.byteLength;
    if (stored.byteLength < chunk.byteLength) outputTruncated = true;
  }

  function result(): OutputCapture {
    return {
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      outputTruncated,
      outputBytes
    };
  }

  return {
    appendStdout: (chunk: Buffer) => append(stdoutChunks, chunk),
    appendStderr: (chunk: Buffer) => append(stderrChunks, chunk),
    result
  };
}

async function resolveWorkingDirectory(cwd: string, config: AppConfig): Promise<WorkingDirectory> {
  const resolved = await resolveAllowedPath(cwd, config, 'read');
  const absolutePath = resolved.realPath ?? resolved.absolutePath;
  const stat = await fs.stat(absolutePath);
  if (!stat.isDirectory()) {
    throw new AppError('NOT_A_DIRECTORY', 'cwd must be a directory', 400, { path: resolved.relativePathPosix });
  }
  return { absolutePath, relativePath: resolved.relativePathPosix };
}

function commandTimeoutMs(input: SafeBashInput, config: AppConfig): number {
  return Math.min(input.timeoutMs ?? config.agentBash.timeoutMs, config.agentBash.timeoutMs);
}

function runSafeCommand(command: ValidatedSafeCommand, cwd: string, config: AppConfig, timeoutMs: number): Promise<SpawnResult> {
  const startedAt = Date.now();
  const output = captureOutput(config.agentBash.maxOutputBytes);

  return new Promise((resolve, reject) => {
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const stdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];
    const env = commandEnv(config);
    const child = command.useShell
      ? spawn(command.command, [], { cwd, env, shell: true, stdio, windowsHide: true })
      : spawn(command.executable, command.args, { cwd, env, shell: false, stdio, windowsHide: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
    }

    function settle(fn: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    }

    child.stdout.on('data', (chunk: Buffer) => output.appendStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => output.appendStderr(chunk));

    child.on('error', (error) => {
      settle(() => reject(commandRejection('Command failed to start', { command: command.command, message: error.message })));
    });

    child.on('close', (exitCode, signal) => {
      const durationMs = Date.now() - startedAt;
      const captured = output.result();
      if (timedOut) {
        settle(() =>
          reject(
            new AppError('COMMAND_TIMEOUT', `Command timed out after ${timeoutMs}ms`, 408, {
              command: command.command,
              timeoutMs,
              stdout: captured.stdout,
              stderr: captured.stderr,
              outputTruncated: captured.outputTruncated,
              outputBytes: captured.outputBytes
            })
          )
        );
        return;
      }

      settle(() => resolve({ ...captured, exitCode, signal, durationMs }));
    });
  });
}

export function createSafeBashTool(): AgentToolDefinition<typeof safeBashInputSchema> {
  return {
    name: 'safe_bash',
    description:
      'Run one allowlisted command inside an allowed ROOTS directory. AGENT_BASH_ALLOWLIST=* allows any command. Dangerous command families and shell metacharacters require a confirmation code from the current user request.',
    inputSchema: safeBashInputSchema,
    modelParameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string', description: 'Command string. Must match AGENT_BASH_ALLOWLIST exactly unless AGENT_BASH_ALLOWLIST=*.' },
        cwd: { type: 'string', description: 'Working directory under ROOTS. Defaults to the agent cwd.' },
        timeoutMs: { type: 'number', description: 'Optional shorter timeout in milliseconds, capped by AGENT_BASH_TIMEOUT_MS.' }
      },
      required: ['command']
    },
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    isDestructive: () => false,
    async call(input, context) {
      const { config } = context;
      if (!config.agentBash.enabled) {
        throw new AppError('COMMAND_DISABLED', 'Safe Bash is disabled by AGENT_BASH_ENABLED=0', 403);
      }

      const command = validateSafeCommand(input.command, config.agentBash.allowlist, context.userPrompt);
      const cwd = await resolveWorkingDirectory(input.cwd ?? context.cwd, config);
      const timeoutMs = commandTimeoutMs(input, config);

      context.bashCommands.push(command.command);

      if (context.dryRun) {
        return {
          ok: true,
          dryRun: true,
          command: command.command,
          cwd: cwd.absolutePath,
          relativeCwd: cwd.relativePath,
          timeoutMs,
          useShell: command.useShell,
          riskReasons: command.riskReasons
        };
      }

      const result = await runSafeCommand(command, cwd.absolutePath, config, timeoutMs);
      return {
        ok: result.exitCode === 0,
        command: command.command,
        cwd: cwd.absolutePath,
        relativeCwd: cwd.relativePath,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        outputTruncated: result.outputTruncated,
        outputBytes: result.outputBytes,
        durationMs: result.durationMs,
        useShell: command.useShell,
        riskReasons: command.riskReasons
      };
    }
  };
}
