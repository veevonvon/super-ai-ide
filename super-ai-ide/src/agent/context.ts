/**
 * Context Management - 上下文管理模块
 * 
 * 功能：
 * - 动态上下文压缩 (Token 管理)
 * - 项目感知提示词
 * - 消息生命周期管理
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

/**
 * 消息元数据
 */
export interface MessageMetadata {
    id: string;
    timestamp: number;
    tokens?: number;
    tags?: string[];
    isCompacted?: boolean;
    toolCalls?: string[];
}

/**
 * 增强的消息接口
 */
export interface EnhancedMessage {
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    metadata: MessageMetadata;
}

/**
 * 上下文管理器配置
 */
export interface ContextManagerConfig {
    maxTokens: number;           // 最大 Token 限制
    compactionThreshold: number; // 触发压缩的阈值 (0-1)
    preserveRecentCount: number; // 保留最近的消息数量
    preserveKeyDecisions: boolean; // 保留关键决策
}

/**
 * 项目元数据
 */
export interface ProjectMetadata {
    name: string;
    language?: string;
    framework?: string;
    dependencies?: string[];
    fileStructure?: string;
    readme?: string;
}

/**
 * 上下文管理器
 */
export class ContextManager {
    private config: ContextManagerConfig;
    private projectMetadata: ProjectMetadata | null = null;

    constructor(config?: Partial<ContextManagerConfig>) {
        this.config = {
            maxTokens: 100000,
            compactionThreshold: 0.8,
            preserveRecentCount: 10,
            preserveKeyDecisions: true,
            ...config
        };
    }

    /**
     * 估算文本的 Token 数量 (粗略估计)
     */
    estimateTokens(text: string): number {
        // 英文约 4 字符 = 1 token，中文约 1.5 字符 = 1 token
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const otherChars = text.length - chineseChars;
        return Math.ceil(chineseChars / 1.5 + otherChars / 4);
    }

    /**
     * 计算消息列表的总 Token 数
     */
    getTotalTokens(messages: EnhancedMessage[]): number {
        return messages.reduce((sum, msg) => {
            if (msg.metadata.tokens) {
                return sum + msg.metadata.tokens;
            }
            return sum + this.estimateTokens(msg.content);
        }, 0);
    }

    /**
     * 检查是否需要压缩
     */
    needsCompaction(messages: EnhancedMessage[]): boolean {
        const totalTokens = this.getTotalTokens(messages);
        return totalTokens > this.config.maxTokens * this.config.compactionThreshold;
    }

    /**
     * 压缩消息历史
     * 保留关键决策和最近的对话，对早期内容进行摘要
     */
    async compactMessages(
        messages: EnhancedMessage[],
        summarizer?: (text: string) => Promise<string>
    ): Promise<EnhancedMessage[]> {
        if (!this.needsCompaction(messages)) {
            return messages;
        }

        const preserveCount = this.config.preserveRecentCount;

        // 分离需要保留和需要压缩的消息
        const recentMessages = messages.slice(-preserveCount);
        const oldMessages = messages.slice(0, -preserveCount);

        if (oldMessages.length === 0) {
            return messages;
        }

        // 提取关键信息
        const keyDecisions = this.extractKeyDecisions(oldMessages);
        const toolResults = this.extractToolResults(oldMessages);

        // 生成摘要
        let summary: string;
        if (summarizer) {
            const oldContent = oldMessages.map(m => `[${m.role}]: ${m.content}`).join("\n");
            summary = await summarizer(oldContent);
        } else {
            summary = this.generateLocalSummary(oldMessages);
        }

        // 创建压缩后的系统消息
        const compactedMessage: EnhancedMessage = {
            role: "system",
            content: `[Previous Conversation Summary]\n${summary}\n\n[Key Decisions]\n${keyDecisions}\n\n[Tool Results]\n${toolResults}`,
            metadata: {
                id: `compact-${Date.now()}`,
                timestamp: Date.now(),
                tokens: this.estimateTokens(summary + keyDecisions + toolResults),
                isCompacted: true,
                tags: ["summary", "compaction"]
            }
        };

        return [compactedMessage, ...recentMessages];
    }

    /**
     * 提取关键决策
     */
    private extractKeyDecisions(messages: EnhancedMessage[]): string {
        const decisions: string[] = [];

        for (const msg of messages) {
            if (msg.role === "assistant") {
                // 检测决策性语句
                const decisionPatterns = [
                    /I will|I'll|Let me|I'm going to/i,
                    /决定|选择|采用|使用/,
                    /created|modified|deleted|installed/i,
                    /创建了|修改了|删除了|安装了/
                ];

                for (const pattern of decisionPatterns) {
                    if (pattern.test(msg.content)) {
                        // 提取包含决策的句子
                        const sentences = msg.content.split(/[.。!！?？\n]/).filter(s => s.trim());
                        for (const sentence of sentences) {
                            if (pattern.test(sentence)) {
                                decisions.push(`- ${sentence.trim()}`);
                                break;
                            }
                        }
                        break;
                    }
                }
            }
        }

        return decisions.length > 0 ? decisions.slice(0, 10).join("\n") : "No major decisions recorded.";
    }

    /**
     * 提取工具调用结果
     */
    private extractToolResults(messages: EnhancedMessage[]): string {
        const results: string[] = [];

        for (const msg of messages) {
            if (msg.metadata.toolCalls && msg.metadata.toolCalls.length > 0) {
                results.push(`- Tools used: ${msg.metadata.toolCalls.join(", ")}`);
            }
        }

        return results.length > 0 ? results.slice(0, 5).join("\n") : "No significant tool operations.";
    }

    /**
     * 生成本地摘要 (不使用 LLM)
     */
    private generateLocalSummary(messages: EnhancedMessage[]): string {
        const userQueries = messages
            .filter(m => m.role === "user")
            .map(m => m.content.slice(0, 100))
            .slice(0, 5);

        const topicKeywords = this.extractTopicKeywords(messages);

        return `The conversation covered ${messages.length} messages discussing: ${topicKeywords.join(", ")}.\n` +
            `User queries included: ${userQueries.map(q => `"${q}..."`).join("; ")}`;
    }

    /**
     * 提取话题关键词
     */
    private extractTopicKeywords(messages: EnhancedMessage[]): string[] {
        const allContent = messages.map(m => m.content).join(" ");

        // 常见编程相关关键词
        const patterns = [
            /\b(file|files|directory|folder)\b/gi,
            /\b(function|class|method|variable)\b/gi,
            /\b(error|bug|fix|debug)\b/gi,
            /\b(install|build|compile|run)\b/gi,
            /\b(create|delete|modify|update)\b/gi,
            /\.(ts|js|py|html|css|json)\b/gi
        ];

        const keywords = new Set<string>();
        for (const pattern of patterns) {
            const matches = allContent.match(pattern);
            if (matches) {
                matches.forEach(m => keywords.add(m.toLowerCase()));
            }
        }

        return Array.from(keywords).slice(0, 10);
    }

    /**
     * 获取项目元数据
     */
    async getProjectMetadata(): Promise<ProjectMetadata | null> {
        if (this.projectMetadata) {
            return this.projectMetadata;
        }

        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return null;
        }

        const rootPath = folders[0].uri.fsPath;
        const projectName = path.basename(rootPath);

        const metadata: ProjectMetadata = {
            name: projectName
        };

        // 检测项目类型
        try {
            // 检查 package.json (Node.js)
            const packageJsonPath = path.join(rootPath, "package.json");
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
                metadata.language = "TypeScript/JavaScript";
                metadata.dependencies = Object.keys(packageJson.dependencies || {}).slice(0, 10);

                // 检测框架
                const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
                if (deps["react"]) metadata.framework = "React";
                else if (deps["vue"]) metadata.framework = "Vue";
                else if (deps["@angular/core"]) metadata.framework = "Angular";
                else if (deps["next"]) metadata.framework = "Next.js";
                else if (deps["express"]) metadata.framework = "Express";
            }

            // 检查 requirements.txt (Python)
            const requirementsPath = path.join(rootPath, "requirements.txt");
            if (fs.existsSync(requirementsPath)) {
                metadata.language = "Python";
                const content = fs.readFileSync(requirementsPath, "utf-8");
                metadata.dependencies = content.split("\n").filter(l => l.trim()).slice(0, 10);

                if (content.includes("django")) metadata.framework = "Django";
                else if (content.includes("flask")) metadata.framework = "Flask";
                else if (content.includes("fastapi")) metadata.framework = "FastAPI";
            }

            // 检查 Cargo.toml (Rust)
            const cargoPath = path.join(rootPath, "Cargo.toml");
            if (fs.existsSync(cargoPath)) {
                metadata.language = "Rust";
            }

            // 检查 go.mod (Go)
            const goModPath = path.join(rootPath, "go.mod");
            if (fs.existsSync(goModPath)) {
                metadata.language = "Go";
            }

            // 读取 README
            const readmePath = path.join(rootPath, "README.md");
            if (fs.existsSync(readmePath)) {
                const readme = fs.readFileSync(readmePath, "utf-8");
                metadata.readme = readme.slice(0, 2000); // 限制长度
            }

            // 生成简化的文件结构
            metadata.fileStructure = this.generateFileStructure(rootPath, 2);

        } catch (error) {
            console.error("Error reading project metadata:", error);
        }

        this.projectMetadata = metadata;
        return metadata;
    }

    /**
     * 生成文件结构字符串
     */
    private generateFileStructure(dirPath: string, maxDepth: number, currentDepth = 0): string {
        if (currentDepth >= maxDepth) return "";

        const indent = "  ".repeat(currentDepth);
        let result = "";

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const filtered = entries.filter(e =>
                !e.name.startsWith(".") &&
                e.name !== "node_modules" &&
                e.name !== "__pycache__" &&
                e.name !== "dist" &&
                e.name !== "build"
            ).slice(0, 15);

            for (const entry of filtered) {
                const icon = entry.isDirectory() ? "📁" : "📄";
                result += `${indent}${icon} ${entry.name}\n`;

                if (entry.isDirectory()) {
                    result += this.generateFileStructure(
                        path.join(dirPath, entry.name),
                        maxDepth,
                        currentDepth + 1
                    );
                }
            }
        } catch (error) {
            // Ignore read errors
        }

        return result;
    }

    /**
     * 生成项目感知的系统提示词
     */
    async generateProjectAwarePrompt(basePrompt: string): Promise<string> {
        const metadata = await this.getProjectMetadata();

        if (!metadata) {
            return basePrompt;
        }

        let enhancedPrompt = basePrompt + "\n\n## Project Context\n";
        enhancedPrompt += `**Project Name:** ${metadata.name}\n`;

        if (metadata.language) {
            enhancedPrompt += `**Language:** ${metadata.language}\n`;
        }

        if (metadata.framework) {
            enhancedPrompt += `**Framework:** ${metadata.framework}\n`;
        }

        if (metadata.dependencies && metadata.dependencies.length > 0) {
            enhancedPrompt += `**Key Dependencies:** ${metadata.dependencies.join(", ")}\n`;
        }

        if (metadata.fileStructure) {
            enhancedPrompt += `\n**File Structure:**\n\`\`\`\n${metadata.fileStructure}\`\`\`\n`;
        }

        if (metadata.readme) {
            enhancedPrompt += `\n**README Summary:**\n${metadata.readme.slice(0, 500)}...\n`;
        }

        return enhancedPrompt;
    }

    /**
     * 将增强消息转换为 LangChain 消息
     */
    toLangChainMessages(messages: EnhancedMessage[], systemPrompt: string): BaseMessage[] {
        const result: BaseMessage[] = [new SystemMessage(systemPrompt)];

        for (const msg of messages) {
            switch (msg.role) {
                case "user":
                    result.push(new HumanMessage(msg.content));
                    break;
                case "assistant":
                    result.push(new AIMessage(msg.content));
                    break;
                case "system":
                    // 压缩后的系统消息作为 Human 消息添加
                    if (msg.metadata.isCompacted) {
                        result.push(new HumanMessage(`[Context Reminder]\n${msg.content}`));
                    }
                    break;
            }
        }

        return result;
    }

    /**
     * 创建消息快照 (用于会话分叉)
     */
    createSnapshot(messages: EnhancedMessage[], label?: string): {
        id: string;
        timestamp: number;
        label?: string;
        messages: EnhancedMessage[];
    } {
        return {
            id: `snapshot-${Date.now()}`,
            timestamp: Date.now(),
            label,
            messages: JSON.parse(JSON.stringify(messages))
        };
    }

    /**
     * 从快照恢复
     */
    restoreFromSnapshot(snapshot: { messages: EnhancedMessage[] }): EnhancedMessage[] {
        return JSON.parse(JSON.stringify(snapshot.messages));
    }

    /**
     * 清除缓存的项目元数据
     */
    clearProjectCache() {
        this.projectMetadata = null;
    }
}

// 导出单例
export const contextManager = new ContextManager();
