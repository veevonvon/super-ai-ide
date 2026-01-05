# Super AI IDE

A powerful AI coding assistant extension for VS Code, powered by **LangGraph** and **OpenRouter**.

## ✨ Features

- 🤖 **AI Chat Sidebar** - Markdown rendering with syntax highlighting
- 🔧 **LangGraph Agent** - Automatic tool calling with ReAct pattern
- 📁 **File System Operations** - Read, write, create, delete, rename files
- 🔄 **Streaming Responses** - Real-time AI output with tool execution display
- 💬 **Multi-Session Support** - Save and manage multiple chat conversations
- 🌐 **OpenRouter Integration** - Access to 100+ AI models

## 📁 Project Structure

```
super-ai-ide/
├── src/
│   ├── extension.ts          # VS Code extension entry point
│   ├── SidebarProvider.ts    # Webview provider & UI logic
│   ├── prompts.ts            # System prompts & model config
│   ├── agent/                # LangGraph Agent (Core AI Logic)
│   │   ├── index.ts          # Agent runtime & composition
│   │   ├── tools.ts          # Tool definitions & wrappers
│   │   ├── context.ts        # Context management & compression
│   │   ├── permissions.ts    # Security & permission system
│   │   ├── retry.ts          # Retry logic & error recovery
│   │   └── advancedTools.ts  # Smart editing & search tools
│   └── webview/
│       └── index.html        # Chat UI template
├── out/                      # Compiled JavaScript output
├── package.json              # Extension manifest & config
├── tsconfig.json             # TypeScript configuration
└── README.md
```

## 🏗️ Architecture

### Core Components

| Component | File | Description |
|-----------|------|-------------|
| **Extension Entry** | `extension.ts` | Registers webview provider |
| **Sidebar Provider** | `SidebarProvider.ts` | Handles UI messages, session management |
| **LangGraph Agent** | `agent/index.ts` | Creates ReAct agent with streaming |
| **Tools** | `agent/tools.ts` | File system & terminal operations |
| **Prompts** | `prompts.ts` | System prompt & model options |

### LangGraph Agent Flow

```
User Message
     ↓
┌─────────────────────────────────────┐
│    Context & Security Layer         │
│  - Token Compaction                 │
│  - Project-Aware Prompting          │
│  - Permission Check & Dry Run       │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         LangGraph ReAct Agent       │
│  ┌─────────────────────────────┐    │
│  │   LLM (via OpenRouter)      │    │
│  │   - DeepSeek Chat           │    │
│  │   - GPT-4o / Claude 3.5     │    │
│  └───────────┬─────────────────┘    │
│              │                      │
│              ▼                      │
│  ┌─────────────────────────────┐    │
│  │   Tool Execution (Secure)   │◄───┼─── Auto-Retry Loop
│  │   - list_files, read_file   │    │    (Smart Recovery)
│  │   - write/delete (Audited)  │    │
│  │   - search_replace (Smart)  │    │
│  │   - grep_search (Fast)      │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
     ↓
Streaming Response (with Dry Run previews)
```

### Available Tools

| Tool | Description |
|------|-------------|
| **Core Filesystem** | |
| `list_files` | List files and directories |
| `read_file` | Read file content |
| `write_file` | Create or overwrite a file (Permission Check) |
| `create_directory` | Create directory |
| `delete_file` | Delete file/dir (Requires Approval) |
| `rename_file` | Rename or move file/directory |
| `get_file_info` | Get file metadata |
| **Advanced Tools** | |
| `search_replace` | Smart text replacement in files |
| `multi_edit` | Apply multiple edits to a file |
| `apply_patch` | Apply unified diff patch |
| `grep_search` | High-performance regex search (ripgrep) |
| `find_symbol` | Find functions/classes/variables |
| **System** | |
| `run_terminal_command` | Execute shell commands (Requires Approval) |

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- VS Code 1.80+
- OpenRouter API Key

### Installation

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (for development)
npm run watch
```

### Configuration

1. Open VS Code Settings (`Ctrl+,`)
2. Search for "Super AI IDE"
3. Set your **OpenRouter API Key**
4. Choose your preferred **Model** (default: `deepseek/deepseek-chat`)

### Recommended Models

| Model | ID | Notes |
|-------|-----|-------|
| DeepSeek Chat | `deepseek/deepseek-chat` | Best balance of cost & capability |
| GPT-4o | `openai/gpt-4o` | Excellent tool calling |
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` | Great for complex tasks |

## 🛠️ Development

### Debug Extension

1. Press `F5` in VS Code
2. A new Extension Development Host window opens
3. Click the **Super AI** icon in the Activity Bar

### Build for Production

```bash
# Package as VSIX
npm run package
```

## 📦 Dependencies

### Core
- `@langchain/langgraph` - LangGraph agent framework
- `@langchain/openai` - OpenAI-compatible LLM provider
- `@langchain/core` - LangChain core utilities
- `zod` - Schema validation for tools

### UI
- `markdown-it` - Markdown rendering

## 📄 License

MIT
