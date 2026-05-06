import fs from 'node:fs';
import path from 'node:path';

import type { AppConfig } from '../config/env.js';

const levelRank = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 } as const;
type LogLevel = keyof typeof levelRank;

export interface Logger {
  trace(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

function serializeMeta(meta: unknown): unknown {
  if (meta instanceof Error) {
    return { name: meta.name, message: meta.message, stack: meta.stack };
  }
  return meta;
}

export function createLogger(config: AppConfig): Logger {
  const minLevel = config.logLevel;
  const logPath = path.join(config.logDir, 'super-local-link.log');

  function emit(level: LogLevel, message: string, meta?: unknown): void {
    if (levelRank[level] < levelRank[minLevel]) return;
    const record = {
      time: new Date().toISOString(),
      level,
      message,
      ...(meta === undefined ? {} : { meta: serializeMeta(meta) })
    };
    const line = `${JSON.stringify(record)}\n`;
    if (level === 'error' || level === 'warn') process.stderr.write(line);
    else process.stdout.write(line);
    try {
      fs.appendFileSync(logPath, line, 'utf8');
    } catch {
      // Logging must never break MCP tool calls.
    }
  }

  return {
    trace: (message, meta) => emit('trace', message, meta),
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta)
  };
}
