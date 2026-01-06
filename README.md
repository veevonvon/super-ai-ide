# Super AI IDE

<div align="center">
  <img src="super-ai-ide/images/demo.png" alt="Super AI IDE Snapshot" width="800" />
  
  <br/>
  
  <h1>PIKA AI IDE</h1>
  <p>
    <b>The First 100% AI-Generated VS Code Extension</b>
  </p>
  
  <p>
    <a href="#-features">Features</a> •
    <a href="#-pure-ai-experiment">The AI Experiment</a> •
    <a href="#-getting-started">Getting Started</a>
  </p>
  
  ![Pure AI](https://img.shields.io/badge/Code-100%25_AI_Generated-purple?style=for-the-badge)
  ![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)
</div>

---

## 🚀 The AI Experiment: Zero Human Code

**This project is unique.**

It is a **fully functional** VS Code extension built entirely by an AI Agent.
*   **0 lines of code** were written by humans.
*   **All architecture decisions** were made by AI.
*   **All documentation** (including this README) was written by AI.
*   **All debugging** was performed by AI.

This project serves as a proof-of-concept for the future of **Agentic Coding**, demonstrating that AI can build complex, production-ready software systems autonomously.

---

## ✨ Product Introduction

**Super AI IDE** is a next-generation coding assistant designed to live directly inside VS Code. Unlike traditional autocomplete tools, Super AI IDE operates as a fully autonomous **Agent**.

Powered by **LangGraph** and **OpenRouter**, it doesn't just suggest code—it **thinks, plans, and executes**.

### Key Capabilities

*   **🧠 Autonomous Problem Solving**: Uses LangGraph ReAct agents to break down complex tasks and solve them step-by-step.
*   **🛠️ Full System Access**: Can read files, write code, run terminal commands, and create directories—just like a human developer.
*   **🐳 Safe Execution**: Built-in Docker and Shell isolation ensuring that AI commands are executed safely.
*   **💬 Context-Aware Chat**: Remembers your project structure, history, and preferences.
*   **🔌 Extension Ecosystem**: Supports MCP (Model Context Protocol) to connect with external tools and databases.

## 📸 Snapshot

Experience a futuristic, AI-driven development environment:
*(See the header image)*

## 📦 Features

- **Multi-Provider Support**: Seamlessly switch between OpenAI (GPT-4o), Anthropic (Claude 3.5), and OpenRouter models.
- **Smart Context**: Intelligent context window management to handle large projects.
- **Session Management**: Fork sessions, tag important messages, and maintain multiple conversation threads.
- **Visual Feedback**: Real-time streaming of AI "thoughts" and tool executions.

---

## 🛠️ Architecture

The project follows a modular architecture designed by AI:

| Component | Description |
|-----------|-------------|
| **Agent Core** | LangGraph-based ReAct agent loop in `src/agent/` |
| **Tooling** | Comprehensive toolset for FS/Terminal operations in `src/agent/tools.ts` |
| **UI/UX** | Modern Webview-based chat interface in `src/webview/` |
| **Security** | Granular permission system for all sensitive operations |

## 🚀 Getting Started

1.  **Clone the Repository**
2.  **Install Dependencies**: `npm install`
3.  **Run the Extension**: Press `F5` in VS Code to launch the Debug Host.
4.  **Configure**:
    *   Open Settings (`Ctrl+,`).
    *   Search "Super AI IDE".
    *   Enter your **OpenRouter API Key**.

---

*Generated with ❤️ by Antigravity (Google DeepMind)*
