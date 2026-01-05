import { tool, StructuredTool } from "@langchain/core/tools";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { permissionManager, PermissionLevel } from "./permissions";
import { advancedFileTools } from "./advancedTools";
import { AgentConfig } from "./types";
import { createRequestSubAgentTool } from "./subAgentTool";
import { lspTools } from "./lspTools";

/**
 * 获取工作区根路径
 */
function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error("No workspace folder open");
    }
    return folders[0].uri.fsPath;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * 权限控制包装器
 * 为工具添加运行前权限检查
 */
function withPermissionCheck(originalTool: StructuredTool): StructuredTool {
    // 拦截 call/invoke 方法
    const originalCall = originalTool.call.bind(originalTool);

    originalTool.call = async (arg: any, configArg?: any) => {
        // 1. 检查权限
        const permResult = await permissionManager.checkPermission(originalTool.name, arg);

        if (!permResult.granted) {
            throw new Error(`Permission denied: ${permResult.reason || "User rejected operation"}`);
        }

        // 2. 如果有修改后的参数（例如路径修正），使用新参数
        const finalArgs = permResult.modifiedArgs || arg;

        // 3. 执行原工具
        return originalCall(finalArgs, configArg);
    };

    return originalTool;
}

// ==================== Basic File System Tools ====================

/**
 * List Files Tool - 列出目录中的文件
 */
export const listFilesTool = tool(
    async ({ dirPath }) => {
        const rootPath = getWorkspaceRoot();
        const targetPath = dirPath ? path.join(rootPath, dirPath) : rootPath;

        if (!fs.existsSync(targetPath)) {
            throw new Error(`Directory not found: ${dirPath || "workspace root"}`);
        }

        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        return entries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file"
        }));
    },
    {
        name: "list_files",
        description: "List files and directories in a path. Default is workspace root. Returns array of {name, type}.",
        schema: z.object({
            dirPath: z.string().optional().describe("Relative directory path from workspace root. Leave empty for root.")
        })
    }
);

/**
 * Read File Tool - 读取文件内容
 */
export const readFileTool = tool(
    async ({ filePath }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, filePath);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
            throw new Error(`Path is a directory, not a file: ${filePath}`);
        }

        return fs.readFileSync(fullPath, "utf-8");
    },
    {
        name: "read_file",
        description: "Read the content of a file. Returns the file content as string.",
        schema: z.object({
            filePath: z.string().describe("Relative file path from workspace root")
        })
    }
);

/**
 * Write File Tool - 写入文件内容
 */
export const writeFileTool = tool(
    async ({ filePath, content }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, filePath);

        // 确保目录存在
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, "utf-8");
        return { success: true, path: filePath, message: `File written successfully: ${filePath}` };
    },
    {
        name: "write_file",
        description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
        schema: z.object({
            filePath: z.string().describe("Relative file path from workspace root"),
            content: z.string().describe("Content to write to the file")
        })
    }
);

/**
 * Create Directory Tool - 创建目录
 */
export const createDirectoryTool = tool(
    async ({ dirPath }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, dirPath);

        fs.mkdirSync(fullPath, { recursive: true });
        return { success: true, path: dirPath, message: `Directory created: ${dirPath}` };
    },
    {
        name: "create_directory",
        description: "Create a new directory (including parent directories if needed).",
        schema: z.object({
            dirPath: z.string().describe("Relative directory path to create")
        })
    }
);

/**
 * Delete File Tool - 删除文件或目录
 */
export const deleteFileTool = tool(
    async ({ filePath, recursive }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, filePath);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`Path not found: ${filePath}`);
        }

        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
            fs.rmSync(fullPath, { recursive: recursive ?? false });
        } else {
            fs.unlinkSync(fullPath);
        }

        return { success: true, deleted: filePath, message: `Deleted: ${filePath}` };
    },
    {
        name: "delete_file",
        description: "Delete a file or directory. For non-empty directories, set recursive to true.",
        schema: z.object({
            filePath: z.string().describe("Relative path to delete"),
            recursive: z.boolean().optional().describe("If true, recursively delete non-empty directories")
        })
    }
);

/**
 * Rename/Move File Tool - 重命名或移动文件
 */
export const renameFileTool = tool(
    async ({ oldPath, newPath }) => {
        const rootPath = getWorkspaceRoot();
        const fullOldPath = path.join(rootPath, oldPath);
        const fullNewPath = path.join(rootPath, newPath);

        if (!fs.existsSync(fullOldPath)) {
            throw new Error(`Source path not found: ${oldPath}`);
        }

        // 确保目标目录存在
        const targetDir = path.dirname(fullNewPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.renameSync(fullOldPath, fullNewPath);
        return { success: true, from: oldPath, to: newPath, message: `Renamed: ${oldPath} -> ${newPath}` };
    },
    {
        name: "rename_file",
        description: "Rename or move a file/directory to a new location.",
        schema: z.object({
            oldPath: z.string().describe("Current relative path"),
            newPath: z.string().describe("New relative path")
        })
    }
);

/**
 * Search Files Tool - 搜索文件
 */
export const searchFilesTool = tool(
    async ({ pattern, dirPath }) => {
        const rootPath = getWorkspaceRoot();
        const searchPath = dirPath ? path.join(rootPath, dirPath) : rootPath;

        const results: string[] = [];
        // 简单转义通配符
        const regex = new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."), "i");

        function searchDir(dir: string, relativePath: string = "") {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

                // 跳过隐藏文件和 node_modules
                if (entry.name.startsWith(".") || entry.name === "node_modules") {
                    continue;
                }

                if (regex.test(entry.name)) {
                    results.push(entryRelPath);
                }

                if (entry.isDirectory()) {
                    searchDir(path.join(dir, entry.name), entryRelPath);
                }
            }
        }

        searchDir(searchPath);
        return results.slice(0, 50); // 限制结果数量
    },
    {
        name: "search_files",
        description: "Search for files matching a glob pattern (e.g., '*.ts', 'test*'). Returns matching file paths.",
        schema: z.object({
            pattern: z.string().describe("Glob pattern to match (e.g., '*.ts', 'test*.js')"),
            dirPath: z.string().optional().describe("Directory to search in. Default is workspace root.")
        })
    }
);

/**
 * Get File Info Tool - 获取文件信息
 */
export const getFileInfoTool = tool(
    async ({ filePath }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, filePath);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`Path not found: ${filePath}`);
        }

        const stats = fs.statSync(fullPath);
        return {
            path: filePath,
            type: stats.isDirectory() ? "directory" : "file",
            size: formatFileSize(stats.size),
            sizeBytes: stats.size,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString()
        };
    },
    {
        name: "get_file_info",
        description: "Get file/directory metadata including size, creation time, and modification time.",
        schema: z.object({
            filePath: z.string().describe("Relative path to get info for")
        })
    }
);

// ==================== Terminal Command Tool ====================

/**
 * 创建终端命令工具
 * 权限完全委托给 PermissionManager
 */
export function createRunTerminalCommandTool() {
    return new DynamicStructuredTool({
        name: "run_terminal_command",
        description: "Execute a terminal/shell command. Use this for running build commands, installing packages, running scripts, etc.",
        schema: z.object({
            command: z.string().describe("The command to execute in the terminal"),
            cwd: z.string().optional().describe("Working directory for the command. Relative to workspace root. Leave empty for workspace root.")
        }),
        func: async ({ command, cwd }) => {
            // 注意：此处不再需要手动调用 confirm，因为 withPermissionCheck 已经处理了
            // 如果 PermissionManager 的 EXECUTE 级别配置了 requiresConfirmation=true，会自动触发确认

            const rootPath = getWorkspaceRoot();
            const workDir = cwd ? path.join(rootPath, cwd) : rootPath;

            if (!fs.existsSync(workDir)) {
                throw new Error(`Working directory not found: ${cwd || "workspace root"}`);
            }

            return new Promise((resolve) => {
                cp.exec(command, { cwd: workDir, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                    if (error) {
                        resolve({
                            success: false,
                            executed: true,
                            command: command,
                            exitCode: error.code || 1,
                            stdout: stdout.trim(),
                            stderr: stderr.trim(),
                            error: error.message
                        });
                    } else {
                        resolve({
                            success: true,
                            executed: true,
                            command: command,
                            exitCode: 0,
                            stdout: stdout.trim(),
                            stderr: stderr.trim()
                        });
                    }
                });
            });
        }
    });
}

// ==================== Export All Tools ====================

// 基础工具列表
const basicTools = [
    listFilesTool,
    readFileTool,
    writeFileTool,
    createDirectoryTool,
    deleteFileTool,
    renameFileTool,
    searchFilesTool,
    getFileInfoTool
];

/**
 * 获取所有工具并应用权限控制
 */
export function getAllTools(config?: AgentConfig) {
    // 1. 合并所有工具：基础 + 高级 + 终端
    const allRawTools: StructuredTool[] = [
        ...basicTools,
        ...advancedFileTools,
        ...lspTools,
        createRunTerminalCommandTool()
    ];

    // 如果提供了配置，添加 Sub-Agent 工具
    if (config) {
        allRawTools.push(createRequestSubAgentTool(config));
    }

    // 2. 为每个工具应用权限检查包装器
    return allRawTools.map(t => withPermissionCheck(t));
}

// 向后兼容导出 (不包含 sub-agent)
export const allTools = getAllTools();
