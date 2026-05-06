import fs from 'node:fs';
import path from 'node:path';

import { loadConfig, publicConfigSummary } from '../config/env.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const config = loadConfig();

assert(config.allowedRoots.length > 0, 'No allowed roots configured.');
for (const root of config.allowedRoots) {
  assert(fs.existsSync(root.path), `Allowed root does not exist: ${root.path}`);
  assert(fs.statSync(root.path).isDirectory(), `Allowed root is not a directory: ${root.path}`);
}
assert(config.mcpPath.startsWith('/'), 'MCP_PATH must start with /.');
assert(config.authMode === 'no-auth' || config.authToken.length >= 16, 'AUTH_MODE=bearer requires AUTH_TOKEN length >= 16.');
assert(config.defaultTreeDepth <= config.maxTreeDepth, 'DEFAULT_TREE_DEPTH must be <= MAX_TREE_DEPTH.');
assert(config.maxReadBytes <= config.maxReadManyTotalBytes || config.maxReadManyFiles === 1, 'MAX_READ_MANY_TOTAL_BYTES is smaller than MAX_READ_BYTES.');

const logDir = path.resolve(config.logDir);
fs.mkdirSync(logDir, { recursive: true });
assert(fs.statSync(logDir).isDirectory(), `LOG_DIR is not a directory: ${logDir}`);

console.log('✅ Doctor check passed');
console.log(JSON.stringify(publicConfigSummary(config), null, 2));
