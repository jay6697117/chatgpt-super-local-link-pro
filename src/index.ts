import http from 'node:http';

import { loadConfig } from './config/env.js';
import { createLogger } from './core/logger.js';
import { createHttpApp } from './http/createApp.js';

const config = loadConfig();
const logger = createLogger(config);
const { app, close } = createHttpApp(config, logger);
const server = http.createServer(app);

server.listen(config.port, config.host, () => {
  logger.info('Super Local Link MCP server started', {
    localUrl: `http://${config.host}:${config.port}${config.mcpPath}`,
    healthUrl: `http://${config.host}:${config.port}/health`,
    authMode: config.authMode,
    statefulSessions: config.mcpStatefulSessions,
    legacySse: config.enableLegacySse,
    allowedRoots: config.allowedRoots.map((root) => root.path),
    writePolicy: {
      allowWrite: config.allowWrite,
      allowOverwrite: config.allowOverwrite,
      dryRunWrite: config.dryRunWrite
    }
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}; shutting down.`);
  server.close(async (error?: Error) => {
    if (error) logger.error('HTTP server close error', error);
    await close();
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error('uncaughtException', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
  process.exit(1);
});
