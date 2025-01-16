// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const axios = require('axios');
const OllamaViewProvider = require('./ollamaView');

async function askOllama(prompt) {
	const config = vscode.workspace.getConfiguration('eduai');
	const host = config.get('ollamaHost');
	const model = config.get('ollamaModel');

	try {
		const response = await axios.post(`${host}/api/generate`, {
			model: model,
			prompt: prompt,
			stream: false
		});
		return response.data.response;
	} catch (error) {
		throw new Error(`Failed to communicate with Ollama: ${error.message}`);
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('EduAI extension is now active!');

	// Register Ollama View Provider
	const ollamaViewProvider = new OllamaViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('eduai.ollamaView', ollamaViewProvider)
	);

	// Register commands
	let askOllamaCommand = vscode.commands.registerCommand('eduai.askOllama', async () => {
		const editor = vscode.window.activeTextEditor;
		let prompt = '';

		if (editor && editor.selection && !editor.selection.isEmpty) {
			prompt = editor.document.getText(editor.selection);
		} else {
			prompt = await vscode.window.showInputBox({
				placeHolder: 'Enter your question for Ollama...',
				prompt: 'Ask Ollama'
			});
		}

		if (!prompt) return;

		try {
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Asking Ollama...",
				cancellable: false
			}, async () => {
				const response = await askOllama(prompt);
				
				const document = await vscode.workspace.openTextDocument({
					content: response,
					language: 'markdown'
				});
				await vscode.window.showTextDocument(document);
			});
		} catch (error) {
			vscode.window.showErrorMessage(error.message);
		}
	});

	let setModelCommand = vscode.commands.registerCommand('eduai.setOllamaModel', async () => {
		const model = await vscode.window.showInputBox({
			placeHolder: 'Enter model name (e.g., llama2, codellama, mistral)',
			prompt: 'Set Ollama Model'
		});

		if (model) {
			const config = vscode.workspace.getConfiguration('eduai');
			await config.update('ollamaModel', model, true);
			vscode.window.showInformationMessage(`Ollama model set to: ${model}`);
		}
	});

	context.subscriptions.push(askOllamaCommand, setModelCommand);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
