# 该文件的使用方法：每次只完成最前面的一个需求，完成之后将这个需求删除。完成功能后需要按照test_guide.md进行测试。如果影响了系统架构，则依据代码的改动修改README.md的内容。

------

二、 上下文管理 (Context & Token Management)
如何让 Agent 在有限的长文本窗口内处理大型项目。
消息生命周期管理：

支持对消息进行标签（Tags）标记和持久化。

支持会话分叉（Fork），从历史中的某一点开始新的尝试。

三、 安全与控制 (Security & Permissions)
确保 AI 不会对代码库造成不可逆的破坏。

环境隔离 (Environment Isolation)：

支持在特定容器或受限 Shell 环境中运行。

四、 开发者工具链 (Developer Toolset)
Agent 能够调用的“手”。

MCP 扩展能力 (Model Context Protocol)：

集成外部 MCP 服务器，支持访问第三方工具（如 GitHub API, 数据库）。