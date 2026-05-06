# AGENTS.md

本仓库是一个本地文件系统 MCP Server。修改时请遵守：

1. 默认安全优先，不新增命令执行、删除文件、读取 secrets 的能力。
2. 所有本地路径都必须经过 `resolveAllowedPath`。
3. 写操作必须受 `ALLOW_WRITE`、`ALLOW_OVERWRITE`、`DRY_RUN_WRITE` 控制。
4. 工具描述必须清晰，让 ChatGPT 能判断何时调用。
5. 新增工具后更新 `docs/工具清单.md` 和 README。
6. 提交前运行：

```bash
npm run build
npm test
npm run doctor
```
