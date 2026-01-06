/**
 * AI System Prompts - 系统提示词定义
 */

/**
 * 默认系统提示词 - 包含工具说明
 */
export const SYSTEM_PROMPT = `You are a helpful AI coding assistant in VS Code.
You have access to the local file system through tools.
To use a tool, you MUST output ONLY a JSON object in the following format:
{"tool": "tool_name", "args": { ... }}

Available Tools:
- list_files(path?: string): List files in a directory. Default is workspace root. Returns array of {name, type}.
- read_file(path: string): Read content of a file. Returns the file content as string.
- write_file(path: string, content: string): Write/overwrite content to a file.
- create_directory(path: string): Create a new directory (including parent directories).
- delete_file(path: string): Delete a file or empty directory.
- rename_file(oldPath: string, newPath: string): Rename or move a file/directory.
- search_files(pattern: string, path?: string): Search for files matching glob pattern. Default path is workspace root.
- get_file_info(path: string): Get file metadata (size, modified time, type).

IMPORTANT:
- Always use relative paths from workspace root.
- After using a tool, analyze the result and provide helpful feedback.
- For file operations, confirm what was done.
- If you don't need a tool, just answer normally.
`;

/**
 * 生成带上下文的系统提示词
 * @param workspaceName 当前工作区名称
 * @param additionalContext 额外上下文信息
 */
export function generateSystemPrompt(workspaceName?: string, additionalContext?: string): string {
    let prompt = SYSTEM_PROMPT;

    if (workspaceName) {
        prompt += `\nCurrent Workspace: ${workspaceName}\n`;
    }

    if (additionalContext) {
        prompt += `\nAdditional Context:\n${additionalContext}\n`;
    }

    return prompt;
}

/**
 * AI 模型配置
 */
export const MODEL_OPTIONS = [
    {
        id: 'deepseek/deepseek-r1-distill-llama-70b:free',
        name: 'DeepSeek R1 Distill Llama 70B (Free)',
        description: 'Free tier model with good performance'
    },
    {
        id: 'deepseek/deepseek-chat',
        name: 'DeepSeek Chat',
        description: 'DeepSeek Chat model'
    },
    {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        description: 'OpenAI GPT-4o model'
    },
    {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        description: 'Anthropic Claude 3.5 Sonnet model'
    }
];

/**
 * 工具调用输出格式化
 */
export function formatToolOutput(toolName: string, result: any): string {
    return `\n\n📁 **Tool: ${toolName}**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
}

/**
 * 工具结果消息
 */
export function getToolResultMessage(toolName: string, result: any): string {
    return `Tool "${toolName}" executed. Result:\n${JSON.stringify(result, null, 2)}\n\nPlease analyze the result and continue.`;
}
