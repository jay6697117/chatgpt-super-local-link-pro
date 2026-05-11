import crypto from 'node:crypto';

import type { AppConfig } from '../config/env.js';
import { toSafeError } from '../core/errors.js';
import { createFileStateCache, type FileStateCache } from './readFileState.js';
import { QueryEngine } from './queryEngine.js';
import type { ToolRegistry } from './toolRegistry.js';
import type { AgentMessage, AgentRunInput, AgentRunResult, ModelClient } from './types.js';

export interface AgentSessionOptions {
  id?: string;
  config: AppConfig;
  modelClient: ModelClient;
  toolRegistry: ToolRegistry;
}

export class AgentSession {
  readonly id: string;
  readonly messages: AgentMessage[] = [];
  readonly readFileState: FileStateCache = createFileStateCache();
  readonly createdAt = Date.now();
  updatedAt = Date.now();
  private readonly queryEngine: QueryEngine;

  constructor(options: AgentSessionOptions) {
    this.id = options.id || crypto.randomUUID();
    this.queryEngine = new QueryEngine({
      config: options.config,
      modelClient: options.modelClient,
      toolRegistry: options.toolRegistry
    });
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    this.updatedAt = Date.now();
    try {
      const result = await this.queryEngine.run(this, input);
      this.updatedAt = Date.now();
      return result;
    } catch (error) {
      this.updatedAt = Date.now();
      return {
        ok: false,
        sessionId: this.id,
        finalText: '',
        stopReason: 'error',
        turns: 0,
        toolCalls: [],
        filesRead: [],
        filesChanged: [],
        bashCommands: [],
        warnings: [],
        error: toSafeError(error)
      };
    }
  }
}

export interface AgentSessionManagerOptions {
  config: AppConfig;
  modelClient: ModelClient;
  toolRegistry: ToolRegistry;
  ttlMs: number;
  maxSessions: number;
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, AgentSession>();

  constructor(private readonly options: AgentSessionManagerOptions) {}

  getOrCreate(sessionId?: string): AgentSession {
    this.cleanup();
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) return existing;
    }

    while (this.sessions.size >= this.options.maxSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) break;
      this.sessions.delete(oldest.id);
    }

    const session = new AgentSession({
      id: sessionId,
      config: this.options.config,
      modelClient: this.options.modelClient,
      toolRegistry: this.options.toolRegistry
    });
    this.sessions.set(session.id, session);
    return session;
  }

  cleanup(now = Date.now()): void {
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.options.ttlMs) this.sessions.delete(id);
    }
  }
}
