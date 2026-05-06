import type { Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../../config/env.js';
import type { Logger } from '../../core/logger.js';
import { createMcpServer } from '../../mcp/createServer.js';

type SseSession = {
  transport: SSEServerTransport;
  server: McpServer;
};

function queryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export interface LegacySseTransportManager {
  handleConnect: (req: Request, res: Response) => Promise<void>;
  handleMessage: (req: Request, res: Response) => Promise<void>;
  close: () => Promise<void>;
}

export function createLegacySseTransportManager(config: AppConfig, logger: Logger): LegacySseTransportManager {
  const sessions = new Map<string, SseSession>();

  async function handleConnect(_req: Request, res: Response): Promise<void> {
    if (!config.enableLegacySse) {
      res.status(404).send('Legacy SSE is disabled. Use /mcp.');
      return;
    }
    try {
      const transport = new SSEServerTransport(config.sseMessagesPath, res);
      const server = createMcpServer(config);
      sessions.set(transport.sessionId, { transport, server });
      logger.info('Legacy SSE MCP session initialized', { sessionId: transport.sessionId });
      res.on('close', () => {
        sessions.delete(transport.sessionId);
        server.close().catch((error: unknown) => logger.warn('Error closing SSE server', error));
      });
      await server.connect(transport);
    } catch (error) {
      logger.error('Error opening legacy SSE transport', error);
      if (!res.headersSent) res.status(500).send(error instanceof Error ? error.message : 'Internal server error');
    }
  }

  async function handleMessage(req: Request, res: Response): Promise<void> {
    const sessionId = queryValue(req.query.sessionId);
    if (!sessionId) {
      res.status(400).send('Missing sessionId query parameter');
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).send('SSE session not found');
      return;
    }
    try {
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logger.error('Error handling legacy SSE message', error);
      if (!res.headersSent) res.status(500).send(error instanceof Error ? error.message : 'Internal server error');
    }
  }

  async function close(): Promise<void> {
    for (const [sessionId, session] of sessions.entries()) {
      try {
        await session.transport.close();
        await session.server.close();
      } catch (error) {
        logger.warn('Error closing legacy SSE session', { sessionId, error });
      }
      sessions.delete(sessionId);
    }
  }

  return { handleConnect, handleMessage, close };
}
