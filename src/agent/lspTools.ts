
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as vscode from "vscode";
import * as path from "path";

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
 * Helper: Resolve file path and position
 */
async function resolveLocation(filePath: string, lineNumber: number, symbolText?: string): Promise<{ uri: vscode.Uri, position: vscode.Position }> {
    const rootPath = getWorkspaceRoot();
    const fullPath = path.join(rootPath, filePath);
    const uri = vscode.Uri.file(fullPath);

    // Open text document to ensure we can read it and map position
    const doc = await vscode.workspace.openTextDocument(uri);

    // Line number is 1-based from agent, convert to 0-based
    const lineIndex = lineNumber - 1;
    if (lineIndex < 0 || lineIndex >= doc.lineCount) {
        throw new Error(`Line number ${lineNumber} is out of range (1-${doc.lineCount})`);
    }

    let charIndex = 0;
    if (symbolText) {
        const lineText = doc.lineAt(lineIndex).text;
        const idx = lineText.indexOf(symbolText);
        if (idx !== -1) {
            charIndex = idx;
        }
    }

    return { uri, position: new vscode.Position(lineIndex, charIndex) };
}

/**
 * Tool: Get Definition
 * Uses VS Code LSP to find definition of a symbol at a specific location.
 */
export const getDefinitionTool = tool(
    async ({ filePath, lineNumber, symbolText }) => {
        try {
            const { uri, position } = await resolveLocation(filePath, lineNumber, symbolText);

            // Execute VS Code command
            const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeDefinitionProvider',
                uri,
                position
            );

            if (!locations || locations.length === 0) {
                return "No definition found.";
            }

            // Format results
            const results = locations.map(loc => {
                let targetUri: vscode.Uri;
                let range: vscode.Range;

                if ('targetUri' in loc) {
                    // LocationLink
                    targetUri = loc.targetUri;
                    range = loc.targetRange;
                } else {
                    // Location
                    targetUri = loc.uri;
                    range = loc.range;
                }

                const relativePath = vscode.workspace.asRelativePath(targetUri);
                return `${relativePath}:${range.start.line + 1}:${range.start.character + 1}`;
            });

            return results.join("\n");

        } catch (error: any) {
            return `Error getting definition: ${error.message}`;
        }
    },
    {
        name: "get_symbol_definition",
        description: "Get the definition location of a symbol (function, class, variable) using LSP. Requires file path and line number.",
        schema: z.object({
            filePath: z.string().describe("Relative path to the file"),
            lineNumber: z.number().describe("Line number containing the symbol usage (1-indexed)"),
            symbolText: z.string().optional().describe("The text of the symbol to find definition for (helps locate exact character position)")
        })
    }
);

/**
 * Tool: Get References
 * Uses VS Code LSP to find all references of a symbol.
 */
export const getReferencesTool = tool(
    async ({ filePath, lineNumber, symbolText }) => {
        try {
            const { uri, position } = await resolveLocation(filePath, lineNumber, symbolText);

            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                position
            );

            if (!locations || locations.length === 0) {
                return "No references found.";
            }

            const results = locations.map(loc => {
                const relativePath = vscode.workspace.asRelativePath(loc.uri);
                return `${relativePath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
            });

            // unique and limit
            const uniqueResults = [...new Set(results)].slice(0, 50);

            return `Found ${results.length} references (showing top ${uniqueResults.length}):\n` + uniqueResults.join("\n");

        } catch (error: any) {
            return `Error getting references: ${error.message}`;
        }
    },
    {
        name: "get_symbol_references",
        description: "Find all places where a symbol is used in the workspace using LSP.",
        schema: z.object({
            filePath: z.string().describe("Relative path to the file"),
            lineNumber: z.number().describe("Line number containing the symbol (1-indexed)"),
            symbolText: z.string().optional().describe("The text of the symbol")
        })
    }
);

/**
 * Tool: Get Diagnostics (Errors/Warnings)
 * Gets current file diagnostics.
 */
export const getDiagnosticsTool = tool(
    async ({ filePath }) => {
        try {
            const rootPath = getWorkspaceRoot();
            const fullPath = path.join(rootPath, filePath);
            const uri = vscode.Uri.file(fullPath);

            const diagnostics = vscode.languages.getDiagnostics(uri);

            if (diagnostics.length === 0) {
                return "No errors or warnings found in this file.";
            }

            return diagnostics.map(d => {
                const range = `${d.range.start.line + 1}:${d.range.start.character + 1}-${d.range.end.line + 1}:${d.range.end.character + 1}`;
                const severity = d.severity === vscode.DiagnosticSeverity.Error ? "Error" :
                    d.severity === vscode.DiagnosticSeverity.Warning ? "Warning" : "Info";
                return `[${severity}] Line ${d.range.start.line + 1}: ${d.message} (${d.source || 'unknown'})`;
            }).join("\n");

        } catch (error: any) {
            return `Error getting diagnostics: ${error.message}`;
        }
    },
    {
        name: "get_file_diagnostics",
        description: "Get compilation errors and warnings for a specific file.",
        schema: z.object({
            filePath: z.string().describe("Relative path to the file")
        })
    }
);

export const lspTools = [
    getDefinitionTool,
    getReferencesTool,
    getDiagnosticsTool
];
