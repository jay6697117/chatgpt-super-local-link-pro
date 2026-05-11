# Task Plan

## Goal
Transform the current guarded filesystem MCP server into a first-version ChatGPT Local Coding Agent MCP Server.

The MVP must add:
- `local_agent_run`
- `AgentSession`
- `ToolRegistry`
- per-session `readFileState`
- safe Bash with default-disabled, allowlist-only execution

## Constraints
- Preserve all existing filesystem MCP tools.
- Use `claude-copy-code/` only as local architecture reference; do not copy source and do not commit the clone.
- Keep default behavior safe: local agent disabled unless configured; Bash disabled unless configured.
- All filesystem access must still go through ROOTS/path guard security.
- Existing-file edits/overwrites inside the agent must require a prior full read and stale-read check.
- Safe Bash must not use arbitrary shell execution.
- Tests must not require a real model API key; use fake model clients.

## Phases
| Phase | Status | Notes |
|---|---|---|
| 1. Planning and safety hygiene | complete | Updated planning files and ignored `claude-copy-code/`. |
| 2. Config and error code expansion | complete | Added local agent and safe Bash env config with safe defaults plus error codes. |
| 3. readFileState and filesystem wrappers | complete | Added per-session read state and strict agent file tools. |
| 4. ToolRegistry, ModelClient, AgentSession, QueryEngine | complete | Added headless local coding agent loop with fake-model-testable abstraction. |
| 5. Safe Bash | complete | Added default-disabled allowlist command runner. |
| 6. MCP registration | complete | Added `local_agent_run` while preserving current tools. |
| 7. Tests and verification | complete | Added node:test coverage; build/test/doctor/check passed. |
| 8. Documentation updates | complete | Updated README and docs for local agent and safe Bash. |

## Files to Modify
- `.gitignore`
- `src/config/env.ts`
- `src/core/errors.ts`
- `src/mcp/createServer.ts`
- `src/mcp/tools/registerAgent.ts`
- `src/agent/types.ts`
- `src/agent/modelClient.ts`
- `src/agent/readFileState.ts`
- `src/agent/toolRegistry.ts`
- `src/agent/agentSession.ts`
- `src/agent/queryEngine.ts`
- `src/agent/tools/filesystem.ts`
- `src/agent/tools/safeBash.ts`
- `tests/readFileState.test.ts`
- `tests/safeBash.test.ts`
- `tests/agentSession.test.ts`
- `tests/localAgentRun.test.ts`
- `README.md`
- `.env.example`
- `docs/工具清单.md`
- `docs/安全策略.md`
- `docs/环境变量说明.md`

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| None yet | - | - |
