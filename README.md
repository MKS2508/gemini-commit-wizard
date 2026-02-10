<div align="center">

# Gemini Commit Wizard

**AI-Powered Git Commit Generation with Multi-Provider Support**

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![npm](https://img.shields.io/npm/v/gemini-commit-wizard?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/gemini-commit-wizard)
[![Bun](https://img.shields.io/badge/Bun-1.0+-ff69b4?style=for-the-badge&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=for-the-badge&logo=typescript)](https://typescriptlang.org)

*Transform your git workflow with intelligent commit generation powered by multiple AI providers*

</div>

---

## Features

- **Multi-Provider AI**: Choose between Gemini SDK, Groq, OpenRouter (300+ models), or Gemini CLI
- **Auto-Detection**: Automatically selects the best available provider from your environment
- **Per-Project Config**: `.commit-wizard.json` for project-specific context, components, and preferences
- **Interactive UI**: Native dialogs on macOS/Linux with terminal fallback
- **Structured Commits**: Consistent format with `<technical>` and `<changelog>` sections
- **Multi-Commit Support**: Automatically separates logical changes into multiple commits
- **Auto-Execution**: One-click commit generation and push
- **Version Management**: Semantic versioning with automated changelog generation
- **Cross-Platform**: Works on macOS, Linux, and Windows

## AI Providers

| Provider | Env Variable | Default Model | Speed | Notes |
|----------|-------------|---------------|-------|-------|
| **Gemini SDK** | `GEMINI_API_KEY` | `gemini-2.5-flash` | Fast | Recommended default |
| **Groq** | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | Ultra-fast | Best latency |
| **OpenRouter** | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` | Varies | 300+ models available |
| **Gemini CLI** | _(needs `gemini` binary)_ | CLI default | Moderate | No API key needed |

**Auto-detection order**: Gemini SDK > Groq > OpenRouter > Gemini CLI. The first provider with a valid API key (or binary) is used.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- At least ONE of:
  - `GEMINI_API_KEY` environment variable (for Gemini SDK)
  - `GROQ_API_KEY` environment variable (for Groq)
  - `OPENROUTER_API_KEY` environment variable (for OpenRouter)
  - [Gemini CLI](https://ai.google.dev/gemini-api/docs/gemini-cli) binary installed (fallback)

### Installation

```bash
# Install as a dependency in your project
npm install gemini-commit-wizard
# or
bun add gemini-commit-wizard

# Or clone for standalone use
git clone https://github.com/MKS2508/gemini-commit-wizard.git
cd gemini-commit-wizard
bun install
```

### Basic Usage

```bash
# Interactive commit generation (auto-detects provider)
bun src/commit-ui.ts

# Quick mode without prompts
bun src/commit-ui.ts --quick

# Use a specific provider
bun src/commit-ui.ts --provider groq

# Use a specific provider + model
bun src/commit-generator.ts --provider openrouter --model anthropic/claude-sonnet-4

# Auto-approve without confirmation
bun src/commit-generator.ts --auto-approve --no-push

# List available providers and their status
bun src/commit-generator.ts --list-providers
```

### Usage as npm dependency

When installed as a project dependency, invoke via bun:

```bash
# In your package.json scripts:
{
  "commit": "bun node_modules/gemini-commit-wizard/src/commit-ui.ts",
  "commit:quick": "bun node_modules/gemini-commit-wizard/src/commit-ui.ts --quick",
  "commit:auto": "bun node_modules/gemini-commit-wizard/src/commit-generator.ts --auto-approve --no-push"
}
```

## How It Works

1. **Change Analysis**: Scans your git repository for staged and unstaged changes
2. **Project Context**: Loads `.commit-wizard.json` (or auto-detects from `package.json`)
3. **AI Processing**: Sends structured prompts to the selected AI provider
4. **Commit Generation**: Creates well-formatted commits with technical details and changelog entries
5. **Auto-Execution**: Optionally executes commits and pushes to remote

## Project Configuration

Create a `.commit-wizard.json` in your project root for project-specific AI context:

```json
{
  "name": "my-project",
  "description": "Brief description of your project",
  "version": "1.0.0",
  "techStack": ["TypeScript", "React", "Node.js"],
  "targetPlatform": "Web",
  "components": [
    { "id": "api", "path": "src/api/", "name": "REST API" },
    { "id": "ui", "path": "src/components/", "name": "UI Components" },
    { "id": "db", "path": "src/database/", "name": "Database Layer" }
  ],
  "commitFormat": {
    "titleLanguage": "english",
    "bodyLanguage": "spanish",
    "includeTechnical": true,
    "includeChangelog": true
  },
  "provider": "groq",
  "model": "llama-3.3-70b-versatile"
}
```

### Config Resolution Order

1. `.commit-wizard.json` in project root (highest priority)
2. `"commitWizard"` key in `package.json`
3. Auto-detected from `package.json` name, description, and dependencies

### Components

When `components` are defined, the AI uses component IDs as commit scope areas:

```
feat(api): add pagination endpoint
fix(ui): correct button alignment on mobile
refactor(db): optimize query for user lookup
```

### Commit Format

| Option | Values | Description |
|--------|--------|-------------|
| `titleLanguage` | `english`, `spanish`, etc. | Language for commit title |
| `bodyLanguage` | `english`, `spanish`, etc. | Language for commit description |
| `includeTechnical` | `true`/`false` | Include `<technical>` section |
| `includeChangelog` | `true`/`false` | Include `<changelog>` section |

## Commit Format

Generated commits follow a structured format:

```
feat(auth): implement OAuth2 integration with Google

Adds complete OAuth2 authentication flow with Google provider.

<technical>
- Added GoogleOAuthProvider class with token management
- Implemented refresh token rotation in AuthService
- Created user profile synchronization with Google API
</technical>

<changelog>
## [New]
OAuth2 authentication with Google for seamless user login
</changelog>
```

## CLI Reference

### Commit Generation

```bash
bun src/commit-ui.ts [options]
bun src/commit-generator.ts [options]
```

| Option | Description | Values |
|--------|-------------|--------|
| `--provider` | AI provider to use | `gemini-sdk`, `groq`, `openrouter`, `gemini-cli` |
| `--model` | Override default model | Any model ID supported by the provider |
| `--context` | Describe the work being done | Any descriptive text |
| `--work-type` | Type of work | `feature`, `fix`, `refactor`, `docs`, `test` |
| `--affected-components` | Components changed | Comma-separated list |
| `--auto-approve` | Skip confirmation | Boolean flag |
| `--no-push` | Don't push to remote | Boolean flag |
| `--list-providers` | Show available providers | Boolean flag |
| `--quick` | Quick mode (commit-ui only) | Boolean flag |

Environment variable `COMMIT_WIZARD_PROVIDER` can also be used to set the default provider.

### Version Management

```bash
bun src/version-manager.ts [options]
```

| Option | Description |
|--------|-------------|
| `--type major\|minor\|patch` | Force version bump type |
| `--prefix alpha\|beta` | Add pre-release prefix |
| `--sync` | Sync versions across packages |
| `--init` | Initialize from git history |

## Project Structure

```
gemini-commit-wizard/
├── src/
│   ├── providers.ts          # Multi-provider AI abstraction layer
│   ├── project-config.ts     # Project config loader (.commit-wizard.json)
│   ├── commit-generator.ts   # Core commit generation engine
│   ├── commit-ui.ts          # Interactive user interface
│   ├── prompt-templates.ts   # AI prompt templates and response parser
│   └── version-manager.ts    # Semantic versioning system
├── .run/                     # WebStorm run configurations
├── .temp/                    # Generated files (git ignored)
├── package.json
└── README.md
```

## Platform Support

### macOS
- Native AppleScript dialogs for interactive UI
- Full GUI experience with automatic detection

### Linux
- Zenity-based dialogs (install: `sudo apt install zenity`)
- GTK integration with terminal fallback

### Windows
- Terminal-based interface
- PowerShell compatibility

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Use the commit wizard to generate your commits:
   ```bash
   bun src/commit-ui.ts
   ```
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Made by [MKS2508](https://github.com/MKS2508)**

</div>
