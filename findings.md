# Findings

## Session catchup
- Previous context emphasized that ChatGPT connector URL must include `/mcp`.
- Authentication should be `No Authentication`, not OAuth, because this project currently uses `AUTH_MODE=no-auth` and OAuth discovery routes intentionally return 404.

## Current observed state
- `git diff --stat` shows only `.env` has an existing local change; this task should not modify `.env`.
- Existing docs files: `ChatGPT连接指南.md`, `安全策略.md`, `二次开发说明.md`, `工具清单.md`, `故障排查.md`, `环境变量说明.md`, `使用说明.md`.
- `package.json` scripts include `dev`, `build`, `start`, `doctor`, `test`, `check`, and `mcp:inspector` using `http://localhost:2091/mcp`.
- `.env` defaults currently observed: `PORT=2091`, `HOST=127.0.0.1`, `MCP_PATH=/mcp`, `AUTH_MODE=no-auth`, `ROOTS=./workspace`, `ALLOW_RELATIVE_PATHS=1`.

## Required documentation alignment
- Public ChatGPT connector URL format: `https://你的公网域名/mcp`.
- Local MCP URL format: `http://127.0.0.1:2091/mcp`.
- ChatGPT connector authentication: `No Authentication` / `无身份验证`.
- OAuth settings should be documented as not configured unless implemented later.
- `ENABLE_LEGACY_SSE=1` keeps `/sse` and `/messages` available for legacy clients, but ChatGPT should use `/mcp`.
- `.env` includes additional documented defaults that docs should cover: `TRUST_PROXY`, `LOG_LEVEL`, `LOG_DIR`, `HTTP_RATE_LIMIT_WINDOW_MS`, `HTTP_RATE_LIMIT_MAX`, `MAX_SEARCH_RESULT_LINE_CHARS`, `MAX_PROJECT_OVERVIEW_FILES`, `ENABLE_DEBUG_ENDPOINTS`.
- Current local `.env` value for `ROOTS` is `/Users/zhangjinhui/Desktop`, but the code default remains `./workspace`; docs should describe default and safe examples rather than copy a broad local path.
