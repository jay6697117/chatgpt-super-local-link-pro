import type { NextFunction, Request, Response } from 'express';

import type { AppConfig } from '../config/env.js';

interface Bucket {
  resetAt: number;
  count: number;
}

export function createRateLimiter(config: AppConfig) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.rateLimitWindowMs || !config.rateLimitMax) return next();

    const key = `${req.ip ?? 'unknown'}:${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { resetAt: now + config.rateLimitWindowMs, count: 1 });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > config.rateLimitMax) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
      return;
    }

    return next();
  };
}
