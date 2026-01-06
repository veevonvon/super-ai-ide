const vscode = acquireVsCodeApi();
const md = window.markdownit({
    html: true,
    breaks: true,
    linkify: true
});

// DOM Elements
const chatView = document.getElementById('chat-view');
const historyView = document.getElementById('history-view');
const sessionList = document.getElementById('sessionList');
const messagesDiv = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const newSessionBtn = document.getElementById('newSessionBtn');
const historyBtn = document.getElementById('historyBtn');
const backBtn = document.getElementById('backBtn');
const settingsBtn = document.getElementById('settingsBtn');
const undoBtn = document.getElementById('undoBtn');
const emptyState = document.getElementById('emptyState');

// State
let currentAiMessageDiv = null;
let currentAiMessageContent = "";
let pendingToolCalls = new Map(); // Store pending tool calls by ID

// Initialize
vscode.postMessage({ type: 'init' });

// Navigation Events
historyBtn.addEventListener('click', () => {
    chatView.classList.add('hidden');
    historyView.classList.remove('hidden');
});

backBtn.addEventListener('click', () => {
    historyView.classList.add('hidden');
    chatView.classList.remove('hidden');
});

settingsBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettings' });
});

undoBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'undoLastMessage' });
});

newSessionBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'createSession' });
    historyView.classList.add('hidden');
    chatView.classList.remove('hidden');
});



// Send Message
function sendMessage() {
    const text = userInput.value.trim();
    if (text) {
        hideEmptyState();
        addMessage(text, 'user');
        userInput.value = '';
        vscode.postMessage({ type: 'askAI', text: text });
    }
}

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Helper Functions
function hideEmptyState() {
    if (emptyState) {
        emptyState.style.display = 'none';
    }
}

function showEmptyState() {
    if (emptyState && messagesDiv.children.length <= 1) {
        emptyState.style.display = 'flex';
    }
}

function formatJSON(obj) {
    try {
        if (typeof obj === 'string') {
            // Try to parse if it's a JSON string
            try {
                obj = JSON.parse(obj);
            } catch {
                return obj;
            }
        }
        return JSON.stringify(obj, null, 2);
    } catch {
        return String(obj);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Message Handler
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'updateSessions':
            renderSessions(message.value);
            break;
        case 'loadChat':
            renderChat(message.value);
            break;
        case 'startStream':
            // Don't hide loading yet, wait for first chunk
            hideEmptyState();
            currentAiMessageContent = "";
            currentAiMessageDiv = document.createElement('div');
            currentAiMessageDiv.className = 'message ai streaming'; // Add streaming class
            messagesDiv.appendChild(currentAiMessageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            break;
        case 'chunk':
            if (currentAiMessageDiv) {
                currentAiMessageContent += message.value;
                currentAiMessageDiv.innerHTML = parseAndRenderContent(currentAiMessageContent);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
            break;
        case 'endStream':
            if (currentAiMessageDiv) {
                currentAiMessageDiv.classList.remove('streaming'); // Remove streaming class
            }
            currentAiMessageDiv = null;
            break;
        case 'addResponse':
            hideEmptyState();
            addMessage(message.value, 'ai');
            break;
        case 'error':
            if (currentAiMessageDiv) {
                currentAiMessageDiv.classList.remove('streaming');
            }
            addMessage(message.value, 'error');
            break;
        case 'commandConfirm':
            showCommandConfirmDialog(message.id, message.command, message.cwd);
            break;
        case 'requestPermission':
            showPermissionConfirm(message.id, message.request, message.dryRun);
            break;
    }
});

// Render Functions
function renderSessions(sessions) {
    sessionList.innerHTML = '';
    if (sessions.length === 0) {
        sessionList.innerHTML = `
            <div class="empty-state" style="height: auto; padding: 60px 20px;">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No conversations yet</div>
                <div class="empty-state-hint">Start a new chat to begin</div>
            </div>
        `;
        return;
    }

    sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = 'session-item';

        const textDiv = document.createElement('div');
        textDiv.className = 'session-item-text';

        const icon = document.createElement('span');
        icon.className = 'session-item-icon';
        // Simple Pikachu Face Icon
        icon.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"/><path d="M3 2l6 6"/><path d="M21 2l-6 6"/><circle cx="9" cy="13" r="1" fill="currentColor" opacity="0.8"/><circle cx="15" cy="13" r="1" fill="currentColor" opacity="0.8"/><path d="M10 17c1 .5 3 .5 4 0"/></svg>';

        const span = document.createElement('span');
        span.innerText = session.name;

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.innerHTML = '×';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteSession', id: session.id });
        };

        div.onclick = () => {
            vscode.postMessage({ type: 'selectSession', id: session.id });
            historyView.classList.add('hidden');
            chatView.classList.remove('hidden');
        };

        textDiv.appendChild(icon);
        textDiv.appendChild(span);
        div.appendChild(textDiv);
        div.appendChild(delBtn);
        sessionList.appendChild(div);
    });
}

function renderChat(session) {
    messagesDiv.innerHTML = '';

    // Re-add empty state element
    const newEmptyState = document.createElement('div');
    newEmptyState.className = 'empty-state';
    newEmptyState.id = 'emptyState';
    newEmptyState.innerHTML = `
        <div class="empty-state-icon">
            <!-- Simple Pikachu Face Icon (Large) -->
            <svg style="width: 1em; height: 1em;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"/><path d="M3 2l6 6"/><path d="M21 2l-6 6"/><circle cx="9" cy="12" r="1.5" fill="currentColor" opacity="0.8" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" opacity="0.8" stroke="none"/><path d="M10 16c1 .5 3 .5 4 0"/></svg>
        </div>
        <div class="empty-state-text">Start a conversation</div>
        <div class="empty-state-hint">Ask me anything about your code...</div>
    `;
    messagesDiv.appendChild(newEmptyState);

    if (session.messages.length === 0) {
        newEmptyState.style.display = 'flex';
    } else {
        newEmptyState.style.display = 'none';
        session.messages.forEach(msg => {
            addMessage(msg.content, msg.role === 'user' ? 'user' : 'ai', msg.id, msg.tags);
        });
    }
}

function addMessage(text, type, id, tags) {
    hideEmptyState();
    const msg = document.createElement('div');
    msg.className = 'message ' + type;
    if (type === 'ai') {
        msg.innerHTML = parseAndRenderContent(text);
    } else {
        msg.innerText = text;
    }

    // Render tags/actions only if we have an ID (persisted message)
    if (id) {
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'message-tags';

        if (tags && tags.length > 0) {
            tags.forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'message-tag';
                tagEl.innerHTML = `#${tag} <span class="message-tag-remove">×</span>`;
                tagEl.querySelector('.message-tag-remove').onclick = () => {
                    vscode.postMessage({ type: 'removeTag', messageId: id, tag: tag });
                };
                tagsContainer.appendChild(tagEl);
            });
        }

        const addTagBtn = document.createElement('button');
        addTagBtn.className = 'add-tag-btn';
        addTagBtn.innerText = '+ Tag';
        addTagBtn.onclick = () => {
            addTagBtn.style.display = 'none';
            const input = document.createElement('input');
            input.className = 'tag-input';
            input.placeholder = 'Tag...';
            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const tag = input.value.trim();
                    if (tag) {
                        vscode.postMessage({ type: 'addTag', messageId: id, tag: tag });
                    }
                    cleanup();
                } else if (e.key === 'Escape') {
                    cleanup();
                }
            };
            input.onblur = cleanup;

            function cleanup() {
                input.remove();
                addTagBtn.style.display = 'inline-block';
            }

            tagsContainer.appendChild(input);
            input.focus();
        };
        tagsContainer.appendChild(addTagBtn);

        // Fork Button
        const forkBtn = document.createElement('button');
        forkBtn.className = 'add-tag-btn';
        forkBtn.innerHTML = '🔀 Fork';
        forkBtn.title = 'Create a new session starting from here';
        forkBtn.style.marginLeft = '4px';
        forkBtn.onclick = () => {
            vscode.postMessage({ type: 'forkSession', messageId: id });
        };
        tagsContainer.appendChild(forkBtn);

        msg.appendChild(tagsContainer);
    }

    messagesDiv.appendChild(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Parse tool call markdown and convert to UI components
function parseAndRenderContent(content) {
    const toolStartPattern = /🔧 \*\*Calling Tool: ([^*]+)\*\*\n```json\n([\s\S]*?)```/g;
    const toolResultPattern = /📋 \*\*Result:\*\*\n```json\n([\s\S]*?)```/g;

    if (content.includes('🔧 **Calling Tool:')) {
        let processedContent = content;
        let toolCalls = [];
        let match;
        while ((match = toolStartPattern.exec(content)) !== null) {
            toolCalls.push({
                fullMatch: match[0],
                toolName: match[1],
                toolInput: match[2].trim(),
                index: match.index
            });
        }
        let results = [];
        while ((match = toolResultPattern.exec(content)) !== null) {
            results.push({
                fullMatch: match[0],
                result: match[1].trim(),
                index: match.index
            });
        }

        let html = '';
        let lastIndex = 0;

        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const textBefore = content.substring(lastIndex, tc.index);
            if (textBefore.trim()) {
                html += md.render(textBefore);
            }

            const result = results[i];
            let inputFormatted = tc.toolInput;
            try {
                inputFormatted = JSON.stringify(JSON.parse(tc.toolInput), null, 2);
            } catch { }

            const hasResult = result && result.result;
            const resultFormatted = hasResult ? result.result : '';

            html += `
                <div class="tool-call-card ${hasResult ? 'complete' : 'running'}">
                    <div class="tool-call-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <div class="tool-call-icon">
                            <svg class="icon-svg" style="width: 18px; height: 18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                        </div>
                        <div class="tool-call-info">
                            <div class="tool-call-name">${escapeHtml(tc.toolName)}</div>
                            <div class="tool-call-status">
                                ${hasResult
                    ? '<span class="badge badge-success">✓ Complete</span>'
                    : '<span class="badge badge-running"><span class="tool-call-spinner"></span> Running...</span>'
                }
                            </div>
                        </div>
                        <div class="tool-call-toggle">▼</div>
                    </div>
                    <div class="tool-call-body">
                        <div class="tool-call-section">
                            <div class="tool-call-section-title">
                                <span class="icon">
                                    <svg class="icon-svg" style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
                                </span>
                                Input Parameters
                            </div>
                            <div class="tool-call-code">${escapeHtml(inputFormatted)}</div>
                        </div>
                        ${hasResult ? `
                        <div class="tool-call-section tool-result-success">
                            <div class="tool-call-section-title">
                                <span class="icon">
                                    <svg class="icon-svg" style="width: 14px; height: 14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                                </span>
                                Output Result
                            </div>
                            <div class="tool-call-code">${escapeHtml(resultFormatted)}</div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;

            if (result) {
                lastIndex = result.index + result.fullMatch.length;
            } else {
                lastIndex = tc.index + tc.fullMatch.length;
            }
        }

        const textAfter = content.substring(lastIndex);
        if (textAfter.trim()) {
            html += md.render(textAfter);
        }
        return html;
    }
    return md.render(content);
}

/**
 * 显示命令确认对话框 (Legacy)
 */
function showCommandConfirmDialog(id, command, cwd) {
    const existing = document.querySelector('.command-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'command-confirm-overlay';
    overlay.innerHTML = `
        <div class="command-confirm-modal">
            <div class="command-confirm-header">
                <div class="command-confirm-icon">
                    <svg class="icon-svg" style="width: 28px; height: 28px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <div class="command-confirm-title">
                    <h3>Terminal Command</h3>
                    <p>AI wants to execute a command. Please review and confirm.</p>
                </div>
            </div>
            <div class="command-confirm-body">
                <div class="command-confirm-label">
                    <span>
                        <svg class="icon-svg" style="width: 16px; height: 16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                    </span> Command
                </div>
                <div class="command-confirm-code">${escapeHtml(command)}</div>
                ${cwd ? `<div class="command-confirm-cwd">Working directory: <span>${escapeHtml(cwd)}</span></div>` : ''}
            </div>
            <div class="command-confirm-actions">
                <button class="btn-reject" id="cmd-reject-${id}">✗ Reject</button>
                <button class="btn-confirm" id="cmd-confirm-${id}">✓ Run Command</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById(`cmd-reject-${id}`).addEventListener('click', () => {
        overlay.remove();
        vscode.postMessage({ type: 'commandConfirmResponse', id: id, confirmed: false });
    });
    document.getElementById(`cmd-confirm-${id}`).addEventListener('click', () => {
        overlay.remove();
        vscode.postMessage({ type: 'commandConfirmResponse', id: id, confirmed: true });
    });
}

/**
 * 显示权限确认对话框 (New)
 */
function showPermissionConfirm(id, request, dryRunMarkdown) {
    const existing = document.querySelector('.command-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'command-confirm-overlay';

    const dryRunHtml = md.render(dryRunMarkdown);

    overlay.innerHTML = `
        <div class="command-confirm-modal" style="max-width: 600px;">
            <div class="command-confirm-header">
                <div class="command-confirm-icon">🛡️</div>
                <div class="command-confirm-title">
                    <h3>Permission Required</h3>
                    <p>The AI wants to perform a sensitive operation.</p>
                </div>
            </div>
            <div class="command-confirm-body">
                    <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 4px; margin-bottom: 10px; font-size: 0.9em;">
                    <strong>Tool:</strong> <code>${escapeHtml(request.toolName)}</code><br>
                    <strong>Reason:</strong> ${escapeHtml(request.reason)}
                </div>
                <div class="command-confirm-label">
                    <span>🔍</span> Operation Preview (Dry Run)
                </div>
                <div style="max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 4px; font-size: 0.9em;">
                    ${dryRunHtml}
                </div>
            </div>
            <div class="command-confirm-actions">
                <button class="btn-reject" id="perm-reject-${id}">✗ Deny</button>
                <button class="btn-confirm" id="perm-confirm-${id}">✓ Approve</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById(`perm-reject-${id}`).addEventListener('click', () => {
        overlay.remove();
        vscode.postMessage({ type: 'permissionResponse', id, granted: false });
    });
    document.getElementById(`perm-confirm-${id}`).addEventListener('click', () => {
        overlay.remove();
        vscode.postMessage({ type: 'permissionResponse', id, granted: true });
    });
}
