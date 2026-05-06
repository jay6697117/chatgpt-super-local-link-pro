import type { NextFunction, Request, Response } from 'express';

import type { AppConfig } from '../config/env.js';
import type { Logger } from '../core/logger.js';
import { runWithRequestContext } from '../core/requestContext.js';

export function authMiddleware(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (config.authMode === 'no-auth') return next();
    const protectedPaths = new Set([config.mcpPath, config.ssePath, config.sseMessagesPath]);
    if (!protectedPaths.has(req.path)) return next();

    const expected = `Bearer ${config.authToken}`;
    if (req.header('authorization') === expected) return next();
    res.setHeader('WWW-Authenticate', 'Bearer realm="super-local-link"');
    res.status(401).json({ ok: false, error: 'Unauthorized' });
  };
}

export function requestContextMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header('x-request-id') ?? undefined;
    runWithRequestContext(() => {
      const started = Date.now();
      res.setHeader('x-request-id', requestId ?? 'generated');
      res.on('finish', () => {
        logger.debug('http_request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started
        });
      });
      next();
    }, requestId);
  };
}

export function notFoundOAuthDiscovery(_req: Request, res: Response) {
  res.status(404).json({ ok: false, error: 'OAuth discovery is not configured. Use No Authentication or implement OAuth before enabling it.' });
}
