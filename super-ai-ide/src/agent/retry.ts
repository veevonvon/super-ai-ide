/**
 * Retry & Recovery - 重试与恢复模块
 * 
 * 功能：
 * - LLM 输出错误自动重试
 * - 工具执行失败重试
 * - 消息历史回退 (Revert)
 * - 错误分类与智能恢复
 */

import { BaseMessage } from "@langchain/core/messages";

/**
 * 错误类型分类
 */
export enum ErrorCategory {
    LLM_FORMAT_ERROR = "llm_format_error",      // LLM 输出格式错误
    LLM_RATE_LIMIT = "llm_rate_limit",          // API 速率限制
    LLM_CONTEXT_LENGTH = "llm_context_length",  // 上下文过长
    LLM_TIMEOUT = "llm_timeout",                // 请求超时
    LLM_API_ERROR = "llm_api_error",            // API 错误
    TOOL_EXECUTION_ERROR = "tool_error",        // 工具执行错误
    TOOL_NOT_FOUND = "tool_not_found",          // 工具不存在
    PERMISSION_DENIED = "permission_denied",     // 权限被拒绝
    NETWORK_ERROR = "network_error",            // 网络错误
    UNKNOWN = "unknown"                         // 未知错误
}

/**
 * 重试策略
 */
export interface RetryStrategy {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableCategories: ErrorCategory[];
}

/**
 * 重试上下文
 */
export interface RetryContext {
    attempt: number;
    lastError?: Error;
    errorCategory?: ErrorCategory;
    startTime: number;
    totalDelayMs: number;
}

/**
 * 消息快照 (用于回退)
 */
export interface MessageSnapshot {
    id: string;
    timestamp: number;
    messages: BaseMessage[];
    metadata?: Record<string, any>;
}

/**
 * 默认重试策略
 */
export const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryableCategories: [
        ErrorCategory.LLM_RATE_LIMIT,
        ErrorCategory.LLM_TIMEOUT,
        ErrorCategory.NETWORK_ERROR,
        ErrorCategory.TOOL_EXECUTION_ERROR
    ]
};

/**
 * 错误分类器
 */
export function classifyError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // API 速率限制
    if (message.includes("rate limit") || message.includes("429") || message.includes("too many requests")) {
        return ErrorCategory.LLM_RATE_LIMIT;
    }

    // 上下文长度超限
    if (message.includes("context length") || message.includes("max tokens") || message.includes("too long")) {
        return ErrorCategory.LLM_CONTEXT_LENGTH;
    }

    // 超时
    if (message.includes("timeout") || message.includes("timed out") || name.includes("timeout")) {
        return ErrorCategory.LLM_TIMEOUT;
    }

    // 网络错误
    if (message.includes("network") || message.includes("econnrefused") ||
        message.includes("enotfound") || message.includes("fetch failed")) {
        return ErrorCategory.NETWORK_ERROR;
    }

    // 格式错误
    if (message.includes("json") || message.includes("parse") || message.includes("format")) {
        return ErrorCategory.LLM_FORMAT_ERROR;
    }

    // 权限错误
    if (message.includes("permission") || message.includes("denied") || message.includes("unauthorized")) {
        return ErrorCategory.PERMISSION_DENIED;
    }

    // 工具错误
    if (message.includes("tool") || message.includes("not found: tool")) {
        return ErrorCategory.TOOL_NOT_FOUND;
    }

    // API 错误
    if (message.includes("api") || message.includes("500") || message.includes("502") || message.includes("503")) {
        return ErrorCategory.LLM_API_ERROR;
    }

    return ErrorCategory.UNKNOWN;
}

/**
 * 计算重试延迟 (指数退避)
 */
export function calculateRetryDelay(
    attempt: number,
    strategy: RetryStrategy
): number {
    const delay = Math.min(
        strategy.initialDelayMs * Math.pow(strategy.backoffMultiplier, attempt - 1),
        strategy.maxDelayMs
    );

    // 添加随机抖动 (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
}

/**
 * 判断是否应该重试
 */
export function shouldRetry(
    context: RetryContext,
    strategy: RetryStrategy
): boolean {
    if (context.attempt >= strategy.maxRetries) {
        return false;
    }

    if (!context.errorCategory) {
        return false;
    }

    return strategy.retryableCategories.includes(context.errorCategory);
}

/**
 * 获取错误恢复建议
 */
export function getRecoverySuggestion(category: ErrorCategory): string {
    switch (category) {
        case ErrorCategory.LLM_RATE_LIMIT:
            return "Rate limit exceeded. Waiting before retry...";

        case ErrorCategory.LLM_CONTEXT_LENGTH:
            return "Context too long. Consider compacting message history or shortening input.";

        case ErrorCategory.LLM_TIMEOUT:
            return "Request timed out. Retrying with potentially shorter input...";

        case ErrorCategory.NETWORK_ERROR:
            return "Network error detected. Checking connection and retrying...";

        case ErrorCategory.LLM_FORMAT_ERROR:
            return "Invalid response format from LLM. Retrying with clearer instructions...";

        case ErrorCategory.TOOL_EXECUTION_ERROR:
            return "Tool execution failed. Checking parameters and retrying...";

        case ErrorCategory.TOOL_NOT_FOUND:
            return "Requested tool not found. Using alternative approach...";

        case ErrorCategory.PERMISSION_DENIED:
            return "Permission denied. Cannot proceed without authorization.";

        case ErrorCategory.LLM_API_ERROR:
            return "API error occurred. Retrying after a short delay...";

        default:
            return "Unknown error occurred. Attempting recovery...";
    }
}

/**
 * 重试执行器
 */
export class RetryExecutor {
    private strategy: RetryStrategy;
    private snapshots: MessageSnapshot[] = [];
    private maxSnapshots: number = 10;

    constructor(strategy?: Partial<RetryStrategy>) {
        this.strategy = { ...DEFAULT_RETRY_STRATEGY, ...strategy };
    }

    /**
     * 使用重试策略执行异步操作
     */
    async execute<T>(
        operation: () => Promise<T>,
        onRetry?: (context: RetryContext, suggestion: string) => void
    ): Promise<T> {
        const context: RetryContext = {
            attempt: 0,
            startTime: Date.now(),
            totalDelayMs: 0
        };

        while (true) {
            context.attempt++;

            try {
                return await operation();
            } catch (error: any) {
                context.lastError = error;
                context.errorCategory = classifyError(error);

                if (!shouldRetry(context, this.strategy)) {
                    throw this.enhanceError(error, context);
                }

                const delayMs = calculateRetryDelay(context.attempt, this.strategy);
                context.totalDelayMs += delayMs;

                const suggestion = getRecoverySuggestion(context.errorCategory);

                if (onRetry) {
                    onRetry(context, suggestion);
                }

                await this.sleep(delayMs);
            }
        }
    }

    /**
     * 增强错误信息
     */
    private enhanceError(error: Error, context: RetryContext): Error {
        const enhanced = new Error(
            `${error.message}\n\n` +
            `[Retry Info]\n` +
            `- Attempts: ${context.attempt}\n` +
            `- Category: ${context.errorCategory}\n` +
            `- Total delay: ${context.totalDelayMs}ms\n` +
            `- Duration: ${Date.now() - context.startTime}ms`
        );
        enhanced.name = error.name;
        enhanced.stack = error.stack;
        return enhanced;
    }

    /**
     * 创建消息快照
     */
    createSnapshot(messages: BaseMessage[], metadata?: Record<string, any>): string {
        const snapshot: MessageSnapshot = {
            id: `snap-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            timestamp: Date.now(),
            messages: JSON.parse(JSON.stringify(messages)),
            metadata
        };

        this.snapshots.push(snapshot);

        // 保持快照数量在限制内
        while (this.snapshots.length > this.maxSnapshots) {
            this.snapshots.shift();
        }

        return snapshot.id;
    }

    /**
     * 获取所有快照
     */
    getSnapshots(): MessageSnapshot[] {
        return [...this.snapshots];
    }

    /**
     * 还原到指定快照
     */
    revertToSnapshot(snapshotId: string): BaseMessage[] | null {
        const index = this.snapshots.findIndex(s => s.id === snapshotId);

        if (index === -1) {
            return null;
        }

        const snapshot = this.snapshots[index];

        // 删除此快照之后的所有快照
        this.snapshots = this.snapshots.slice(0, index + 1);

        return JSON.parse(JSON.stringify(snapshot.messages));
    }

    /**
     * 还原到上一个快照
     */
    revertToLast(): BaseMessage[] | null {
        if (this.snapshots.length === 0) {
            return null;
        }

        const snapshot = this.snapshots.pop()!;
        return JSON.parse(JSON.stringify(snapshot.messages));
    }

    /**
     * 清除所有快照
     */
    clearSnapshots() {
        this.snapshots = [];
    }

    /**
     * 更新重试策略
     */
    updateStrategy(strategy: Partial<RetryStrategy>) {
        this.strategy = { ...this.strategy, ...strategy };
    }

    /**
     * 睡眠函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * 工具执行重试包装器
 */
export async function withToolRetry<T>(
    toolName: string,
    execute: () => Promise<T>,
    maxRetries: number = 2,
    onError?: (error: Error, attempt: number) => void
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            return await execute();
        } catch (error: any) {
            lastError = error;

            if (onError) {
                onError(error, attempt);
            }

            if (attempt > maxRetries) {
                throw error;
            }

            // 短暂延迟后重试
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }

    throw lastError;
}

// 导出单例
export const retryExecutor = new RetryExecutor();
