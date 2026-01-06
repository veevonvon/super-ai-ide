import { ChatAnthropic } from "@langchain/anthropic";
import { AIProvider, ProviderConfig } from "./types";

export class AnthropicProvider implements AIProvider {
    createModel(config: ProviderConfig): ChatAnthropic {
        return new ChatAnthropic({
            apiKey: config.apiKey,
            modelName: config.modelName,
            temperature: config.temperature ?? 0.7,
            streaming: true,
            anthropicApiUrl: config.baseUrl // Optional: allow custom base URL
        });
    }

    customizeSystemPrompt(basePrompt: string): string {
        // Append specific instructions for Anthropic models if needed
        // For now, we ensure tool use is emphasized as Anthropic models (especially older ones) benefit from it, 
        // though Claude 3 is quite good.
        return `${basePrompt}

When using tools:
1. Think step-by-step about which tool to use.
2. Output the tool call in the expected format.
`;
    }
}
