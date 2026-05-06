# Changelog

## 1.1.0

- 重构为更接近 cyanheads 风格的分层工程结构。
- 默认使用 ChatGPT / OpenAI Apps SDK 推荐的 `/mcp` Streamable HTTP 连接方式。
- 新增 `project_overview`、`append_file`、`server_config_summary`。
- 加入请求上下文、JSON 日志、速率限制、OAuth discovery 404。
- 加强 ROOTS 白名单、symlink 防逃逸、敏感路径拦截、写入分级和备份策略。
- 新增中文文档、Windows/Unix 脚本、node:test 安全测试。
