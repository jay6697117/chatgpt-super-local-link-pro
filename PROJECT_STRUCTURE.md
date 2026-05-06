# Project Structure

```text
chatgpt-super-local-link-pro/
  .env                         默认配置，安全只读
  .env.example                 配置模板
  README.md                    快速说明
  AGENTS.md                    给代码代理的开发约束
  docs/                        中文详细文档
  scripts/                     Windows / Unix 启动脚本
  src/
    config/env.ts              环境变量加载和 Zod 校验
    core/errors.ts             应用错误
    core/logger.ts             JSON 日志
    core/requestContext.ts     请求上下文
    filesystem/service.ts      文件系统工具实现
    filesystem/types.ts        工具选项类型
    http/createApp.ts          Express 应用
    http/middleware.ts         认证、请求上下文、OAuth 404
    http/transports/           Streamable HTTP 和旧版 SSE
    mcp/createServer.ts        MCP Server 实例
    mcp/tools/register.ts      工具注册
    security/pathGuards.ts     ROOTS 白名单和 symlink 防逃逸
    security/rateLimit.ts      简单速率限制
    scripts/doctor.ts          配置检查
  tests/                       node:test 安全测试
  workspace/                   默认安全沙盒目录
```
