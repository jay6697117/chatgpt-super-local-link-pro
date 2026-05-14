import type { z } from 'zod';

import type { AppConfig } from '../config/env.js';
import type { FileStateCache } from './readFileState.js';

export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentToolResult {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  content: string;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface AgentModelTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelCompleteInput {
  model: string;
  messages: AgentMessage[];
  tools: AgentModelTool[];
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface ModelCompleteResult {
  content: string;
  toolCalls: AgentToolCall[];
  usage?: Record<string, unknown>;
}

export interface ModelClient {
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult>;
}

export interface AgentRunInput {
  prompt: string;
  path?: string;
  sessionId?: string;
  maxTurns?: number;
  maxToolCalls?: number;
  dryRun?: boolean;
}

export interface AgentToolTrace {
  id: string;
  name: string;
  ok: boolean;
  input?: unknown;
  outputPreview?: string;
  error?: Record<string, unknown>;
}

export interface AgentRunResult {
  ok: boolean;
  sessionId: string;
  finalText: string;
  stopReason: 'final' | 'max_turns' | 'max_tool_calls' | 'error';
  turns: number;
  toolCalls: AgentToolTrace[];
  filesRead: string[];
  filesChanged: string[];
  bashCommands: string[];
  warnings: string[];
  usage?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface AgentToolContext {
  config: AppConfig;
  cwd: string;
  dryRun: boolean;
  readFileState: FileStateCache;
  filesRead: Set<string>;
  filesChanged: Set<string>;
  bashCommands: string[];
  userPrompt?: string;
  signal?: AbortSignal;
}

export interface AgentToolDefinition<Input extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: Input;
  modelParameters: Record<string, unknown>;
  isReadOnly(input: z.infer<Input>): boolean;
  isConcurrencySafe(input: z.infer<Input>): boolean;
  isDestructive?(input: z.infer<Input>): boolean;
  call(input: z.infer<Input>, context: AgentToolContext): Promise<Record<string, unknown>>;
}
