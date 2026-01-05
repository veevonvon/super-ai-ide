import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { getAllTools } from "./tools";
import { SYSTEM_PROMPT } from "../prompts";
import { contextManager, EnhancedMessage } from "./context";
import { retryExecutor, ErrorCategory, classifyError } from "./retry";
import { ProviderFactory, ProviderType } from "./providers/factory";
import { AgentConfig, StreamCallback } from "./types";

export { AgentConfig, StreamCallback }; // Re-export for compatibility

/**
 * 创建 LangGraph ReAct Agent
 */
export function createAgent(config: AgentConfig) {
    const providerType = config.provider || "openrouter";
    const provider = ProviderFactory.getProvider(providerType);

    const llm = provider.createModel({
        apiKey: config.apiKey,
        modelName: config.model,
        baseUrl: config.baseUrl,
        temperature: 0.7
    });

    const agent = createReactAgent({
        llm,
        tools: getAllTools(config)
    });

    return agent;
}

/**
 * 转换简单消息格式为增强消息格式
 */
function convertToEnhancedMessages(messages: { role: string; content: string }[]): EnhancedMessage[] {
    return messages.map((msg, index) => ({
        role: msg.role as any,
        content: msg.content,
        metadata: {
            id: `msg-${Date.now()}-${index}`,
            timestamp: Date.now()
        }
    }));
}

/**
 * 运行 Agent 并流式输出 (包含上下文管理和重试逻辑)
 */
export async function runAgentWithStream(
    config: AgentConfig,
    messages: { role: string; content: string }[],
    callbacks: StreamCallback
): Promise<string> {
    const startTime = Date.now();
    let fullResponse = "";

    try {
        // 1. 上下文预处理
        const enhancedMessages = convertToEnhancedMessages(messages);

        // 1.1 消息压缩
        const compactedMessages = await contextManager.compactMessages(enhancedMessages);

        // 1.2 生成项目感知 Prompt
        const baseSystemPrompt = SYSTEM_PROMPT;
        const projectAwarePrompt = await contextManager.generateProjectAwarePrompt(baseSystemPrompt);

        // 1.2.1 针对 Provider 优化 Prompt
        const providerType = config.provider || "openrouter";
        const provider = ProviderFactory.getProvider(providerType);
        const customizedPrompt = provider.customizeSystemPrompt(projectAwarePrompt);

        // 1.3 转换为 LangChain 格式
        const langchainMessages = contextManager.toLangChainMessages(compactedMessages, customizedPrompt);

        // 2. 执行 Agent (带重试逻辑)
        await retryExecutor.execute(async () => {
            const agent = createAgent(config);
            fullResponse = ""; // 重置响应缓冲

            const stream = agent.streamEvents(
                { messages: langchainMessages },
                {
                    version: "v2",
                    recursionLimit: config.maxIterations ?? 25
                }
            );

            let currentToolName = "";

            for await (const event of stream) {
                // 处理 LLM token 流
                if (event.event === "on_chat_model_stream") {
                    const chunk = event.data?.chunk;
                    if (chunk?.content) {
                        const token = typeof chunk.content === "string"
                            ? chunk.content
                            : (Array.isArray(chunk.content) && chunk.content[0]?.text)
                                ? chunk.content[0].text
                                : "";

                        if (token) {
                            fullResponse += token;
                            callbacks.onToken(token);
                        }
                    }
                }

                // 处理工具调用开始
                if (event.event === "on_tool_start") {
                    currentToolName = event.name || "unknown_tool";
                    callbacks.onToolStart(currentToolName, event.data?.input);
                }

                // 处理工具调用结束
                if (event.event === "on_tool_end") {
                    const toolOutput = event.data?.output;
                    const toolName = currentToolName || event.name || "unknown_tool";

                    // 检查工具是否包含错误信息 (LangGraph 通常将工具错误作为输出返回给 LLM)
                    if (toolOutput && typeof toolOutput === 'string' && toolOutput.startsWith("Error:")) {
                        // 可以选择在这里做一些特殊处理，目前依然传给 UI
                    }

                    callbacks.onToolEnd(toolName, toolOutput);
                }
            }
        }, (context, suggestion) => {
            // 重试回调：通知 UI 正在重试
            callbacks.onToken(`\n\n⚠️ **Error encountered (${context.errorCategory}):** ${context.lastError?.message}\n**Retry attempt ${context.attempt}...** ${suggestion}\n\n`);
        });

        callbacks.onComplete();
        return fullResponse;

    } catch (error: any) {
        callbacks.onError(error);
        throw error;
    }
}

/**
 * 简单的非流式 Agent 调用（用于后台任务）
 */
export async function runAgent(
    config: AgentConfig,
    messages: { role: string; content: string }[]
): Promise<string> {
    // 简单调用也应该享受部分上下文管理的好处，如 System Prompt
    const projectAwarePrompt = await contextManager.generateProjectAwarePrompt(SYSTEM_PROMPT);

    // 针对 Provider 优化
    const providerType = config.provider || "openrouter";
    const provider = ProviderFactory.getProvider(providerType);
    const customizedPrompt = provider.customizeSystemPrompt(projectAwarePrompt);

    // 简化处理，不进行压缩
    const langchainMessages: BaseMessage[] = [
        new SystemMessage(customizedPrompt),
        ...messages.map(m => m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content))
    ];

    return await retryExecutor.execute(async () => {
        const agent = createAgent(config);
        const result = await agent.invoke(
            { messages: langchainMessages },
            { recursionLimit: config.maxIterations ?? 25 }
        );

        const lastMessage = result.messages[result.messages.length - 1];
        return typeof lastMessage.content === "string"
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);
    });
}
