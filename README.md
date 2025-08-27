<div align="center">

# 🧙‍♂️ Gemini Commit Wizard

**AI-Powered Git Commit Generation with Gemini CLI**

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.0+-ff69b4?style=for-the-badge&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=for-the-badge&logo=typescript)](https://typescriptlang.org)

*Transform your git workflow with intelligent commit generation powered by Google's Gemini AI*

</div>

---

## 🌟 Features

- **🤖 AI-Powered Analysis**: Gemini CLI analyzes your code changes and generates meaningful commit messages
- **🎨 Interactive UI**: Native dialogs on macOS/Linux with terminal fallback
- **📝 Structured Commits**: Consistent format with technical details and changelog sections
- **🔄 Multi-Commit Support**: Automatically separates logical changes into multiple commits
- **⚡ Auto-Execution**: One-click commit generation and push
- **🛠️ WebStorm Integration**: Ready-to-use run configurations
- **🌍 Cross-Platform**: Works on macOS, Linux, and Windows
- **📦 Version Management**: Semantic versioning with automated changelog generation

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) configured with API key
- Git repository

### Installation

```bash
# Clone the repository
git clone https://github.com/MKS2508/gemini-commit-wizard.git
cd gemini-commit-wizard

# Install dependencies
bun install
```

### Basic Usage

```bash
# Interactive commit generation (recommended)
bun src/commit-ui.ts

# Quick mode without prompts
bun src/commit-ui.ts --quick

# Manual with specific context
bun src/commit-generator.ts --context "user authentication system" --work-type feature
```

## 💡 How It Works

1. **📊 Change Analysis**: Scans your git repository for staged and unstaged changes
2. **🧠 AI Processing**: Sends structured prompts to Gemini CLI for intelligent analysis
3. **📝 Commit Generation**: Creates well-formatted commits with technical details and changelog entries
4. **✅ Auto-Execution**: Optionally executes commits and pushes to remote repository

## 🎛️ Interactive UI

### macOS Experience
![macOS Dialog](https://via.placeholder.com/600x400/007ACC/white?text=macOS+Native+Dialogs)

### Linux Experience  
![Linux Zenity](https://via.placeholder.com/600x400/28a745/white?text=Linux+Zenity+Dialogs)

### Terminal Fallback
![Terminal UI](https://via.placeholder.com/600x300/6c757d/white?text=Terminal+Fallback+Interface)

## 📋 Commit Format

Generated commits follow a structured format:

```
feat(auth): implement OAuth2 integration with Google

Adds complete OAuth2 authentication flow with Google provider, including
token refresh, user profile fetching, and automatic session management.

<technical>
- Added GoogleOAuthProvider class with token management
- Implemented refresh token rotation in AuthService
- Created user profile synchronization with Google API
- Added OAuth2 configuration in environment variables
- Updated database schema with oauth_tokens table
</technical>

<changelog>
## [New] ✨
OAuth2 authentication with Google for seamless user login
</changelog>
```

## 🔧 Configuration

### Gemini CLI Setup

```bash
# Install Gemini CLI
npm install -g @google/generative-ai-cli

# Configure API key
export GEMINI_API_KEY="your-api-key-here"

# Verify installation
gemini --version
```

### WebStorm Integration

The project includes pre-configured WebStorm run configurations:

- **Commit UI Interactive**: Full interactive commit generation
- **Commit UI Quick**: Quick commit without prompts

## 📚 Commands Reference

### Commit Generation

```bash
# Interactive UI
bun src/commit-ui.ts

# Quick mode
bun src/commit-ui.ts --quick

# With specific parameters
bun src/commit-generator.ts \
  --context "payment processing" \
  --work-type feature \
  --affected-components "api,database" \
  --auto-approve
```

### Version Management

```bash
# Analyze commits and create version
bun src/version-manager.ts

# Force version type
bun src/version-manager.ts --type minor

# Development version
bun src/version-manager.ts --prefix alpha

# Initialize from git history
bun src/version-manager.ts --init
```

### Available Options

| Option | Description | Values |
|--------|-------------|---------|
| `--context` | Describe the work being done | Any descriptive text |
| `--work-type` | Type of work | `feature`, `fix`, `refactor`, `docs`, `test` |
| `--affected-components` | Components changed | Comma-separated list |
| `--performance-impact` | Performance impact | `none`, `minor`, `major` |
| `--auto-approve` | Skip confirmation | Boolean flag |
| `--no-push` | Don't push to remote | Boolean flag |

## 🏗️ Project Structure

```
gemini-commit-wizard/
├── src/
│   ├── commit-generator.ts    # Core commit generation engine
│   ├── commit-ui.ts          # Interactive user interface
│   ├── prompt-templates.ts   # Gemini AI prompt templates
│   └── version-manager.ts    # Semantic versioning system
├── .run/                     # WebStorm configurations
│   ├── commit-ui-interactive.run.xml
│   └── commit-ui-quick.run.xml
├── .temp/                    # Generated files (git ignored)
├── CLAUDE.md                 # AI assistant instructions
├── package.json              # Project dependencies
└── README.md                 # This file
```

## 🌐 Platform Support

### macOS
- Native AppleScript dialogs
- Full interactive experience
- Automatic GUI detection

### Linux
- Zenity-based dialogs (install with package manager)
- GTK integration
- Terminal fallback

### Windows
- Terminal-based interface
- PowerShell compatibility
- Windows Terminal support

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Use the commit wizard to generate your commits! 
   ```bash
   bun src/commit-ui.ts
   ```
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Google Gemini](https://ai.google.dev/) for the powerful AI capabilities
- [Bun](https://bun.sh) for the fast JavaScript runtime
- [Zenity](https://wiki.gnome.org/Projects/Zenity) for Linux dialog support

---

<div align="center">

**Made with ❤️ by [MKS2508](https://github.com/MKS2508)**

*Revolutionize your git workflow with AI-powered commit generation*

</div>