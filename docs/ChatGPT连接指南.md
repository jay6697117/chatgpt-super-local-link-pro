# ChatGPT 连接指南

## 推荐连接方式

使用 Streamable HTTP：

```text
https://你的公网域名/mcp
```

本项目默认启用 `/mcp`，并额外保留旧版 SSE 兼容入口：

```text
/sse
/messages
```

ChatGPT 新连接器优先使用 `/mcp`。

## 本地开发

```bash
npm run dev
ngrok http 2091
```

连接器 URL：

```text
https://xxx.ngrok.app/mcp
```

## ChatGPT 设置

- Connector name：超级本地链接 Pro
- Description：安全读取和可选编辑本机白名单项目目录
- Authentication：No Authentication
- Connector URL：`https://xxx.ngrok.app/mcp`

## 更新工具后刷新

如果你修改了工具名称、描述、schema 或 `.env` 后重启服务：

1. 打开 ChatGPT 设置中的连接器。
2. 点击 Refresh。
3. 新开一个对话测试。

## MCP Inspector 测试

启动服务后：

```bash
npm run mcp:inspector
```

也可以显式指定：

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:2091/mcp --transport http
```
