# 该文件的使用方法：每次只完成最前面的一个需求，完成之后将这个需求删除。完成功能后需要按照test_guide.md进行测试。如果影响了系统架构，则依据代码的改动修改README.md的内容。

------

一、 核心运行引擎 (Core Execution Engine)
Agent 的“大脑”如何思考和采取行动。


容错与重试逻辑 (Retry & Revert)：

LLM 输出格式错误或工具执行失败时，自动触发重试。

支持“撤回”逻辑，将消息历史回退到某个状态。

二、 上下文管理 (Context & Token Management)
如何让 Agent 在有限的长文本窗口内处理大型项目。

动态上下文压缩 (Compaction/Summarization)：

当 Token 接近上限时，自动对旧的交互历史进行摘要总结。

保留关键决策和当前状态，丢弃冗余的中间过程。

代码感知提示词 (Project-Aware Prompting)：

根据当前工作目录自动构建系统提示词。

注入项目的元数据（文件结构、语言、依赖关系）。

消息生命周期管理：

支持对消息进行标签（Tags）标记和持久化。

支持会话分叉（Fork），从历史中的某一点开始新的尝试。

三、 安全与控制 (Security & Permissions)
确保 AI 不会对代码库造成不可逆的破坏。

细粒度权限拦截 (Permission Gate)：

区分“读操作”和“写操作”。

对敏感工具（如 bash, write, delete）强制触发用户手动确认。

环境隔离 (Environment Isolation)：

支持在特定容器或受限 Shell 环境中运行。

操作预览 (Dry Run / Proposal)：

Agent 在实际修改文件前，先生成 Diff 或计划书供用户审批。

四、 开发者工具链 (Developer Toolset)
Agent 能够调用的“手”。

文件系统操作 (File Ops)：

ls (列出目录)、read (读取文件)、write (写文件)。

glob / ripgrep：高性能的全局搜索和模式匹配。

智能代码编辑 (Search & Replace)：

提供局部编辑工具（如基于字符串匹配的替换），而不是每次重写整个文件，以节省 Token。

语言服务器集成 (LSP Integration)：

通过 LSP 获取类型定义、符号引用、跳转到定义等精确信息，提升 Agent 的代码理解力。

终端执行 (Bash Tool)：

Agent 可直接运行编译、测试命令（npm test, cargo build）并获取报错信息进行修复。

MCP 扩展能力 (Model Context Protocol)：

集成外部 MCP 服务器，支持访问第三方工具（如 GitHub API, 数据库）。