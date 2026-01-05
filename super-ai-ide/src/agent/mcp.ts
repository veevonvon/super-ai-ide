
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as vscode from "vscode";

export interface McpServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export class McpManager {
    private clients: Map<string, Client> = new Map();

    constructor() { }

    /**
     * Connect to multiple MCP servers
     */
    async connect(servers: Record<string, McpServerConfig>) {
        // Disconnect existing
        await this.disconnect();

        for (const [name, config] of Object.entries(servers)) {
            try {
                const transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: config.env
                });

                const client = new Client({
                    name: "super-ai-ide-client",
                    version: "1.0.0"
                }, {
                    capabilities: {
                        sampling: {}
                    }
                });

                await client.connect(transport);
                this.clients.set(name, client);
                console.log(`Connected to MCP server: ${name}`);
            } catch (e) {
                console.error(`Failed to connect to MCP server ${name}:`, e);
                vscode.window.showErrorMessage(`Failed to connect to MCP server ${name}: ${e}`);
            }
        }
    }

    async disconnect() {
        for (const client of this.clients.values()) {
            try {
                await client.close();
            } catch (e) {
                console.error("Error closing client:", e);
            }
        }
        this.clients.clear();
    }

    /**
     * Convert MCP tools to LangChain tools
     */
    async getLangChainTools(): Promise<DynamicStructuredTool[]> {
        const tools: DynamicStructuredTool[] = [];

        for (const [serverName, client] of this.clients.entries()) {
            try {
                const { tools: mcpTools } = await client.listTools();

                for (const tool of mcpTools) {
                    tools.push(new DynamicStructuredTool({
                        name: `${serverName}_${tool.name}`, // Namesapce the tools
                        description: tool.description || `Tool ${tool.name} from ${serverName}`,
                        // We use a passthrough schema because converting JSON Schema to Zod dynamically is complex.
                        // Ideally we would parse tool.inputSchema into a Zod schema.
                        // For now, we define a generic object schema and inject the JSON schema description if possible,
                        // or rely on the description to guide the LLM.
                        schema: z.record(z.string(), z.any()).describe("JSON arguments for the tool"),
                        func: async (args) => {
                            const result = await client.callTool({
                                name: tool.name,
                                arguments: args
                            }, CallToolResultSchema);

                            // Format result
                            if (result.isError) {
                                throw new Error(`Tool execution failed: ${JSON.stringify(result)}`);
                            }

                            // Explicitly handle content type
                            const content = result.content as any[];

                            const textContent = content
                                .filter((c: any) => c.type === 'text')
                                .map((c: any) => c.text)
                                .join('\n');

                            return textContent || JSON.stringify(result.content);
                        }
                    }));
                }
            } catch (e) {
                console.error(`Error listing tools for ${serverName}:`, e);
            }
        }

        return tools;
    }
}

export const mcpManager = new McpManager();
