import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "super-ai-ide" is now active!');

    const sidebarProvider = new SidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "super-ai-ide.sidebarView",
            sidebarProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("super-ai-ide.toggleSidebar", () => {
            vscode.commands.executeCommand("super-ai-ide.sidebarView.focus");
        })
    );


}

export function deactivate() { }
