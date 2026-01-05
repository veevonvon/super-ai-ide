/**
 * Permissions & Security - 权限与安全管理模块
 * 
 * 功能：
 * - 细粒度权限分类
 * - 操作预览 (Dry Run)
 * - 危险操作拦截
 */

import * as vscode from "vscode";
import * as path from "path";

/**
 * 权限级别
 */
export enum PermissionLevel {
    READ = "read",           // 读取操作 (低风险)
    WRITE = "write",         // 写入操作 (中风险)
    DELETE = "delete",       // 删除操作 (高风险)
    EXECUTE = "execute",     // 执行命令 (高风险)
    SYSTEM = "system"        // 系统级操作 (极高风险)
}

/**
 * 工具权限定义
 */
export interface ToolPermission {
    name: string;
    level: PermissionLevel;
    requiresConfirmation: boolean;
    description: string;
    dangerousPatterns?: RegExp[];  // 危险参数模式
}

/**
 * 操作预览 (Dry Run) 结果
 */
export interface DryRunResult {
    toolName: string;
    operation: string;
    affectedPaths: string[];
    estimatedImpact: "low" | "medium" | "high" | "critical";
    warnings: string[];
    canProceed: boolean;
}

/**
 * 权限请求
 */
export interface PermissionRequest {
    toolName: string;
    args: Record<string, any>;
    level: PermissionLevel;
    reason: string;
}

/**
 * 权限响应
 */
export interface PermissionResponse {
    granted: boolean;
    reason?: string;
    modifiedArgs?: Record<string, any>;
}

/**
 * 预定义的工具权限配置
 */
export const TOOL_PERMISSIONS: Record<string, ToolPermission> = {
    // 读取操作 - 低风险
    list_files: {
        name: "list_files",
        level: PermissionLevel.READ,
        requiresConfirmation: false,
        description: "List directory contents"
    },
    read_file: {
        name: "read_file",
        level: PermissionLevel.READ,
        requiresConfirmation: false,
        description: "Read file content"
    },
    search_files: {
        name: "search_files",
        level: PermissionLevel.READ,
        requiresConfirmation: false,
        description: "Search for files"
    },
    get_file_info: {
        name: "get_file_info",
        level: PermissionLevel.READ,
        requiresConfirmation: false,
        description: "Get file metadata"
    },
    grep_search: {
        name: "grep_search",
        level: PermissionLevel.READ,
        requiresConfirmation: false,
        description: "Search content in files"
    },

    // 写入操作 - 中风险
    write_file: {
        name: "write_file",
        level: PermissionLevel.WRITE,
        requiresConfirmation: false,  // 普通写入不需要确认
        description: "Write to file",
        dangerousPatterns: [
            /\.(exe|dll|so|bat|sh|ps1)$/i,  // 可执行文件
            /^\.env/,                        // 环境变量文件
            /package\.json$/,                // 包管理文件
            /\.(key|pem|crt)$/i              // 密钥文件
        ]
    },
    create_directory: {
        name: "create_directory",
        level: PermissionLevel.WRITE,
        requiresConfirmation: false,
        description: "Create directory"
    },
    rename_file: {
        name: "rename_file",
        level: PermissionLevel.WRITE,
        requiresConfirmation: false,
        description: "Rename or move file"
    },
    patch_file: {
        name: "patch_file",
        level: PermissionLevel.WRITE,
        requiresConfirmation: false,
        description: "Apply patch to file"
    },

    // 删除操作 - 高风险
    delete_file: {
        name: "delete_file",
        level: PermissionLevel.DELETE,
        requiresConfirmation: true,  // 删除需要确认
        description: "Delete file or directory",
        dangerousPatterns: [
            /^\.git\//,           // Git 目录
            /node_modules/,       // 依赖目录
            /^\.\//,              // 工作区根目录
            /\*\*/                // 通配符删除
        ]
    },

    // 执行操作 - 高风险
    run_terminal_command: {
        name: "run_terminal_command",
        level: PermissionLevel.EXECUTE,
        requiresConfirmation: true,  // 执行命令必须确认
        description: "Execute terminal command",
        dangerousPatterns: [
            /\brm\s+-rf\b/i,          // 危险删除
            /\bsudo\b/i,              // sudo 命令
            /\bformat\b/i,            // 格式化
            /\b(curl|wget).*\|.*sh\b/,// 远程脚本执行
            /\bchmod\s+777\b/,        // 危险权限
            /\bkill\s+-9\b/,          // 强制终止
            /\bexit\b/,               // 退出
            /[;&|`$]/                 // Shell 特殊字符
        ]
    }
};

/**
 * 权限管理器
 */
export class PermissionManager {
    private autoApproveRead: boolean = true;
    private autoApproveWrite: boolean = false;
    private blockedPatterns: RegExp[] = [];
    private onConfirmRequest?: (request: PermissionRequest) => Promise<PermissionResponse>;

    constructor() {
        this.loadSettings();
    }

    /**
     * 从 VS Code 设置加载权限配置
     */
    private loadSettings() {
        const config = vscode.workspace.getConfiguration("super-ai-ide");
        this.autoApproveRead = config.get<boolean>("autoApproveReadOperations", true);
        this.autoApproveWrite = config.get<boolean>("autoApproveWriteOperations", false);
    }

    /**
     * 设置确认回调
     */
    setConfirmCallback(callback: (request: PermissionRequest) => Promise<PermissionResponse>) {
        this.onConfirmRequest = callback;
    }

    /**
     * 检查工具调用权限
     */
    async checkPermission(toolName: string, args: Record<string, any>): Promise<PermissionResponse> {
        const permission = TOOL_PERMISSIONS[toolName];

        if (!permission) {
            // 未知工具，默认需要确认
            return this.requestConfirmation({
                toolName,
                args,
                level: PermissionLevel.SYSTEM,
                reason: "Unknown tool - requires manual approval"
            });
        }

        // 检查危险模式
        const dangerousMatch = this.checkDangerousPatterns(permission, args);
        if (dangerousMatch) {
            return this.requestConfirmation({
                toolName,
                args,
                level: permission.level,
                reason: `Potentially dangerous operation detected: ${dangerousMatch}`
            });
        }

        // 根据权限级别自动处理
        switch (permission.level) {
            case PermissionLevel.READ:
                if (this.autoApproveRead) {
                    return { granted: true };
                }
                break;

            case PermissionLevel.WRITE:
                if (this.autoApproveWrite) {
                    return { granted: true };
                }
                break;

            case PermissionLevel.DELETE:
            case PermissionLevel.EXECUTE:
            case PermissionLevel.SYSTEM:
                // 高风险操作总是需要确认
                break;
        }

        // 需要确认的操作
        if (permission.requiresConfirmation) {
            return this.requestConfirmation({
                toolName,
                args,
                level: permission.level,
                reason: permission.description
            });
        }

        return { granted: true };
    }

    /**
     * 检查危险参数模式
     */
    private checkDangerousPatterns(
        permission: ToolPermission,
        args: Record<string, any>
    ): string | null {
        if (!permission.dangerousPatterns) {
            return null;
        }

        const argsString = JSON.stringify(args);

        for (const pattern of permission.dangerousPatterns) {
            if (pattern.test(argsString)) {
                return pattern.toString();
            }
        }

        return null;
    }

    /**
     * 请求用户确认
     */
    private async requestConfirmation(request: PermissionRequest): Promise<PermissionResponse> {
        if (this.onConfirmRequest) {
            return this.onConfirmRequest(request);
        }

        // 默认使用 VS Code 对话框
        const levelEmoji = {
            [PermissionLevel.READ]: "📖",
            [PermissionLevel.WRITE]: "✏️",
            [PermissionLevel.DELETE]: "🗑️",
            [PermissionLevel.EXECUTE]: "⚡",
            [PermissionLevel.SYSTEM]: "⚠️"
        };

        const message = `${levelEmoji[request.level]} AI wants to execute: ${request.toolName}\n\n` +
            `Args: ${JSON.stringify(request.args, null, 2)}\n\n` +
            `Reason: ${request.reason}`;

        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            "Allow",
            "Deny"
        );

        return {
            granted: result === "Allow"
        };
    }

    /**
     * 生成操作预览 (Dry Run)
     */
    generateDryRun(toolName: string, args: Record<string, any>): DryRunResult {
        const affectedPaths: string[] = [];
        const warnings: string[] = [];
        let estimatedImpact: DryRunResult["estimatedImpact"] = "low";
        let canProceed = true;

        // 提取受影响的路径
        for (const [key, value] of Object.entries(args)) {
            if (typeof value === "string" && (key.includes("path") || key.includes("Path"))) {
                affectedPaths.push(value);
            }
        }

        // 根据工具类型评估影响
        switch (toolName) {
            case "delete_file":
                estimatedImpact = args.recursive ? "critical" : "high";
                warnings.push("⚠️ This operation will permanently delete files");
                if (args.recursive) {
                    warnings.push("🔴 Recursive deletion enabled - all contents will be removed");
                }
                break;

            case "write_file":
                estimatedImpact = "medium";
                if (args.content?.length > 10000) {
                    warnings.push("📝 Large file write operation");
                }
                break;

            case "run_terminal_command":
                estimatedImpact = "high";
                warnings.push("⚡ Terminal command execution");

                const cmd = args.command || "";
                if (/sudo|rm\s+-rf|format|mkfs/i.test(cmd)) {
                    estimatedImpact = "critical";
                    warnings.push("🔴 Potentially destructive command detected");
                    canProceed = false;
                }
                break;

            case "rename_file":
                estimatedImpact = "medium";
                warnings.push("📁 File will be moved/renamed");
                break;

            default:
                estimatedImpact = "low";
        }

        // 检查是否涉及敏感路径
        const sensitivePaths = [".git", "node_modules", ".env", "package-lock.json"];
        for (const affectedPath of affectedPaths) {
            for (const sensitive of sensitivePaths) {
                if (affectedPath.includes(sensitive)) {
                    warnings.push(`⚠️ Operation affects sensitive path: ${sensitive}`);
                    if (estimatedImpact === "low") estimatedImpact = "medium";
                }
            }
        }

        return {
            toolName,
            operation: this.getOperationDescription(toolName, args),
            affectedPaths,
            estimatedImpact,
            warnings,
            canProceed
        };
    }

    /**
     * 获取操作描述
     */
    private getOperationDescription(toolName: string, args: Record<string, any>): string {
        switch (toolName) {
            case "list_files":
                return `List files in: ${args.dirPath || "workspace root"}`;
            case "read_file":
                return `Read file: ${args.filePath}`;
            case "write_file":
                return `Write ${args.content?.length || 0} chars to: ${args.filePath}`;
            case "delete_file":
                return `Delete: ${args.filePath}${args.recursive ? " (recursive)" : ""}`;
            case "rename_file":
                return `Rename: ${args.oldPath} → ${args.newPath}`;
            case "run_terminal_command":
                return `Execute: ${args.command}`;
            default:
                return `${toolName}: ${JSON.stringify(args)}`;
        }
    }

    /**
     * 格式化 Dry Run 结果为用户友好的字符串
     */
    formatDryRunResult(result: DryRunResult): string {
        const impactEmoji = {
            low: "🟢",
            medium: "🟡",
            high: "🟠",
            critical: "🔴"
        };

        let output = `\n## 🔍 Operation Preview\n\n`;
        output += `**Operation:** ${result.operation}\n`;
        output += `**Impact Level:** ${impactEmoji[result.estimatedImpact]} ${result.estimatedImpact.toUpperCase()}\n`;

        if (result.affectedPaths.length > 0) {
            output += `\n**Affected Paths:**\n`;
            for (const p of result.affectedPaths) {
                output += `- \`${p}\`\n`;
            }
        }

        if (result.warnings.length > 0) {
            output += `\n**Warnings:**\n`;
            for (const w of result.warnings) {
                output += `${w}\n`;
            }
        }

        output += `\n**Can Proceed:** ${result.canProceed ? "✅ Yes" : "❌ No - Requires manual intervention"}\n`;

        return output;
    }
}

// 导出单例
export const permissionManager = new PermissionManager();
