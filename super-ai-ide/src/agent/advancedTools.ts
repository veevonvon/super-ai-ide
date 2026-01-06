/**
 * Advanced File Tools - 高级文件操作工具
 * 
 * 功能：
 * - 智能代码编辑 (Search & Replace)
 * - 增强版 ripgrep 搜索
 * - 代码补丁应用
 */

import { tool, DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";

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

// ==================== 智能代码编辑工具 ====================

/**
 * 搜索替换工具 - 节省 Token，精确编辑
 */
export const searchReplaceTool = tool(
    async ({ filePath, searchPattern, replacement, isRegex, maxOccurrences }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, filePath);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        let content = fs.readFileSync(fullPath, "utf-8");
        const originalContent = content;
        let replacementCount = 0;
        const maxReplace = maxOccurrences ?? Infinity;

        if (isRegex) {
            const regex = new RegExp(searchPattern, "g");
            let match;
            while ((match = regex.exec(content)) !== null && replacementCount < maxReplace) {
                replacementCount++;
            }
            content = content.replace(
                new RegExp(searchPattern, "g"),
                (m, ...args) => {
                    if (replacementCount <= maxReplace) {
                        return replacement;
                    }
                    return m;
                }
            );
        } else {
            // 普通字符串替换
            let lastIndex = 0;
            let result = "";
            let searchLen = searchPattern.length;

            while (true) {
                const index = content.indexOf(searchPattern, lastIndex);
                if (index === -1 || replacementCount >= maxReplace) {
                    result += content.slice(lastIndex);
                    break;
                }
                result += content.slice(lastIndex, index) + replacement;
                lastIndex = index + searchLen;
                replacementCount++;
            }
            content = result;
        }

        if (replacementCount === 0) {
            return {
                success: false,
                message: "No matches found for the search pattern",
                filePath,
                searchPattern
            };
        }

        fs.writeFileSync(fullPath, content, "utf-8");

        return {
            success: true,
            filePath,
            replacementCount,
            message: `Replaced ${replacementCount} occurrence(s) in ${filePath}`
        };
    },
    {
        name: "search_replace",
        description: "Search and replace text in a file. More efficient than rewriting entire files. Use this for small, targeted edits.",
        schema: z.object({
            filePath: z.string().describe("Relative file path from workspace root"),
            searchPattern: z.string().describe("Text or regex pattern to search for"),
            replacement: z.string().describe("Replacement text"),
            isRegex: z.boolean().optional().describe("Treat searchPattern as regex. Default: false"),
            maxOccurrences: z.number().optional().describe("Maximum replacements to make. Default: all")
        })
    }
);

/**
 * 多点编辑工具 - 一次修改多个位置
 */
export const multiEditTool = tool(
    async ({ filePath, edits }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, filePath);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
        const results: { lineNumber: number; status: string }[] = [];

        // 按行号降序排序，从后往前编辑避免行号偏移
        const sortedEdits = [...edits].sort((a, b) => b.lineNumber - a.lineNumber);

        for (const edit of sortedEdits) {
            const lineIndex = edit.lineNumber - 1; // 转为 0-indexed

            if (lineIndex < 0 || lineIndex >= lines.length) {
                results.push({ lineNumber: edit.lineNumber, status: "invalid line number" });
                continue;
            }

            switch (edit.action) {
                case "replace":
                    lines[lineIndex] = edit.content || "";
                    results.push({ lineNumber: edit.lineNumber, status: "replaced" });
                    break;

                case "insert_before":
                    lines.splice(lineIndex, 0, edit.content || "");
                    results.push({ lineNumber: edit.lineNumber, status: "inserted before" });
                    break;

                case "insert_after":
                    lines.splice(lineIndex + 1, 0, edit.content || "");
                    results.push({ lineNumber: edit.lineNumber, status: "inserted after" });
                    break;

                case "delete":
                    lines.splice(lineIndex, 1);
                    results.push({ lineNumber: edit.lineNumber, status: "deleted" });
                    break;

                default:
                    results.push({ lineNumber: edit.lineNumber, status: "unknown action" });
            }
        }

        fs.writeFileSync(fullPath, lines.join("\n"), "utf-8");

        return {
            success: true,
            filePath,
            editCount: results.filter(r => !r.status.includes("invalid")).length,
            results
        };
    },
    {
        name: "multi_edit",
        description: "Make multiple edits to a file at specific line numbers. Efficient for scattered changes.",
        schema: z.object({
            filePath: z.string().describe("Relative file path from workspace root"),
            edits: z.array(z.object({
                lineNumber: z.number().describe("Line number to edit (1-indexed)"),
                action: z.enum(["replace", "insert_before", "insert_after", "delete"]),
                content: z.string().optional().describe("New content (not needed for delete)")
            })).describe("Array of edits to apply")
        })
    }
);

/**
 * 代码补丁应用工具 - 应用 unified diff 格式补丁
 */
export const applyPatchTool = tool(
    async ({ filePath, patch }) => {
        const rootPath = getWorkspaceRoot();
        const fullPath = path.join(rootPath, filePath);

        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const lines = fs.readFileSync(fullPath, "utf-8").split("\n");
        const patchLines = patch.split("\n");

        let lineOffset = 0;
        const changes: { type: string; line: number }[] = [];

        for (let i = 0; i < patchLines.length; i++) {
            const patchLine = patchLines[i];

            // 解析 hunk header: @@ -start,count +start,count @@
            const hunkMatch = patchLine.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
            if (hunkMatch) {
                continue;
            }

            if (patchLine.startsWith("-") && !patchLine.startsWith("---")) {
                // 删除行
                const targetLine = findLineToRemove(lines, patchLine.slice(1), lineOffset);
                if (targetLine !== -1) {
                    lines.splice(targetLine, 1);
                    changes.push({ type: "delete", line: targetLine + 1 });
                    lineOffset--;
                }
            } else if (patchLine.startsWith("+") && !patchLine.startsWith("+++")) {
                // 添加行 - 需要上下文定位
                const previousContext = findPreviousContext(patchLines, i);
                const insertAt = findInsertPosition(lines, previousContext, lineOffset);
                if (insertAt !== -1) {
                    lines.splice(insertAt, 0, patchLine.slice(1));
                    changes.push({ type: "add", line: insertAt + 1 });
                    lineOffset++;
                }
            }
        }

        fs.writeFileSync(fullPath, lines.join("\n"), "utf-8");

        return {
            success: true,
            filePath,
            changesApplied: changes.length,
            changes
        };
    },
    {
        name: "apply_patch",
        description: "Apply a unified diff patch to a file. Use for complex multi-line changes.",
        schema: z.object({
            filePath: z.string().describe("Relative file path from workspace root"),
            patch: z.string().describe("Unified diff format patch content")
        })
    }
);

// 辅助函数
function findLineToRemove(lines: string[], content: string, offset: number): number {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === content.trim()) {
            return i;
        }
    }
    return -1;
}

function findPreviousContext(patchLines: string[], currentIndex: number): string {
    for (let i = currentIndex - 1; i >= 0; i--) {
        if (patchLines[i].startsWith(" ")) {
            return patchLines[i].slice(1);
        }
    }
    return "";
}

function findInsertPosition(lines: string[], context: string, offset: number): number {
    if (!context) {return lines.length;}

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === context.trim()) {
            return i + 1;
        }
    }
    return lines.length;
}

// ==================== 增强版搜索工具 ====================

/**
 * Grep 搜索工具 - 使用 ripgrep 的高性能全文搜索
 */
export const grepSearchTool = tool(
    async ({ pattern, dirPath, fileTypes, caseSensitive, maxResults, contextLines }) => {
        const rootPath = getWorkspaceRoot();
        const searchPath = dirPath ? path.join(rootPath, dirPath) : rootPath;

        if (!fs.existsSync(searchPath)) {
            throw new Error(`Directory not found: ${dirPath || "workspace root"}`);
        }

        // 尝试使用 ripgrep，否则回退到 Node.js 实现
        try {
            return await ripgrepSearch({
                pattern,
                searchPath,
                rootPath,
                fileTypes,
                caseSensitive,
                maxResults: maxResults ?? 50,
                contextLines: contextLines ?? 0
            });
        } catch (rgError) {
            // ripgrep 不可用，使用内置实现
            return await nodeGrepSearch({
                pattern,
                searchPath,
                rootPath,
                fileTypes,
                caseSensitive: caseSensitive ?? false,
                maxResults: maxResults ?? 50
            });
        }
    },
    {
        name: "grep_search",
        description: "Search for text/pattern in files using high-performance grep. Returns matching lines with context.",
        schema: z.object({
            pattern: z.string().describe("Search pattern (regex supported)"),
            dirPath: z.string().optional().describe("Directory to search in. Default: workspace root"),
            fileTypes: z.array(z.string()).optional().describe("File extensions to include (e.g., ['ts', 'js'])"),
            caseSensitive: z.boolean().optional().describe("Case sensitive search. Default: false"),
            maxResults: z.number().optional().describe("Maximum results. Default: 50"),
            contextLines: z.number().optional().describe("Lines of context around matches. Default: 0")
        })
    }
);

interface GrepOptions {
    pattern: string;
    searchPath: string;
    rootPath: string;
    fileTypes?: string[];
    caseSensitive?: boolean;
    maxResults: number;
    contextLines?: number;
}

interface GrepResult {
    file: string;
    line: number;
    content: string;
    context?: { before: string[]; after: string[] };
}

/**
 * 使用 ripgrep 搜索
 */
async function ripgrepSearch(options: GrepOptions): Promise<{ results: GrepResult[]; totalMatches: number }> {
    return new Promise((resolve, reject) => {
        const args: string[] = [
            "--json",
            "--max-count", String(options.maxResults),
        ];

        if (!options.caseSensitive) {
            args.push("-i");
        }

        if (options.contextLines) {
            args.push("-C", String(options.contextLines));
        }

        if (options.fileTypes && options.fileTypes.length > 0) {
            for (const ft of options.fileTypes) {
                args.push("-g", `*.${ft}`);
            }
        }

        // 排除常见无关目录
        args.push("--glob", "!node_modules");
        args.push("--glob", "!.git");
        args.push("--glob", "!dist");
        args.push("--glob", "!build");

        args.push(options.pattern, options.searchPath);

        const rg = cp.spawn("rg", args, { cwd: options.rootPath });
        let output = "";
        let errorOutput = "";

        rg.stdout.on("data", (data) => {
            output += data.toString();
        });

        rg.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });

        rg.on("close", (code) => {
            if (code !== 0 && code !== 1) {
                reject(new Error(errorOutput || "ripgrep failed"));
                return;
            }

            const results: GrepResult[] = [];
            const lines = output.split("\n").filter(l => l.trim());

            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.type === "match") {
                        const relPath = path.relative(options.rootPath, json.data.path.text);
                        results.push({
                            file: relPath,
                            line: json.data.line_number,
                            content: json.data.lines.text.trim()
                        });
                    }
                } catch {
                    // Ignore parse errors
                }
            }

            resolve({ results, totalMatches: results.length });
        });

        rg.on("error", reject);
    });
}

/**
 * Node.js 内置 grep 实现 (备选方案)
 */
async function nodeGrepSearch(options: GrepOptions & { caseSensitive: boolean }): Promise<{ results: GrepResult[]; totalMatches: number }> {
    const results: GrepResult[] = [];
    const regex = new RegExp(options.pattern, options.caseSensitive ? "g" : "gi");

    function searchDir(dir: string) {
        if (results.length >= options.maxResults) {return;}

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (results.length >= options.maxResults) {break;}

            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(options.rootPath, fullPath);

            // 跳过排除的目录
            if (entry.isDirectory()) {
                if (["node_modules", ".git", "dist", "build", "__pycache__"].includes(entry.name)) {
                    continue;
                }
                searchDir(fullPath);
                continue;
            }

            // 检查文件类型
            if (options.fileTypes && options.fileTypes.length > 0) {
                const ext = path.extname(entry.name).slice(1);
                if (!options.fileTypes.includes(ext)) {
                    continue;
                }
            }

            // 跳过二进制文件
            const ext = path.extname(entry.name).toLowerCase();
            if ([".png", ".jpg", ".gif", ".pdf", ".exe", ".dll", ".zip"].includes(ext)) {
                continue;
            }

            try {
                const content = fs.readFileSync(fullPath, "utf-8");
                const lines = content.split("\n");

                for (let i = 0; i < lines.length && results.length < options.maxResults; i++) {
                    if (regex.test(lines[i])) {
                        results.push({
                            file: relPath,
                            line: i + 1,
                            content: lines[i].trim()
                        });
                    }
                }
            } catch {
                // Skip unreadable files
            }
        }
    }

    searchDir(options.searchPath);

    return { results, totalMatches: results.length };
}

/**
 * 符号搜索工具 - 搜索函数、类、变量定义
 */
export const findSymbolTool = tool(
    async ({ symbolName, symbolType, dirPath }) => {
        const rootPath = getWorkspaceRoot();
        const searchPath = dirPath ? path.join(rootPath, dirPath) : rootPath;

        const patterns: Record<string, string> = {
            function: `(function\\s+${symbolName}|const\\s+${symbolName}\\s*=|${symbolName}\\s*=\\s*function|${symbolName}\\s*\\()`,
            class: `class\\s+${symbolName}`,
            variable: `(const|let|var)\\s+${symbolName}\\s*=`,
            interface: `interface\\s+${symbolName}`,
            type: `type\\s+${symbolName}\\s*=`,
            export: `export\\s+(const|function|class|interface|type)\\s+${symbolName}`
        };

        const pattern = symbolType && patterns[symbolType]
            ? patterns[symbolType]
            : Object.values(patterns).join("|");

        try {
            const result = await nodeGrepSearch({
                pattern,
                searchPath,
                rootPath,
                caseSensitive: true,
                maxResults: 20
            });

            return {
                symbolName,
                symbolType: symbolType || "any",
                matches: result.results,
                totalFound: result.totalMatches
            };
        } catch (error: any) {
            return {
                symbolName,
                symbolType: symbolType || "any",
                matches: [],
                totalFound: 0,
                error: error.message
            };
        }
    },
    {
        name: "find_symbol",
        description: "Find function, class, variable, or type definitions by name. Useful for understanding code structure.",
        schema: z.object({
            symbolName: z.string().describe("Name of the symbol to find"),
            symbolType: z.enum(["function", "class", "variable", "interface", "type", "export"]).optional()
                .describe("Type of symbol to search for. Default: search all types"),
            dirPath: z.string().optional().describe("Directory to search in. Default: workspace root")
        })
    }
);

// ==================== 导出所有高级工具 ====================

export const advancedFileTools = [
    searchReplaceTool,
    multiEditTool,
    applyPatchTool,
    grepSearchTool,
    findSymbolTool
];

export function getAllAdvancedTools() {
    return advancedFileTools;
}
