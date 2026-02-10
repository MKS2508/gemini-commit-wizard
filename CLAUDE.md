# Gemini Commit Wizard - AI-Powered Commit Generation

## Architecture

### Multi-Provider System

The wizard supports 4 AI providers via a common `IAIProvider` interface in `src/providers.ts`:

| Provider | Class | Env Variable | Default Model |
|----------|-------|-------------|---------------|
| Gemini SDK | `GeminiSdkProvider` | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| Groq | `GroqProvider` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| OpenRouter | `OpenRouterProvider` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4` |
| Gemini CLI | `GeminiCliProvider` | _(needs `gemini` binary)_ | CLI default |

**Auto-detection order** (when no `--provider` specified):
1. `GEMINI_API_KEY` set -> Gemini SDK
2. `GROQ_API_KEY` set -> Groq
3. `OPENROUTER_API_KEY` set -> OpenRouter
4. `gemini` binary found -> Gemini CLI

Provider selection: `--provider <name>`, `COMMIT_WIZARD_PROVIDER` env var, or `.commit-wizard.json` `provider` field.

### Project Configuration

`src/project-config.ts` loads config from (in priority order):
1. `.commit-wizard.json` in project root
2. `"commitWizard"` key in `package.json`
3. Auto-detected from `package.json` (name, description, dependencies)

Config fields: `name`, `description`, `version`, `techStack`, `targetPlatform`, `components[]`, `commitFormat`, `provider`, `model`.

Components are used as commit scope areas. CommitFormat controls title/body language and inclusion of technical/changelog sections.

## Project Structure

```
gemini-commit-wizard/
├── src/
│   ├── providers.ts          # IAIProvider interface + 4 implementations + factory
│   ├── project-config.ts     # Config loader (.commit-wizard.json / package.json)
│   ├── commit-generator.ts   # Core engine: analyzeWithAI(), git operations
│   ├── commit-ui.ts          # Interactive UI: macOS/Linux dialogs, terminal fallback
│   ├── prompt-templates.ts   # Prompt construction + response parsing
│   └── version-manager.ts    # Semantic versioning automation
├── .run/                     # WebStorm run configurations
└── .temp/                    # Temporary prompt/response files (git ignored)
```

## Commit Message Patterns

### Structure

```
[type]([scope]): [description]

[Body in configured language]

<technical>
[Technical details: files, functions, types modified]
</technical>

<changelog>
## [Type] [Emoji]
[User-facing changelog entry]
</changelog>
```

### Valid Types
- `feat(` - New functionality
- `fix(` - Bug fix
- `refactor(` - Code refactoring
- `docs(` - Documentation update
- `test(` - Tests
- `feat-phase(` - Incomplete feature (phased development)

### Response Format

The AI responds with structured proposals:

```markdown
### **Propuesta de Commit #1**
type(scope): description

Body text...

<technical>
- Technical details
</technical>

<changelog>
## [Type] [Emoji]
Changelog entry
</changelog>

---

### **Propuesta de Commit #2** (if needed)
[Same format]

---

**DECISION**: [Why single vs multiple commits]
```

## Commands

### Commit Generation
```bash
# Interactive UI (auto-detects provider)
bun src/commit-ui.ts

# Quick mode
bun src/commit-ui.ts --quick

# Specific provider
bun src/commit-generator.ts --provider groq

# Specific provider + model
bun src/commit-generator.ts --provider openrouter --model anthropic/claude-sonnet-4

# Auto-approve mode
bun src/commit-generator.ts --auto-approve --no-push

# List providers
bun src/commit-generator.ts --list-providers
```

### Version Management
```bash
bun src/version-manager.ts              # Analyze and bump
bun src/version-manager.ts --type minor # Force minor bump
bun src/version-manager.ts --prefix alpha # Pre-release
```

## SDK Notes

### OpenRouter SDK
- Named export: `import { OpenRouter } from '@openrouter/sdk'`
- API: `client.chat.send({ model, messages, stream: false })`
- Response: `(result as any).choices?.[0]?.message?.content`

### Gemini SDK
- `import { GoogleGenAI } from '@google/genai'`
- API: `ai.models.generateContent({ model, contents: prompt })`
- Response: `response.text`

### Groq SDK
- Default export: `import Groq from 'groq-sdk'`
- API: `client.chat.completions.create({ model, messages, temperature: 0.3 })`
- Response: `completion.choices[0]?.message?.content`

## Development

### Dependencies
- **Runtime**: Bun >= 1.0
- **AI SDKs**: `@google/genai`, `groq-sdk`, `@openrouter/sdk` (all bundled)
- **Git**: Required for change analysis

### Publishing
```bash
# Bump version in package.json
bun install
npm publish
```

Note: npm strips `.ts` bin entries. Consumers should use `bun node_modules/gemini-commit-wizard/src/commit-ui.ts` in their scripts.

## Author Guidelines

- **Author**: MKS2508
- **Clean commits**: No debugging comments or unnecessary explanations
- **Focused scope**: Each commit should have a single clear purpose
