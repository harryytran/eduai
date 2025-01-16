# EduAI VSCode Extension

A VSCode extension that integrates with Ollama to provide local LLM capabilities directly in your editor.

## Prerequisites

1. Install [Ollama](https://ollama.ai/) on your system
2. Pull your desired model using Ollama CLI (e.g., `ollama pull llama2`)
3. Make sure Ollama is running locally (default port: 11434)

## Features

- **Ask Ollama**: Send queries to your local Ollama instance directly from VSCode
  - Use selected text as context or enter a new prompt
  - Responses are displayed in a new markdown document
- **Set Ollama Model**: Choose which Ollama model to use for responses

## Usage

1. Install the extension
2. Ensure Ollama is running locally
3. Use the following commands:
   - `Ask Ollama`: Opens an input box for your query or uses selected text
   - `Set Ollama Model`: Configure which model to use (e.g., llama2, codellama, mistral)

## Extension Settings

This extension contributes the following settings:

* `eduai.ollamaHost`: Ollama API host URL (default: "http://localhost:11434")
* `eduai.ollamaModel`: Ollama model to use (default: "llama2")

## Known Issues

- Requires Ollama to be running locally
- Large responses may take some time to generate

## Release Notes

### 0.0.1

Initial release:
- Basic Ollama integration
- Support for text queries
- Model selection
- Configuration options
