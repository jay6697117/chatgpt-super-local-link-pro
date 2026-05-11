import { z } from 'zod';

import { AppError, toSafeError } from '../core/errors.js';
import { createFilesystemTools } from './tools/filesystem.js';
import { createSafeBashTool } from './tools/safeBash.js';
import type { AgentModelTool, AgentToolContext, AgentToolDefinition, AgentToolResult } from './types.js';

export interface ToolRegistryOptions {
  extraTools?: AgentToolDefinition[];
  maxResultBytes?: number;
}

type AnyToolDefinition = AgentToolDefinition<z.ZodTypeAny>;

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return { text, truncated: false };
  const suffix = `\n... [truncated to ${maxBytes} bytes]`;
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const sliceBytes = Math.max(0, maxBytes - suffixBytes);
  return { text: `${buffer.subarray(0, sliceBytes).toString('utf8')}${suffix}`, truncated: true };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Tool result could not be serialized' } }, null, 2);
  }
}

function validationDetails(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message
    }))
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();
  private readonly maxResultBytes: number;

  constructor(tools: AnyToolDefinition[] = [], options: Omit<ToolRegistryOptions, 'extraTools'> = {}) {
    this.maxResultBytes = options.maxResultBytes ?? 65536;
    for (const tool of tools) this.register(tool);
  }

  register(tool: AnyToolDefinition): void {
    if (this.tools.has(tool.name)) throw new AppError('INVALID_INPUT', `Duplicate agent tool registered: ${tool.name}`, 500);
    this.tools.set(tool.name, tool);
  }

  toModelTools(): AgentModelTool[] {
    return [...this.tools.values()].map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.modelParameters
      }
    }));
  }

  async executeToolCall(toolCall: { id: string; name: string; input: unknown }, context: AgentToolContext): Promise<AgentToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      const error = toSafeError(new AppError('INVALID_INPUT', `Unknown agent tool: ${toolCall.name}`, 400));
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        ok: false,
        content: safeJson({ ok: false, error }),
        error
      };
    }

    try {
      let rawInput = toolCall.input;
      if (typeof rawInput === 'string') {
        try {
          rawInput = JSON.parse(rawInput);
        } catch (error) {
          throw new AppError('INVALID_INPUT', `Tool arguments for ${tool.name} must be valid JSON.`, 400, {
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      const parsed = tool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new AppError('INVALID_INPUT', `Invalid input for agent tool ${tool.name}`, 400, validationDetails(parsed.error));
      }

      const data = await tool.call(parsed.data, context);
      const ok = data.ok !== false;
      const serialized = truncateUtf8(safeJson(data), this.maxResultBytes);
      return {
        toolCallId: toolCall.id,
        toolName: tool.name,
        ok,
        content: serialized.text,
        data: serialized.truncated ? { ok, truncated: true } : data
      };
    } catch (error) {
      const safe = toSafeError(error);
      const content = truncateUtf8(safeJson({ ok: false, error: safe }), this.maxResultBytes).text;
      return {
        toolCallId: toolCall.id,
        toolName: tool.name,
        ok: false,
        content,
        error: safe
      };
    }
  }
}

export function createAgentToolRegistry(config: AgentToolContext['config'], options: ToolRegistryOptions = {}): ToolRegistry {
  return new ToolRegistry([...createFilesystemTools(config), createSafeBashTool(), ...(options.extraTools ?? [])], {
    maxResultBytes: options.maxResultBytes ?? config.localAgent.maxOutputBytes
  });
}

export { toSafeError };
