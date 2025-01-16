const vscode = require('vscode');
const axios = require('axios');
const path = require('path');

class OllamaViewProvider {
    constructor(context) {
        this.context = context;
        this._view = null;
        this.selectedFiles = new Set();
        this.currentThread = null;
        this.conversations = this.loadConversations();
        
        this.systemPrompt = `You are Copilot, a world class Programming AI assistant designed to help users with programming topics.
When users ask you to perform actions:
1. Execute them directly using available commands
2. Don't explain how to do it, just do it
3. Provide brief confirmation when done
4. If there's an error, explain concisely what went wrong

Format responses in HTML:
- Use <code> for inline code
- Use <pre> for code blocks
- Use <p> for paragraphs
- Keep responses very brief

You have these capabilities:
- Create, edit, and read files using exact file paths
- Execute terminal commands directly (bash/cmd)
- Provide file context and suggestions
- Modify files when requested

When executing bash commands:
- Use proper command syntax
- Handle errors gracefully
- Provide command output
- Support common bash operations`;
    }

    loadConversations() {
        return this.context.globalState.get('ollama-conversations', []);
    }

    saveConversations() {
        this.context.globalState.update('ollama-conversations', this.conversations);
    }

    createNewThread() {
        const thread = {
            id: Date.now().toString(),
            title: 'New Chat',
            messages: [],
            timestamp: new Date().toISOString()
        };
        this.conversations.unshift(thread);
        this.currentThread = thread;
        this.saveConversations();
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateThreads',
                threads: this.conversations,
                currentThread: this.currentThread
            });
        }
        return thread;
    }

    addMessageToThread(threadId, message, isUser = true) {
        const thread = this.conversations.find(t => t.id === threadId);
        if (thread) {
            thread.messages.push({
                content: message,
                isUser,
                timestamp: new Date().toISOString()
            });
            if (thread.messages.length === 2) {
                thread.title = message.split('\n')[0].slice(0, 50) + (message.length > 50 ? '...' : '');
            }
            this.saveConversations();
        }
    }

    async resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };

        if (!this.currentThread) {
            this.createNewThread();
        }

        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    try {
                        if (!this.currentThread) {
                            this.createNewThread();
                        }

                        let contextMessage = '';
                        if (data.includeContext) {
                            contextMessage = await this._getEditorContext();
                        }
                        if (data.selectedFiles?.length > 0) {
                            this.selectedFiles = new Set(data.selectedFiles);
                            const filesContext = await this._getSelectedFilesContext();
                            contextMessage += filesContext;
                        }
                        
                        const userMessage = data.message;
                        this.addMessageToThread(this.currentThread.id, userMessage, true);
                        
                        const fullPrompt = contextMessage ? 
                            `Context:\n${contextMessage}\n\nQuestion: ${userMessage}` :
                            userMessage;
                            
                        await this._askOllama(fullPrompt);
                    } catch (error) {
                        console.error('Error sending message:', error);
                        webviewView.webview.postMessage({
                            type: 'response',
                            error: error.message
                        });
                    }
                    break;

                case 'getFiles':
                    const files = await this._getWorkspaceFiles();
                    webviewView.webview.postMessage({
                        type: 'files',
                        files: files
                    });
                    break;

                case 'executeCommand':
                    try {
                        const result = await this._executeCommand(data.command);
                        webviewView.webview.postMessage({
                            type: 'response',
                            message: result
                        });
                    } catch (error) {
                        webviewView.webview.postMessage({
                            type: 'response',
                            error: error.message
                        });
                    }
                    break;
            }
        });
    }

    _getHtmlContent(webview) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    :root {
                        --chat-height: 100vh;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        height: var(--chat-height);
                        overflow: hidden;
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .chat-container {
                        display: grid;
                        grid-template-columns: minmax(0, auto) 1fr;
                        height: var(--chat-height);
                    }
                    .tabs-container {
                        display: flex;
                        align-items: center;
                        padding: 5px;
                        background: var(--vscode-tab-activeBackground);
                        border-bottom: 1px solid var(--vscode-tab-border);
                        overflow-x: auto;
                        white-space: nowrap;
                    }
                    .tab {
                        padding: 8px 16px;
                        margin-right: 4px;
                        cursor: pointer;
                        border: none;
                        background: var(--vscode-tab-inactiveBackground);
                        color: var(--vscode-tab-inactiveForeground);
                        border-radius: 4px 4px 0 0;
                    }
                    .tab.active {
                        background: var(--vscode-tab-activeBackground);
                        color: var(--vscode-tab-activeForeground);
                        border-bottom: 2px solid var(--vscode-focusBorder);
                    }
                    .main-chat {
                        display: flex;
                        flex-direction: column;
                        height: var(--chat-height);
                        overflow: hidden;
                    }
                    .chat-header {
                        display: flex;
                        align-items: center;
                        padding: 10px;
                        border-bottom: 1px solid var(--vscode-input-border);
                        gap: 10px;
                    }
                    .action-button {
                        padding: 5px 10px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 5px;
                    }
                    .action-button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .messages {
                        flex: 1;
                        overflow-y: auto;
                        padding: 10px;
                    }
                    .message {
                        margin: 5px 0;
                        padding: 8px;
                        border-radius: 5px;
                        max-width: 85%;
                        word-wrap: break-word;
                    }
                    .message pre {
                        max-width: 100%;
                        overflow-x: auto;
                        background: var(--vscode-editor-background);
                        padding: 10px;
                        border-radius: 4px;
                        margin: 5px 0;
                    }
                    .user-message {
                        background: var(--vscode-editor-inactiveSelectionBackground);
                        margin-left: auto;
                    }
                    .bot-message {
                        background: var(--vscode-editor-selectionBackground);
                        margin-right: auto;
                    }
                    .input-container {
                        padding: 10px;
                        border-top: 1px solid var(--vscode-input-border);
                    }
                    .input-row {
                        display: flex;
                        gap: 5px;
                    }
                    #messageInput {
                        flex: 1;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px;
                        resize: none;
                        height: 40px;
                    }
                    .file-menu {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 6px;
                        max-height: 80vh;
                        width: 100%;
                        max-width: 95%;
                        display: none;
                        z-index: 1000;
                    }
                    .file-menu.show {
                        display: block;
                    }
                    .file-menu-header {
                        padding: 10px;
                        border-bottom: 1px solid var(--vscode-input-border);
                    }
                    .file-menu-search {
                        width: 100%;
                        padding: 5px;
                        margin-top: 5px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                    }
                    .file-list {
                        max-height: calc(80vh - 120px);
                        overflow-y: auto;
                        padding: 10px;
                    }
                    .file-item {
                        padding: 6px 8px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        border-radius: 4px;
                    }
                    .file-item:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .file-item.selected {
                        background: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }
                    .modal {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 6px;
                        padding: 20px;
                        min-width: 100%;
                        display: none;
                        z-index: 1000;
                    }
                    .modal.show {
                        display: block;
                    }
                    .modal textarea {
                        width: 100%;
                        min-height: 100px;
                        margin: 10px 0;
                        padding: 8px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                    }
                    .modal-buttons {
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                        margin-top: 10px;
                    }
                    /* Loading animation */
                    @keyframes loading {
                        0% { opacity: .2; }
                        20% { opacity: 1; }
                        100% { opacity: .2; }
                    }
                    
                    .loading-dots {
                        animation: loading 1.4s infinite both;
                        display: inline-block;
                    }
                    
                    /* Improved message styles */
                    .message {
                        margin: 8px 0;
                        padding: 10px;
                        border-radius: 8px;
                        max-width: 100%;
                        word-wrap: break-word;
                        line-height: 1.4;
                    }
                    
                    .message pre {
                        max-width: 100%;
                        overflow-x: auto;
                        background: var(--vscode-editor-background);
                        padding: 12px;
                        border-radius: 6px;
                        margin: 8px 0;
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                    }
                    
                    .message code {
                        background: var(--vscode-editor-background);
                        padding: 2px 4px;
                        border-radius: 3px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: 0.9em;
                    }
                    
                    /* Improved input area */
                    .input-container {
                        padding: 12px;
                        background: var(--vscode-editor-background);
                        border-top: 1px solid var(--vscode-input-border);
                    }
                    
                    .input-row {
                        display: flex;
                        gap: 8px;
                        align-items: flex-start;
                    }
                    
                    #messageInput {
                        flex: 1;
                        padding: 8px 12px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 6px;
                        resize: none;
                        min-height: 40px;
                        max-height: 200px;
                        overflow-y: auto;
                        line-height: 1.4;
                    }
                    
                    /* Improved button styles */
                    .action-button {
                        padding: 8px 12px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        font-size: 13px;
                        transition: background-color 0.2s;
                    }
                    
                    .action-button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    
                    /* Improved modal styles */
                    .modal {
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 8px;
                        padding: 16px;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    }
                    
                    .modal textarea {
                        margin: 12px 0;
                        padding: 10px;
                        border-radius: 6px;
                        min-height: 120px;
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="main-chat">
                        <div class="tabs-container" id="tabsContainer">
                            <button class="tab active" data-tab="chat">Chat</button>
                            <button class="tab" data-tab="history">History</button>
                        </div>
                        <div class="chat-header">
                            <button class="action-button" id="fileMenuBtn">
                                <span>📁</span> Files
                            </button>
                            <button class="action-button" id="bashBtn">
                                <span>$</span> Terminal
                            </button>
                        </div>
                        <div class="messages" id="messages"></div>
                        <div class="input-container">
                            <div class="input-row">
                                <textarea id="messageInput" placeholder="Type your message"></textarea>
                                <button id="sendButton" class="action-button">Send</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="file-menu" id="fileMenu">
                    <div class="file-menu-header">
                        <div>Select Files</div>
                        <input type="text" class="file-menu-search" id="fileSearch" placeholder="Search files...">
                    </div>
                    <div class="file-list" id="fileList"></div>
                    <div class="modal-buttons">
                        <button class="action-button" id="closeFileMenu">Close</button>
                    </div>
                </div>

                <div class="modal" id="bashModal">
                    <div>Enter Bash Command</div>
                    <textarea id="bashCommand" placeholder="Enter your command here..."></textarea>
                    <div class="modal-buttons">
                        <button class="action-button" id="cancelBash">Cancel</button>
                        <button class="action-button" id="executeBash">Execute</button>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentThread = null;
                    let isGenerating = false;
                    let selectedFiles = new Set();
                    let chatHistory = [];
                    
                    const messagesContainer = document.getElementById('messages');
                    const messageInput = document.getElementById('messageInput');
                    const sendButton = document.getElementById('sendButton');
                    const fileMenu = document.getElementById('fileMenu');
                    const fileSearch = document.getElementById('fileSearch');
                    const fileList = document.getElementById('fileList');
                    const bashModal = document.getElementById('bashModal');
                    const bashCommand = document.getElementById('bashCommand');
                    const tabsContainer = document.getElementById('tabsContainer');

                    // Tab switching and chat history
                    let activeTab = 'chat';
                    const tabs = document.querySelectorAll('.tab');
                    
                    function switchTab(tabName) {
                        activeTab = tabName;
                        tabs.forEach(tab => {
                            tab.classList.toggle('active', tab.dataset.tab === tabName);
                        });
                        
                        if (tabName === 'history') {
                            renderChatHistory();
                        } else {
                            renderMessages(currentThread?.messages || []);
                        }
                    }
                    
                    tabs.forEach(tab => {
                        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
                    });

                    // Message handling with history
                    function addToHistory(message, isUser = true) {
                        const entry = {
                            content: message,
                            isUser,
                            timestamp: new Date().toISOString()
                        };
                        chatHistory.unshift(entry);
                        if (chatHistory.length > 100) {
                            chatHistory.pop();
                        }
                    }

                    // Message handling
                    function sendMessage() {
                        const message = messageInput.value.trim();
                        if (message && !isGenerating) {
                            isGenerating = true;
                            messageInput.value = '';
                            
                            // Add user message immediately
                            const userMessageDiv = document.createElement('div');
                            userMessageDiv.className = 'message user-message';
                            userMessageDiv.textContent = message;
                            messagesContainer.appendChild(userMessageDiv);
                            
                            // Show loading indicator
                            showLoading();
                            
                            // Send message to extension
                            vscode.postMessage({
                                type: 'sendMessage',
                                message: message,
                                selectedFiles: Array.from(selectedFiles)
                            });
                            
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        }
                    }

                    // Event listeners
                    messageInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    sendButton.addEventListener('click', sendMessage);

                    // Handle response from extension
                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        hideLoading();
                        isGenerating = false;

                        switch (message.type) {
                            case 'response':
                                if (message.error) {
                                    console.error('Error:', message.error);
                                    const errorDiv = document.createElement('div');
                                    errorDiv.className = 'message bot-message error';
                                    errorDiv.innerHTML = '<div style="color: var(--vscode-errorForeground);">Error: ' + 
                                        message.error + '</div>';
                                    messagesContainer.appendChild(errorDiv);
                                } else if (message.message) {
                                    const botMessageDiv = document.createElement('div');
                                    botMessageDiv.className = 'message bot-message';
                                    botMessageDiv.innerHTML = message.message;
                                    messagesContainer.appendChild(botMessageDiv);
                                }
                                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                                break;

                            case 'files':
                                renderFileList(message.files);
                                break;
                        }
                    });

                    // File menu handling
                    document.getElementById('fileMenuBtn').addEventListener('click', () => {
                        fileMenu.classList.toggle('show');
                        if (fileMenu.classList.contains('show')) {
                            vscode.postMessage({ type: 'getFiles' });
                        }
                    });

                    // Bash command handling
                    document.getElementById('bashBtn').addEventListener('click', () => {
                        bashModal.classList.add('show');
                        bashCommand.focus();
                    });

                    document.getElementById('executeBash').addEventListener('click', () => {
                        const command = bashCommand.value.trim();
                        if (command) {
                            vscode.postMessage({
                                type: 'executeCommand',
                                command: command
                            });
                            bashModal.classList.remove('show');
                            bashCommand.value = '';
                        }
                    });

                    // Handle Enter key in bash command
                    bashCommand.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            document.getElementById('executeBash').click();
                        }
                    });

                    function renderChatHistory() {
                        messagesContainer.innerHTML = chatHistory.map(chat => 
                            '<div class="message ' + (chat.isUser ? 'user-message' : 'bot-message') + '">' +
                                '<div style="font-size: 0.8em; margin-bottom: 4px;">' +
                                    new Date(chat.timestamp).toLocaleString() +
                                '</div>' +
                                chat.content +
                            '</div>'
                        ).join('');
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }

                    // Loading indicator
                    function showLoading() {
                        const loadingDiv = document.createElement('div');
                        loadingDiv.className = 'message bot-message';
                        loadingDiv.id = 'loadingMessage';
                        loadingDiv.innerHTML = 'Generating response<span class="loading-dots">...</span>';
                        messagesContainer.appendChild(loadingDiv);
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }

                    function hideLoading() {
                        const loadingMessage = document.getElementById('loadingMessage');
                        if (loadingMessage) {
                            loadingMessage.remove();
                        }
                    }

                    function renderFileList(files) {
                        fileList.innerHTML = files.map(file => 
                            '<div class="file-item ' + (selectedFiles.has(file.path) ? 'selected' : '') + '"' +
                                'data-path="' + file.path + '">' +
                                '<span>📄 ' + file.path + '</span>' +
                            '</div>'
                        ).join('');
                    }

                    fileSearch.addEventListener('input', (e) => {
                        const searchTerm = e.target.value.toLowerCase();
                        const fileItems = fileList.getElementsByClassName('file-item');
                        Array.from(fileItems).forEach(item => {
                            const fileName = item.textContent.toLowerCase();
                            item.style.display = fileName.includes(searchTerm) ? 'flex' : 'none';
                        });
                    });

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

                    // Handle clicks outside modals
                    document.addEventListener('click', (e) => {
                        if (!fileMenu.contains(e.target) && !e.target.closest('#fileMenuBtn')) {
                            fileMenu.classList.remove('show');
                        }
                        if (!bashModal.contains(e.target) && !e.target.closest('#bashBtn')) {
                            bashModal.classList.remove('show');
                        }
                    });

                    // Update chat height on window resize
                    function updateChatHeight() {
                        const height = window.innerHeight;
                        document.documentElement.style.setProperty('--chat-height', height + 'px');
                    }
                    
                    window.addEventListener('resize', updateChatHeight);
                    updateChatHeight(); // Initial setup
                </script>
            </body>
            </html>
        `;
    }

    async _getEditorContext() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return '';
        }

        const document = editor.document;
        const selection = editor.selection;
        
        const text = selection.isEmpty ?
            document.getText() :
            document.getText(selection);

        return `File: ${document.fileName}\n\`\`\`${document.languageId}\n${text}\n\`\`\``;
    }

    async _getSelectedFilesContext() {
        let context = '';
        for (const filePath of this.selectedFiles) {
            try {
                const document = await vscode.workspace.openTextDocument(filePath);
                context += `\nFile: ${filePath}\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\`\n`;
            } catch (error) {
                console.error(`Failed to read file ${filePath}:`, error);
            }
        }
        return context;
    }

    async _askOllama(prompt) {
        const config = vscode.workspace.getConfiguration('eduai');
        const host = config.get('ollamaHost', 'http://localhost:11434');
        const model = config.get('ollamaModel', 'llama2');

        try {
            const response = await axios.post(`${host}/api/generate`, {
                model: model,
                prompt: `${this.systemPrompt}\n\nUser: ${prompt}\n\nAssistant:`,
                stream: false
            });

            if (response.data && response.data.response) {
                // Send the response back to the webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'response',
                        message: response.data.response
                    });
                }
                return response.data.response;
            } else {
                throw new Error('Invalid response from Ollama');
            }
        } catch (error) {
            const errorMessage = `Failed to communicate with Ollama: ${error.message}`;
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'response',
                    error: errorMessage
                });
            }
            throw new Error(errorMessage);
        }
    }

    async deleteThread(threadId) {
        this.conversations = this.conversations.filter(t => t.id !== threadId);
        if (this.currentThread?.id === threadId) {
            this.currentThread = this.conversations[0] || this.createNewThread();
        }
        this.saveConversations();
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateThreads',
                threads: this.conversations,
                currentThread: this.currentThread
            });
        }
    }

    async _executeCommand(command) {
        const terminal = vscode.window.createTerminal('Ollama Assistant');
        terminal.show();
        terminal.sendText(command);
        return `Executing command: ${command}`;
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

    async _getWorkspaceFiles() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return [];
        
        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        return files.map(file => ({
            path: vscode.workspace.asRelativePath(file),
            name: path.basename(file.fsPath)
        }));
    }
}

module.exports = OllamaViewProvider; 