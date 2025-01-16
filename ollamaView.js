const vscode = require('vscode');
const axios = require('axios');
const path = require('path');

class OllamaViewProvider {
    constructor(context) {
        this.context = context;
        this._view = null;
        this.selectedFiles = new Set();
        this.fileCache = new Map();
        this.systemPrompt = `You are a direct and efficient AI assistant. Follow these rules strictly:
1. Keep responses extremely short and to the point
2. For code, show only the solution without explanations unless asked
3. For terminal commands, execute them directly without explanation
4. Use bullet points for multiple items
5. Skip greetings and pleasantries
6. Format code with proper syntax highlighting
7. When editing files, provide only the exact changes needed

Additional capabilities:
- You can read and edit files in the workspace
- You can execute terminal commands
- When editing files, provide the exact file path and changes
- When running commands, execute them directly`;
    }

    async _getWorkspaceFiles() {
        if (!vscode.workspace.workspaceFolders) return [];
        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        return files.map(file => ({
            path: vscode.workspace.asRelativePath(file),
            name: path.basename(file.fsPath)
        }));
    }

    async _executeCommand(command) {
        const terminal = vscode.window.createTerminal('Ollama Assistant');
        terminal.show();
        terminal.sendText(command);
        return `Executed: ${command}`;
    }

    async _editFile(filePath, changes) {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                document.uri,
                new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(document.getText().length)
                ),
                changes
            );
            await vscode.workspace.applyEdit(edit);
            return `File ${filePath} has been updated.`;
        } catch (error) {
            throw new Error(`Failed to edit file: ${error.message}`);
        }
    }

    async _getSelectedFilesContext() {
        const contexts = await Promise.all(
            Array.from(this.selectedFiles).map(async filePath => {
                try {
                    if (this.fileCache.has(filePath)) {
                        return this.fileCache.get(filePath);
                    }
                    const document = await vscode.workspace.openTextDocument(filePath);
                    const context = `\nFile: ${filePath}\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\`\n`;
                    this.fileCache.set(filePath, context);
                    return context;
                } catch (error) {
                    console.error(`Failed to read file ${filePath}:`, error);
                    return '';
                }
            })
        );
        return contexts.join('');
    }

    _getHtmlContent(webview) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 10px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-editor-foreground);
                    }
                    .chat-container {
                        display: flex;
                        flex-direction: column;
                        height: calc(100vh - 20px);
                    }
                    .messages {
                        flex: 1;
                        overflow-y: auto;
                        margin-bottom: 10px;
                    }
                    .message {
                        margin: 5px 0;
                        padding: 8px;
                        border-radius: 5px;
                        white-space: pre-wrap;
                    }
                    .user-message {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                    }
                    .bot-message {
                        background-color: var(--vscode-editor-selectionBackground);
                    }
                    .bot-message code {
                        background-color: var(--vscode-editor-background);
                        padding: 2px 4px;
                        border-radius: 3px;
                        font-family: var(--vscode-editor-font-family);
                    }
                    .bot-message pre {
                        background-color: var(--vscode-editor-background);
                        padding: 8px;
                        border-radius: 5px;
                        overflow-x: auto;
                        margin: 8px 0;
                    }
                    .bot-message ul {
                        margin: 4px 0;
                        padding-left: 20px;
                    }
                    .bot-message p {
                        margin: 4px 0;
                    }
                    .loading-message {
                        background-color: var(--vscode-editor-selectionBackground);
                        opacity: 0.7;
                    }
                    .loading-dots::after {
                        content: '';
                        animation: dots 1.5s steps(5, end) infinite;
                    }
                    @keyframes dots {
                        0%, 20% { content: '.'; }
                        40% { content: '..'; }
                        60% { content: '...'; }
                        80%, 100% { content: ''; }
                    }
                    .input-container {
                        display: flex;
                        flex-direction: column;
                        gap: 5px;
                    }
                    .input-row {
                        display: flex;
                        gap: 5px;
                    }
                    #messageInput {
                        flex: 1;
                        padding: 5px;
                        border: 1px solid var(--vscode-input-border);
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 3px;
                        min-height: 2.4em;
                        resize: vertical;
                    }
                    .context-row {
                        display: flex;
                        align-items: center;
                        gap: 5px;
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    button {
                        padding: 5px 10px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        margin: 5px 0;
                    }
                    .context-toggle {
                        display: flex;
                        align-items: center;
                        gap: 5px;
                        user-select: none;
                    }
                    .context-toggle input[type="checkbox"] {
                        margin: 0;
                    }
                    .file-selector {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 6px;
                        padding: 16px;
                        max-height: 80vh;
                        width: 80%;
                        overflow-y: auto;
                        display: none;
                    }
                    .file-selector.show {
                        display: block;
                    }
                    .file-item {
                        padding: 4px 8px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                    }
                    .file-item:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .file-item.selected {
                        background: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }
                    .context-buttons {
                        display: flex;
                        gap: 5px;
                        align-items: center;
                    }
                    .selected-files {
                        margin-top: 4px;
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .selected-file-item {
                        display: inline-block;
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 2px 6px;
                        border-radius: 3px;
                        margin: 2px;
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="messages" id="messages"></div>
                    <div class="input-container">
                        <div class="context-row">
                            <div class="context-buttons">
                                <label class="context-toggle">
                                    <input type="checkbox" id="includeContext">
                                    Include current file
                                </label>
                                <button id="selectFilesBtn" title="Select files">+</button>
                            </div>
                            <div class="selected-files" id="selectedFiles"></div>
                        </div>
                        <div class="input-row">
                            <textarea id="messageInput" placeholder="Type your message... (Shift+Enter for new line)"></textarea>
                            <button id="sendButton">Send</button>
                        </div>
                    </div>
                </div>
                <div class="file-selector" id="fileSelector">
                    <div id="fileList"></div>
                    <div style="margin-top: 10px">
                        <button id="confirmFileSelection">Confirm</button>
                        <button id="cancelFileSelection">Cancel</button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const messagesContainer = document.getElementById('messages');
                    const messageInput = document.getElementById('messageInput');
                    const sendButton = document.getElementById('sendButton');
                    const includeContextCheckbox = document.getElementById('includeContext');
                    const selectFilesBtn = document.getElementById('selectFilesBtn');
                    const fileSelector = document.getElementById('fileSelector');
                    const fileList = document.getElementById('fileList');
                    const selectedFilesDiv = document.getElementById('selectedFiles');
                    let loadingMessage = null;
                    let selectedFiles = new Set();

                    selectFilesBtn.addEventListener('click', () => {
                        vscode.postMessage({ type: 'getFiles' });
                        fileSelector.classList.add('show');
                    });

                    document.getElementById('confirmFileSelection').addEventListener('click', () => {
                        fileSelector.classList.remove('show');
                        updateSelectedFilesDisplay();
                    });

                    document.getElementById('cancelFileSelection').addEventListener('click', () => {
                        fileSelector.classList.remove('show');
                    });

                    function updateSelectedFilesDisplay() {
                        selectedFilesDiv.innerHTML = Array.from(selectedFiles).map(file => 
                            \`<span class="selected-file-item">\${file}</span>\`
                        ).join('');
                    }

                    function addMessage(content, isUser = false, isError = false, isLoading = false) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = \`message \${isUser ? 'user-message' : 'bot-message'} \${isError ? 'error' : ''} \${isLoading ? 'loading-message' : ''}\`;
                        
                        if (isLoading) {
                            messageDiv.innerHTML = \`Generating<span class="loading-dots"></span>\`;
                            loadingMessage = messageDiv;
                        } else {
                            if (isUser) {
                                messageDiv.textContent = content;
                            } else {
                                messageDiv.innerHTML = content;
                            }
                        }
                        
                        messagesContainer.appendChild(messageDiv);
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        return messageDiv;
                    }

                    function setInputState(disabled) {
                        messageInput.disabled = disabled;
                        sendButton.disabled = disabled;
                        includeContextCheckbox.disabled = disabled;
                        selectFilesBtn.disabled = disabled;
                    }

                    function sendMessage() {
                        const message = messageInput.value.trim();
                        if (message) {
                            addMessage(message, true);
                            addMessage('', false, false, true);
                            setInputState(true);
                            
                            vscode.postMessage({
                                type: 'sendMessage',
                                message: message,
                                includeContext: includeContextCheckbox.checked,
                                selectedFiles: Array.from(selectedFiles)
                            });
                            messageInput.value = '';
                        }
                    }

                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        switch (message.type) {
                            case 'files':
                                fileList.innerHTML = message.files.map(file => 
                                    \`<div class="file-item \${selectedFiles.has(file.path) ? 'selected' : ''}" data-path="\${file.path}">
                                        \${file.path}
                                    </div>\`
                                ).join('');

                                fileList.addEventListener('click', (e) => {
                                    const fileItem = e.target.closest('.file-item');
                                    if (fileItem) {
                                        const path = fileItem.dataset.path;
                                        if (selectedFiles.has(path)) {
                                            selectedFiles.delete(path);
                                            fileItem.classList.remove('selected');
                                        } else {
                                            selectedFiles.add(path);
                                            fileItem.classList.add('selected');
                                        }
                                    }
                                });
                                break;

                            case 'response':
                                if (loadingMessage) {
                                    loadingMessage.remove();
                                    loadingMessage = null;
                                }
                                if (message.error) {
                                    addMessage(message.error, false, true);
                                } else {
                                    addMessage(message.message);
                                }
                                setInputState(false);
                                break;
                        }
                    });

                    sendButton.addEventListener('click', sendMessage);
                    messageInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    messageInput.addEventListener('input', () => {
                        messageInput.style.height = 'auto';
                        messageInput.style.height = messageInput.scrollHeight + 'px';
                    });
                </script>
            </body>
            </html>
        `;
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'getFiles':
                    const files = await this._getWorkspaceFiles();
                    webviewView.webview.postMessage({
                        type: 'files',
                        files: files
                    });
                    break;

                case 'sendMessage':
                    try {
                        let contextMessage = '';
                        if (data.includeContext) {
                            contextMessage = await this._getEditorContext();
                        }
                        if (data.selectedFiles && data.selectedFiles.length > 0) {
                            this.selectedFiles = new Set(data.selectedFiles);
                            const filesContext = await this._getSelectedFilesContext();
                            contextMessage += filesContext;
                        }
                        
                        const fullPrompt = contextMessage ? 
                            `Context:\n${contextMessage}\n\nQuestion: ${data.message}` :
                            data.message;
                            
                        const response = await this._askOllama(fullPrompt);
                        webviewView.webview.postMessage({
                            type: 'response',
                            message: response,
                            error: null
                        });
                    } catch (error) {
                        webviewView.webview.postMessage({
                            type: 'response',
                            message: null,
                            error: error.message
                        });
                    }
                    break;
            }
        });
    }

    async _getEditorContext() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return '';
        }

        const document = editor.document;
        const selection = editor.selection;
        
        // If there's a selection, use that, otherwise use the entire file
        const text = selection.isEmpty ?
            document.getText() :
            document.getText(selection);

        return `File: ${document.fileName}\n\`\`\`${document.languageId}\n${text}\n\`\`\``;
    }

    async _askOllama(prompt) {
        const config = vscode.workspace.getConfiguration('eduai');
        const host = config.get('ollamaHost');
        const model = config.get('ollamaModel');

        try {
            const response = await axios.post(`${host}/api/generate`, {
                model: model,
                prompt: `${this.systemPrompt}\n\nUser: ${prompt}\n\nAssistant:`,
                stream: false
            });
            return response.data.response;
        } catch (error) {
            throw new Error(`Failed to communicate with Ollama: ${error.message}`);
        }
    }
}

module.exports = OllamaViewProvider; 