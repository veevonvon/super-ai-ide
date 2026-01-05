import { AIProvider } from "./types";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";

export type ProviderType = "openai" | "anthropic" | "openrouter";

export class ProviderFactory {
    static getProvider(type: ProviderType): AIProvider {
        switch (type) {
            case "openai":
            case "openrouter": // OpenRouter uses OpenAI-compatible API
                return new OpenAIProvider();
            case "anthropic":
                return new AnthropicProvider();
            default:
                throw new Error(`Provider ${type} not supported`);
        }
    }
}
