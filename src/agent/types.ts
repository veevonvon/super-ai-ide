import { ProviderType } from "./providers/factory";

/**
 * Agent 配置接口
 */
export interface AgentConfig {
    apiKey: string;
    model: string;
    maxIterations?: number;
    workspaceName?: string; // 工作区名称
    provider?: ProviderType;
    baseUrl?: string;
}

/**
 * 流式输出回调接口
 */
export interface StreamCallback {
    onToken: (token: string) => void;
    onToolStart: (toolName: string, input: any) => void;
    onToolEnd: (toolName: string, output: any) => void;
    onError: (error: Error) => void;
    onComplete: () => void;
}
