# ChatGPT 连接指南

## 结论先看

ChatGPT 连接器里最重要的两项是：

```text
MCP 服务器 URL：https://你的公网域名/mcp
身份验证：No Authentication / 无身份验证
```

不要只填 ngrok 根域名，必须带上 `/mcp`。不要选择 OAuth，因为本项目当前没有实现 OAuth 授权流程。

## 推荐连接方式

本项目推荐使用 Streamable HTTP，入口路径由 `.env` 里的 `MCP_PATH` 控制，默认是：

```text
/mcp
```

所以 ChatGPT 里的完整 MCP 服务器 URL 应该是：

```text
https://你的公网域名/mcp
```

本地测试地址是：

```text
http://127.0.0.1:2091/mcp
```

其中 `2091` 来自 `.env` 的 `PORT=2091`。

## 启动本地服务

在项目目录运行：

```bash
npm install
npm run doctor
npm run dev
```

本地服务默认监听：

```text
http://127.0.0.1:2091
```

可先打开或请求健康检查：

```text
http://127.0.0.1:2091/health
```

如果 `.env` 修改过，必须重启 `npm run dev`。

## 暴露公网 HTTPS

ChatGPT 连接器需要公网 HTTPS。开发时可以使用 ngrok：

```bash
ngrok http 2091
```

看到类似输出：

```text
Forwarding  https://abc123.ngrok-free.app -> http://localhost:2091
```

那么 ChatGPT 里填写的 MCP 服务器 URL 是：

```text
https://abc123.ngrok-free.app/mcp
```

注意：免费 ngrok 每次重启可能换域名，域名变了以后需要回 ChatGPT 连接器里更新 URL。

## ChatGPT 新建连接器填写方式

在 ChatGPT 的 Apps / Connectors / Developer Mode 里创建自定义连接器时，建议这样填：

```text
名称：超级本地链接 Pro
描述：安全读取和可选编辑本机 ROOTS 白名单项目目录
MCP 服务器 URL：https://你的-ngrok-域名/mcp
身份验证：No Authentication / 无身份验证
```

图标可以不填。

如果页面显示风险提示，需要确认你理解自定义 MCP 服务器的风险后再创建。

## 不要这样填

错误示例 1：少了 `/mcp`

```text
https://abc123.ngrok-free.app
```

正确写法：

```text
https://abc123.ngrok-free.app/mcp
```

错误示例 2：选择 OAuth

```text
身份验证：OAuth
```

正确写法：

```text
身份验证：No Authentication / 无身份验证
```

原因：本项目的 OAuth discovery 路由会明确返回 404，并提示使用 No Authentication 或自行实现 OAuth。

## 旧版 SSE 入口

项目默认保留旧版 SSE 兼容入口：

```text
/sse
/messages
```

ChatGPT 新连接器优先使用 `/mcp`，一般不要把 `/sse` 填到 ChatGPT 里。

## 更新工具或配置后刷新

如果你修改了以下内容：

- 工具名称
- 工具描述
- 工具参数 schema
- `.env`
- `ROOTS`
- 写入开关

请按顺序操作：

1. 重启本地服务。
2. 打开 ChatGPT 连接器设置。
3. 点击 Refresh / 刷新。
4. 新开一个对话测试。

## MCP Inspector 测试

启动本地服务后可以运行：

```bash
npm run mcp:inspector
```

等价于：

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:2091/mcp --transport http
```

如果 Inspector 能连接，但 ChatGPT 不能连接，通常是 ChatGPT 里的公网 URL、ngrok、认证方式或 `/mcp` 路径配置错了。
