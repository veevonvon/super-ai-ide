import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface ProviderConfig {
    apiKey: string;
    modelName: string;
    temperature?: number;
    baseUrl?: string;
}

export interface AIProvider {
    createModel(config: ProviderConfig): BaseChatModel;
    customizeSystemPrompt(basePrompt: string): string;
}
