import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { runAgentWithStream } from "./agent";
import { permissionManager, PermissionRequest, PermissionResponse } from "./agent/permissions";
import { ProviderType } from "./agent/providers/factory";

interface Message {
    id: string;
    role: string;
    content: string;
    tags?: string[];
    timestamp?: number;
}

interface Session {
    id: string;
    name: string;
    messages: Message[];
}

export class SidebarProvider implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    _currentSessionId?: string;

    // 用于存储待确认的权限请求及其 resolve 回调
    private _pendingPermissions: Map<string, {
        resolve: (response: PermissionResponse) => void;
    }> = new Map();

    constructor(private readonly _context: vscode.ExtensionContext) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 初始化权限管理器回调
        this._setupPermissionHandler(webviewView);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case "init": {
                    const sessions = this._getSessions();
                    webviewView.webview.postMessage({ type: "updateSessions", value: sessions });
                    if (sessions.length > 0) {
                        this._selectSession(sessions[0].id);
                    } else {
                        await this._createSession();
                    }
                    break;
                }
                case "createSession": {
                    await this._createSession();
                    break;
                }
                case "deleteSession": {
                    await this._deleteSession(data.id);
                    break;
                }
                case "selectSession": {
                    this._selectSession(data.id);
                    break;
                }
                case "askAI": {
                    const { text } = data;
                    if (!text) return;

                    await this._handleAskAI(text, webviewView);
                    break;
                }
                // 处理权限确认响应
                case "permissionResponse": {
                    const { id, granted } = data;
                    const pending = this._pendingPermissions.get(id);
                    if (pending) {
                        pending.resolve({ granted });
                        this._pendingPermissions.delete(id);
                    }
                    break;
                }
                // case "commandConfirmResponse": {
                //    Legacy code removed
                //    break;
                // }
                case "openSettings": {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'super-ai-ide');
                    break;
                }
                case "undoLastMessage": {
                    await this._undoLastMessage();
                    break;
                }
                case "addTag": {
                    const { messageId, tag } = data;
                    await this._addTag(messageId, tag);
                    break;
                }
                case "removeTag": {
                    const { messageId, tag } = data;
                    await this._removeTag(messageId, tag);
                    break;
                }
            }
        });
    }

    /**
     * 设置权限请求处理器
     */
    private _setupPermissionHandler(webviewView: vscode.WebviewView) {
        permissionManager.setConfirmCallback(async (request: PermissionRequest) => {
            return new Promise<PermissionResponse>((resolve) => {
                const reqId = `perm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // 存储回调
                this._pendingPermissions.set(reqId, { resolve });

                // 生成 Dry Run 预览
                const dryRun = permissionManager.generateDryRun(request.toolName, request.args);
                const dryRunText = permissionManager.formatDryRunResult(dryRun);

                // 发送请求到 Webview
                webviewView.webview.postMessage({
                    type: 'requestPermission',
                    id: reqId,
                    request: request,
                    dryRun: dryRunText
                });
            });
        });
    }

    /**
     * 处理 AI 请求
     */
    private async _handleAskAI(text: string, webviewView: vscode.WebviewView) {

        // 1. Save User Message
        const sessions = this._getSessions();
        const session = sessions.find(s => s.id === this._currentSessionId);
        if (session) {
            session.messages.push({
                id: Date.now().toString() + Math.random().toString().slice(2, 5),
                role: "user",
                content: text,
                timestamp: Date.now()
            });
            await this._saveSessions(sessions);
        }

        // 2. Get Settings
        const config = vscode.workspace.getConfiguration('super-ai-ide');
        const apiKey = config.get<string>('openRouterApiKey');
        const model = config.get<string>('model') || 'deepseek/deepseek-chat';

        if (!apiKey) {
            webviewView.webview.postMessage({
                type: 'addResponse',
                value: 'Please set your **OpenRouter API Key** in VS Code Settings (Ctrl+, -> Super AI IDE).'
            });
            return;
        }


        // 3. Start streaming
        webviewView.webview.postMessage({ type: 'startStream' });

        try {
            // 获取当前工作区名称
            const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name;
            const provider = config.get<string>('provider') as any || 'openrouter';
            const baseUrl = config.get<string>('baseUrl');

            // 4. Run Agent with new features
            const fullAiResponse = await runAgentWithStream(
                {
                    apiKey,
                    model,
                    maxIterations: 25,
                    workspaceName,
                    provider,
                    baseUrl
                },
                session?.messages || [],
                {
                    onToken: (token) => {
                        webviewView.webview.postMessage({ type: 'chunk', value: token });
                    },
                    onToolStart: (toolName, input) => {
                        webviewView.webview.postMessage({
                            type: 'chunk',
                            value: `\n\n🔧 **Calling Tool: ${toolName}**\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n`
                        });
                    },
                    onToolEnd: (toolName, output) => {
                        let outputStr: string;
                        try {
                            outputStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
                        } catch {
                            outputStr = String(output);
                        }
                        webviewView.webview.postMessage({
                            type: 'chunk',
                            value: `\n📋 **Result:**\n\`\`\`json\n${outputStr}\n\`\`\`\n\n`
                        });
                    },
                    onError: (error) => {
                        webviewView.webview.postMessage({
                            type: 'chunk',
                            value: `\n\n❌ **Error:** ${error.message}`
                        });
                    },
                    onComplete: () => {
                        webviewView.webview.postMessage({ type: 'endStream' });
                    }
                }
            );

            // 5. Save AI message
            if (session && fullAiResponse) {
                session.messages.push({
                    id: Date.now().toString() + Math.random().toString().slice(2, 5),
                    role: "assistant",
                    content: fullAiResponse,
                    timestamp: Date.now()
                });
                if (session.messages.length <= 2) {
                    session.name = text.slice(0, 30) + (text.length > 30 ? "..." : "");
                }
                await this._saveSessions(sessions);
                webviewView.webview.postMessage({ type: "updateSessions", value: sessions });
            }

        } catch (error: any) {
            webviewView.webview.postMessage({ type: 'endStream' });
            webviewView.webview.postMessage({
                type: 'addResponse',
                value: `❌ Error: ${error.message}`
            });
        }
    }

    private _getSessions(): Session[] {
        return this._context.globalState.get<Session[]>("sessions") || [];
    }

    private async _saveSessions(sessions: Session[]) {
        await this._context.globalState.update("sessions", sessions);
    }

    private async _createSession() {
        const newSession: Session = {
            id: Date.now().toString(),
            name: "New Chat",
            messages: []
        };
        const sessions = this._getSessions();
        sessions.unshift(newSession);
        await this._saveSessions(sessions);
        this._selectSession(newSession.id);
        if (this._view) {
            this._view.webview.postMessage({ type: "updateSessions", value: sessions });
        }
    }

    private async _deleteSession(id: string) {
        let sessions = this._getSessions();
        sessions = sessions.filter(s => s.id !== id);
        await this._saveSessions(sessions);

        if (this._currentSessionId === id) {
            if (sessions.length > 0) {
                this._selectSession(sessions[0].id);
            } else {
                await this._createSession();
                return;
            }
        }
        if (this._view) {
            this._view.webview.postMessage({ type: "updateSessions", value: sessions });
        }
    }

    private async _undoLastMessage() {
        const sessions = this._getSessions();
        const session = sessions.find(s => s.id === this._currentSessionId);
        if (!session || session.messages.length === 0) {
            return;
        }

        // Remove last Assistant message if it exists
        if (session.messages[session.messages.length - 1].role === 'assistant') {
            session.messages.pop();
        }

        // Remove last User message if it exists
        if (session.messages.length > 0 && session.messages[session.messages.length - 1].role === 'user') {
            session.messages.pop();
        }

        await this._saveSessions(sessions);

        if (this._view) {
            this._view.webview.postMessage({ type: "updateSessions", value: sessions });
            this._view.webview.postMessage({ type: "loadChat", value: session });
        }
    }

    private _selectSession(id: string) {
        this._currentSessionId = id;
        const sessions = this._getSessions();
        const session = sessions.find(s => s.id === id);
        if (session && this._view) {
            this._view.webview.postMessage({ type: "loadChat", value: session });
        }
    }

    private async _addTag(messageId: string, tag: string) {
        const sessions = this._getSessions();
        const session = sessions.find(s => s.id === this._currentSessionId);
        if (!session) return;

        const message = session.messages.find(m => m.id === messageId);
        if (message) {
            if (!message.tags) message.tags = [];
            if (!message.tags.includes(tag)) {
                message.tags.push(tag);
                await this._saveSessions(sessions);
                if (this._view) {
                    this._view.webview.postMessage({ type: "loadChat", value: session });
                }
            }
        }
    }

    private async _removeTag(messageId: string, tag: string) {
        const sessions = this._getSessions();
        const session = sessions.find(s => s.id === this._currentSessionId);
        if (!session) return;

        const message = session.messages.find(m => m.id === messageId);
        if (message && message.tags) {
            message.tags = message.tags.filter(t => t !== tag);
            await this._saveSessions(sessions);
            if (this._view) {
                this._view.webview.postMessage({ type: "loadChat", value: session });
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const htmlPath = path.join(this._context.extensionPath, 'src', 'webview', 'index.html');
        try {
            if (fs.existsSync(htmlPath)) {
                return fs.readFileSync(htmlPath, 'utf-8');
            }
        } catch (e) {
            console.error('Failed to read webview HTML file:', e);
        }
        return this._getFallbackHtml();
    }

    private _getFallbackHtml(): string {
        return `<!DOCTYPE html><html><body>Error loading UI</body></html>`;
    }
}
