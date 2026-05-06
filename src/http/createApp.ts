import cors from 'cors';
import express, { type Express } from 'express';

import type { AppConfig } from '../config/env.js';
import { publicConfigSummary } from '../config/env.js';
import type { Logger } from '../core/logger.js';
import { createRateLimiter } from '../security/rateLimit.js';
import { authMiddleware, notFoundOAuthDiscovery, requestContextMiddleware } from './middleware.js';
import { createLegacySseTransportManager } from './transports/legacySse.js';
import { createStreamableTransportManager } from './transports/streamable.js';

export interface HttpAppHandle {
  app: Express;
  close: () => Promise<void>;
}

export function createHttpApp(config: AppConfig, logger: Logger): HttpAppHandle {
  const app = express();
  const bodyLimitMb = Math.max(4, Math.ceil(config.maxWriteBytes / 1024 / 1024) + 2);
  const streamable = createStreamableTransportManager(config, logger);
  const legacySse = createLegacySseTransportManager(config, logger);

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(express.json({ limit: `${bodyLimitMb}mb` }));
  app.use(
    cors({
      origin: config.corsAllowedOrigins.includes('*') ? '*' : config.corsAllowedOrigins,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'authorization', 'last-event-id', 'x-request-id'],
      exposedHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version', 'x-request-id', 'WWW-Authenticate']
    })
  );
  app.use(requestContextMiddleware(logger));
  app.use(createRateLimiter(config));
  app.use(authMiddleware(config));

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      message: `${config.appName} is running. Use ${config.mcpPath} as the ChatGPT connector URL path.`,
      ...publicConfigSummary(config)
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString(), ...publicConfigSummary(config) });
  });

  if (config.enableDebugEndpoints) {
    app.get('/debug/config', (_req, res) => res.json(publicConfigSummary(config)));
  }

  app.get('/.well-known/oauth-authorization-server', notFoundOAuthDiscovery);
  app.get('/.well-known/openid-configuration', notFoundOAuthDiscovery);
  app.get('/.well-known/oauth-protected-resource', notFoundOAuthDiscovery);

  app.options(config.mcpPath, (_req, res) => {
    res.status(204).end();
  });
  app.all(config.mcpPath, streamable.handle);

  app.get(config.ssePath, legacySse.handleConnect);
  app.post(config.sseMessagesPath, legacySse.handleMessage);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Not Found' });
  });

  async function close(): Promise<void> {
    await Promise.all([streamable.close(), legacySse.close()]);
  }

  return { app, close };
}
