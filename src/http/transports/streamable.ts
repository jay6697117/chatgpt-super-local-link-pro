import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../../config/env.js';
import { toSafeError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { createMcpServer } from '../../mcp/createServer.js';

type StatefulSession = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface StreamableTransportManager {
  handle: (req: Request, res: Response) => Promise<void>;
  close: () => Promise<void>;
}

export function createStreamableTransportManager(config: AppConfig, logger: Logger): StreamableTransportManager {
  const sessions = new Map<string, StatefulSession>();

  async function handleStateless(req: Request, res: Response): Promise<void> {
    const server = createMcpServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: config.mcpEnableJsonResponse
    });

    res.on('close', () => {
      transport.close().catch((error: unknown) => logger.warn('Error closing stateless MCP transport', error));
      server.close().catch((error: unknown) => logger.warn('Error closing stateless MCP server', error));
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async function handleStateful(req: Request, res: Response): Promise<void> {
    const sessionId = headerValue(req.headers['mcp-session-id']);

    if (req.method === 'POST') {
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        let transportRef: StreamableHTTPServerTransport;
        const server = createMcpServer(config);
        transportRef = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: config.mcpEnableJsonResponse,
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, { transport: transportRef, server });
            logger.info('MCP stateful session initialized', { sessionId: newSessionId });
          }
        });
        transportRef.onclose = () => {
          const closedSessionId = transportRef.sessionId;
          if (closedSessionId) sessions.delete(closedSessionId);
          logger.info('MCP stateful session closed', { sessionId: closedSessionId });
        };
        await server.connect(transportRef);
        await transportRef.handleRequest(req, res, req.body);
        return;
      }

      if (sessionId) {
        jsonRpcError(res, 404, -32001, 'MCP session not found. Refresh the connector or re-open the chat.');
      } else {
        jsonRpcError(res, 400, -32000, 'Missing MCP session ID and request is not initialize.');
      }
      return;
    }

    if (!sessionId) {
      res.status(400).send('Missing Mcp-Session-Id header');
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).send('MCP session not found');
      return;
    }
    await session.transport.handleRequest(req, res);
  }

  async function handle(req: Request, res: Response): Promise<void> {
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
      res.status(405).setHeader('Allow', 'GET, POST, DELETE').send('Method not allowed');
      return;
    }
    try {
      if (config.mcpStatefulSessions) await handleStateful(req, res);
      else await handleStateless(req, res);
    } catch (error) {
      logger.error('Error handling Streamable HTTP MCP request', error);
      if (!res.headersSent) {
        const safe = toSafeError(error);
        jsonRpcError(res, safe.status >= 500 ? 500 : safe.status, -32603, safe.message);
      }
    }
  }

  async function close(): Promise<void> {
    for (const [sessionId, session] of sessions.entries()) {
      try {
        await session.transport.close();
        await session.server.close();
      } catch (error) {
        logger.warn('Error closing MCP stateful session', { sessionId, error });
      }
      sessions.delete(sessionId);
    }
  }

  return { handle, close };
}
