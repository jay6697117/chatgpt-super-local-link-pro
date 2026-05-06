# Progress

## 2026-05-06
- Started docs update task.
- Ran session catchup; no previous planning files existed.
- Listed docs directory and confirmed 7 existing docs files.
- Confirmed current task scope: update existing docs only; do not modify `.env` or source code.

## Current findings
- Read all 7 docs files.
- Confirmed source supports `no-auth` and optional `bearer`; OAuth discovery endpoints intentionally return 404.
- Confirmed HTTP app exposes `/`, `/health`, optional `/debug/config`, `/mcp`, legacy `/sse`, and `/messages`.
- Confirmed tool list from `src/mcp/tools/register.ts` matches existing docs but several parameter names/details need clarification.

## Next
- Edit existing docs for consistency.
- Search docs after edits for stale URL/auth/config wording.
