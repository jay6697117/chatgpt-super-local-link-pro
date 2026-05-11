# Findings

## Reference repository
- `claude-copy-code/` was cloned locally only for architecture research.
- It is a reverse-sourcemap reconstruction, not official upstream source.
- Use it for patterns only: QueryEngine/session state, Tool contract, tool execution lifecycle, read-before-write, stale check, safe Bash concepts.
- Do not copy code from it and do not commit the clone.

## Current project baseline
- Current MCP server creation is in `src/mcp/createServer.ts`.
- Existing filesystem tool registration is in `src/mcp/tools/register.ts`.
- Existing filesystem operations are in `src/filesystem/service.ts`.
- Path security is centralized in `src/security/pathGuards.ts` via `resolveAllowedPath`.
- Config loading is in `src/config/env.ts`.
- Error serialization is in `src/core/errors.ts`.
- Existing tests use Node test runner with tsx, script: `npm test`.

## Key design decisions
- Add a new `src/agent/` subsystem instead of mixing agent logic into existing filesystem MCP tools.
- Keep existing public filesystem MCP tools available.
- Make agent-internal write/replace stricter than current direct MCP write tools.
- Add `local_agent_run` as the high-level MCP entrypoint.
- Use an OpenAI-compatible model client abstraction based on Node 20 `fetch`; tests use fake model clients.
- Safe Bash is default-disabled and allowlist-only.
- Agent sessions are process-memory only for MVP; no transcript persistence to disk.

## Documentation update targets
- `docs/工具清单.md` currently documents only filesystem tools; it needs `local_agent_run` after implementation.
- `docs/安全策略.md` currently says the project deliberately does not provide shell execution; this must change to explain default-disabled safe Bash.
- `docs/环境变量说明.md` currently lacks local agent and safe Bash env fields.

## Security rules to preserve
- All paths must stay within ROOTS.
- Symlink escape must remain blocked.
- Sensitive/default blocked paths stay blocked.
- Existing file edit/overwrite inside agent requires prior full read and stale check.
- Bash must reject shell metacharacters, command paths, dangerous command families, and non-allowlisted commands.
