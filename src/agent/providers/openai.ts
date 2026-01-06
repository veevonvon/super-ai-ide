import { ChatOpenAI } from "@langchain/openai";
import { AIProvider, ProviderConfig } from "./types";

export class OpenAIProvider implements AIProvider {
    createModel(config: ProviderConfig): ChatOpenAI {
        const configuration: any = {};
        if (config.baseUrl) {
            configuration.baseURL = config.baseUrl;
        }

        return new ChatOpenAI({
            apiKey: config.apiKey,
            modelName: config.modelName,
            temperature: config.temperature ?? 0.7,
            configuration,
            streaming: true
        });
    }

    customizeSystemPrompt(basePrompt: string): string {
        // OpenAI models typically handle standard system prompts well
        return basePrompt;
    }
}
