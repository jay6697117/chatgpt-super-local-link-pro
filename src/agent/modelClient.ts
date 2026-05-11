import { AppError } from '../core/errors.js';
import type { AgentMessage, AgentToolCall, ModelClient, ModelCompleteInput, ModelCompleteResult } from './types.js';

export interface OpenAIChatCompletionsClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function contentToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const record = asRecord(part);
        return typeof record?.text === 'string' ? record.text : '';
      })
      .join('');
  }
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n... [truncated to ${maxBytes} bytes]`;
}

function toOpenAIMessage(message: AgentMessage): JsonRecord {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.input ?? {})
        }
      }))
    };
  }

  return {
    role: message.role,
    content: message.content
  };
}

function parseToolCalls(rawToolCalls: unknown): AgentToolCall[] {
  if (!Array.isArray(rawToolCalls)) return [];
  const toolCalls: AgentToolCall[] = [];

  rawToolCalls.forEach((rawToolCall, index) => {
    const record = asRecord(rawToolCall);
    const fn = asRecord(record?.function);
    const name = typeof fn?.name === 'string' ? fn.name : '';
    if (!name) return;

    const rawArguments = typeof fn?.arguments === 'string' ? fn.arguments : '{}';
    let input: unknown;
    try {
      input = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    } catch {
      input = rawArguments;
    }

    toolCalls.push({
      id: typeof record?.id === 'string' ? record.id : `tool_call_${index + 1}`,
      name,
      input
    });
  });

  return toolCalls;
}

async function parseResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    const text = await response.text().catch(() => '');
    throw new AppError('MODEL_REQUEST_FAILED', `Model response was not valid JSON: ${text.slice(0, 500)}`, 502);
  }
}

export class OpenAIChatCompletionsModelClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIChatCompletionsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body: JsonRecord = {
      model: input.model,
      messages: input.messages.map(toOpenAIMessage)
    };
    if (input.tools.length > 0) {
      body.tools = input.tools;
      body.tool_choice = 'auto';
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: input.signal
      });
    } catch (error) {
      throw new AppError('MODEL_REQUEST_FAILED', `Model request failed: ${error instanceof Error ? error.message : String(error)}`, 502);
    }

    const payload = await parseResponseJson(response);
    if (!response.ok) {
      const record = asRecord(payload);
      const message = contentToString(asRecord(record?.error)?.message ?? record?.error ?? payload);
      throw new AppError('MODEL_REQUEST_FAILED', `Model request failed with HTTP ${response.status}: ${message}`, 502, { status: response.status });
    }

    const payloadRecord = asRecord(payload);
    const choices = Array.isArray(payloadRecord?.choices) ? payloadRecord.choices : [];
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice?.message);
    if (!message) throw new AppError('MODEL_REQUEST_FAILED', 'Model response did not include a chat message.', 502);

    return {
      content: truncateUtf8(contentToString(message.content), input.maxOutputBytes),
      toolCalls: parseToolCalls(message.tool_calls),
      usage: asRecord(payloadRecord?.usage) ?? undefined
    };
  }
}

export const OpenAICompatibleModelClient = OpenAIChatCompletionsModelClient;

export function createOpenAICompatibleModelClient(options: OpenAIChatCompletionsClientOptions): OpenAIChatCompletionsModelClient {
  return new OpenAIChatCompletionsModelClient(options);
}
