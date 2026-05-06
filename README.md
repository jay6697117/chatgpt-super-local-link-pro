# ChatGPT Super Local Link Pro

一个更接近成品形态的 **Node.js / TypeScript Remote MCP Server**，用于把 ChatGPT Developer Mode 安全连接到你本机白名单项目目录。

设计目标：

- 采用类似 cyanheads filesystem MCP 的分层工程结构：Transport / API / Core / Security / Filesystem Tools。
- 采用 OpenAI Apps SDK 推荐的连接方式：本地启动 `/mcp`，用 ngrok / Cloudflare Tunnel 暴露 HTTPS，再在 ChatGPT Connectors 创建连接器。
- 所有运行参数集中在 `.env`，默认只读、默认白名单、默认屏蔽敏感文件。
- 不提供 shell 执行，不提供删除，不读取 `.env`、密钥、数据库、构建产物、依赖目录。

## 快速开始

```bash
npm install
npm run doctor
npm run dev
```

另开终端：

```bash
ngrok http 2091
```

在 ChatGPT 中创建连接器：

```text
名称：超级本地链接 Pro
认证方式：No Authentication
URL：https://你的-ngrok-域名/mcp
```

## 修改白名单项目路径

编辑 `.env`：

```env
ROOTS=D:/work/JiaDianAI;D:/mcp-work/harmonyos-libretro-emulator
```

首次使用建议保持只读：

```env
ALLOW_WRITE=0
ALLOW_OVERWRITE=0
```

需要创建新文件/目录：

```env
ALLOW_WRITE=1
ALLOW_OVERWRITE=0
```

需要修改已有文件：

```env
ALLOW_WRITE=1
ALLOW_OVERWRITE=1
BACKUP_BEFORE_OVERWRITE=1
```

## 可用工具

- `list_allowed_roots`
- `project_overview`
- `directory_tree`
- `file_stat`
- `read_file`
- `read_many_files`
- `search_files`
- `create_directory`
- `write_file`
- `append_file`
- `replace_in_file`
- `server_config_summary`

## 文档

- [详细使用说明](docs/使用说明.md)
- [ChatGPT 连接指南](docs/ChatGPT连接指南.md)
- [环境变量说明](docs/环境变量说明.md)
- [工具清单](docs/工具清单.md)
- [安全策略](docs/安全策略.md)
- [二次开发说明](docs/二次开发说明.md)
- [故障排查](docs/故障排查.md)

## 推荐提示词

```text
使用“超级本地链接 Pro”读取我的项目。先调用 list_allowed_roots，再对 D:/work/JiaDianAI 调用 project_overview 和 directory_tree。不要读取 .env、密钥、数据库、node_modules、dist、.git。第一轮只输出项目结构、关键文件、技术栈判断和建议下一步读取哪些文件，不做任何写入。
```

## 安全提醒

这个项目会把本地目录通过 MCP 工具暴露给 ChatGPT。请始终使用 `ROOTS` 白名单，保持默认敏感文件排除策略，不要把整个磁盘作为 ROOTS，不要开启 shell 执行能力。
