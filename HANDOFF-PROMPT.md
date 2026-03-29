# Handoff Prompt: gemini-commit-wizard v2.0 Upgrade

## Project Location

```
/Volumes/KODAK1TB/REPOS y PROYECTOS/nodejs/gemini-commit-wizard/
```

## Current State (v1.1.3)

Working multi-provider commit generator with 4 AI backends (Gemini SDK, Groq, OpenRouter, Gemini CLI). CLI-only usage — no SDK/programmatic API. Code has numerous violations of the project coding standards. The CLI UX is barebones (raw console.log with emojis, no spinners, no animations, no progress).

## Goals (4 parallel tracks)

### Track 1: MUST-FOLLOW-GUIDELINES Compliance

The codebase MUST comply with the coding standards defined below. Current violations:

**VIOLATIONS TO FIX:**

1. **`console.log` / `console.error` / `console.warn` everywhere** — Replace with a proper internal logging layer. DO NOT use `@mks2508/better-logger` yet — that package is being rewritten (see Track 4). Instead, create a lightweight `src/logger.ts` abstraction that:
   - Wraps all output behind a single interface (`log.info()`, `log.error()`, `log.success()`, `log.warn()`, `log.debug()`, `log.step()`)
   - Supports verbosity levels (`silent`, `quiet`, `normal`, `verbose`, `debug`)
   - Can be swapped later for `@mks2508/better-logger` v5 when it ships
   - Uses chalk for colored output in normal/verbose mode
   - Respects `--quiet` and `--verbose` CLI flags
   - Has a `log.spinner(text)` method that returns a spinner handle (start/stop/succeed/fail)

   ```typescript
   // src/logger.ts — Internal logger (will be replaced by better-logger v5)
   import chalk from 'chalk';

   export type LogLevel = 'silent' | 'quiet' | 'normal' | 'verbose' | 'debug';

   class WizardLogger {
     private level: LogLevel = 'normal';

     setLevel(level: LogLevel): void { this.level = level; }

     info(msg: string, ...args: unknown[]): void { ... }
     success(msg: string, ...args: unknown[]): void { ... }
     warn(msg: string, ...args: unknown[]): void { ... }
     error(msg: string, ...args: unknown[]): void { ... }
     debug(msg: string, ...args: unknown[]): void { ... }
     step(num: number, total: number, msg: string): void { ... }
     spinner(msg: string): ISpinnerHandle { ... }
   }

   export const log = new WizardLogger();
   ```

2. **No Result pattern** — All operations that can fail MUST return `Result<T, E>` from `@mks2508/no-throw` v0.1.0. Currently uses raw try/catch with thrown exceptions everywhere.

   ```typescript
   // WRONG (current)
   async generate(prompt: string): Promise<string> {
     const result = await ai.models.generateContent({...});
     return result.text || '';
   }

   // CORRECT
   import { ok, err, tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';

   async generate(prompt: string): Promise<Result<string, ResultError<'PROVIDER_ERROR'>>> {
     return tryCatchAsync(
       async () => {
         const result = await ai.models.generateContent({...});
         return result.text || '';
       },
       'PROVIDER_ERROR'
     );
   }
   ```

3. **Missing JSDoc** — Many functions/classes lack JSDoc or have incomplete JSDoc. Every exported function, class, method, interface, and type MUST have full JSDoc with `@param`, `@returns`, `@example`, `@throws` tags.

4. **Interfaces missing `I` prefix** — Some interfaces are named without the `I` prefix:
   - `FileChange` -> `IFileChange`
   - `GitStats` -> `IGitStats`
   - `CommitAnalysis` -> `ICommitAnalysis`
   - `CommitProposal` -> `ICommitProposal`
   - `CommitOptions` -> `ICommitOptions`
   - `StandardResponseFormat` -> `IStandardResponseFormat`
   - `GeminiPromptConfig` -> `IGeminiPromptConfig` (or keep as type without prefix)

5. **No barrel exports** — Missing `src/index.ts` barrel export file. Need `src/types/` directory with barrel exports for all types.

6. **Promise chaining in some places** — Should use async/await consistently.

**ADD THESE DEPENDENCIES:**
```bash
bun add @mks2508/no-throw@^0.1.0
bun add chalk@^5.4.0
bun add ora@^8.0.0
```

**DO NOT add `@mks2508/better-logger` yet** — it's being rewritten (Track 4). Use the internal `src/logger.ts` wrapper instead.

### Track 2: SDK/Package API (Programmatic Usage)

Currently gemini-commit-wizard is CLI-only. It needs a clean programmatic API so other projects can import and use it as a library, not just as a CLI tool.

**Create `src/index.ts` as the main SDK entry point:**

```typescript
// src/index.ts — Public SDK API

// Core classes
export { CommitGenerator } from './commit-generator';
export { CommitUI } from './commit-ui';

// Providers
export {
  createProvider,
  listProviders,
  type IAIProvider,
  type ProviderName,
  GeminiSdkProvider,
  GroqProvider,
  OpenRouterProvider,
  GeminiCliProvider,
} from './providers';

// Config
export {
  loadProjectConfig,
  type IProjectConfig,
  type IProjectComponent,
  type ICommitFormat,
} from './project-config';

// Prompt system
export {
  createCommitPrompt,
  createWorkflowPrompt,
  createReleasePrompt,
  GeminiResponseParser,
  type IGeminiPromptConfig,
} from './prompt-templates';

// Types
export type {
  IFileChange,
  IGitStats,
  ICommitAnalysis,
  ICommitProposal,
} from './types';
```

**Refactor CommitGenerator for SDK usage:**

The `CommitGenerator` class currently reads `process.argv` in constructor and `generate()`. Refactor to accept options programmatically:

```typescript
export interface ICommitGeneratorOptions {
  projectRoot?: string;
  provider?: ProviderName;
  model?: string;
  autoApprove?: boolean;
  noPush?: boolean;
  exhaustive?: boolean;
  context?: string;
  workType?: string;
  affectedComponents?: string;
  /** Suppress all output (for SDK usage) */
  silent?: boolean;
}

export class CommitGenerator {
  constructor(options?: ICommitGeneratorOptions) {
    // Accept programmatic options, DON'T read process.argv here
  }

  /** Analyze changes and return proposals without executing */
  async analyze(): Promise<Result<ICommitProposal[], ResultError<CommitErrorCode>>> { ... }

  /** Analyze and execute commits */
  async generate(): Promise<Result<ICommitResult, ResultError<CommitErrorCode>>> { ... }

  /** Get the AI provider being used */
  getProvider(): IAIProvider { ... }

  /** Get loaded project config */
  getConfig(): IProjectConfig { ... }
}
```

Keep CLI entry point (`if (import.meta.main)`) as a thin wrapper that parses argv and calls the SDK.

**Refactor CommitUI for SDK usage:**

Same pattern — CommitUI should accept options programmatically. The `generateCommit()` method currently shells out to `commit-generator.ts` via `execSync`. Instead, it should import and use CommitGenerator directly:

```typescript
export class CommitUI {
  constructor(private options?: Partial<ICommitGeneratorOptions>) {}

  async collectCommitInfo(): Promise<ICommitOptions> { ... }

  async run(): Promise<Result<void, ResultError<CommitErrorCode>>> {
    const options = await this.collectCommitInfo();
    const generator = new CommitGenerator({
      ...this.options,
      context: options.context,
      workType: options.workType,
      affectedComponents: options.affectedComponents.join(','),
      autoApprove: true,
    });
    return generator.generate();
  }
}
```

**Update package.json exports:**

```json
{
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./providers": "./src/providers.ts",
    "./config": "./src/project-config.ts",
    "./prompts": "./src/prompt-templates.ts"
  }
}
```

### Track 3: CLI UX Overhaul — Rich Terminal Interface

The current CLI is primitive: raw `console.log` with emoji prefixes, no spinners, no progress, no color hierarchy, no animations. Overhaul the entire CLI experience.

#### Dependencies to Add

```bash
bun add chalk@^5.4.0           # Colored terminal output
bun add ora@^8.0.0             # Elegant terminal spinners
bun add @inquirer/prompts@^7   # Modern interactive prompts (replaces osascript/zenity hacks)
bun add cli-table3@^0.6.5     # Formatted tables
bun add boxen@^8.0.0           # Boxed terminal output
bun add figures@^6.1.0         # Cross-platform Unicode symbols
```

#### Replace macOS/Linux Dialog System

The current `commit-ui.ts` uses platform-specific hacks:
- macOS: AppleScript via `osascript -l JavaScript` — fragile, breaks if Terminal doesn't have accessibility permissions
- Linux: Zenity — requires GUI, fails in pure SSH/terminal sessions
- Fallback: Raw `readline` — no colors, no validation, ugly

**Replace ALL of these with `@inquirer/prompts`** for a unified, beautiful terminal experience that works everywhere:

```typescript
import { input, select, checkbox, confirm } from '@inquirer/prompts';

async collectCommitInfo(): Promise<ICommitOptions> {
  // Step header with chalk
  log.step(1, 4, 'Describe your changes');

  const context = await input({
    message: 'What did you implement/fix?',
    validate: (v) => v.length > 0 || 'Description is required',
  });

  log.step(2, 4, 'Select work type');

  const workType = await select({
    message: 'Work type:',
    choices: [
      { value: 'feature', name: 'Feature — New functionality', description: 'feat()' },
      { value: 'fix', name: 'Fix — Bug correction', description: 'fix()' },
      { value: 'refactor', name: 'Refactor — Code improvement', description: 'refactor()' },
      { value: 'docs', name: 'Docs — Documentation update', description: 'docs()' },
      { value: 'test', name: 'Test — Tests', description: 'test()' },
    ],
  });

  log.step(3, 4, 'Select affected components');

  // Load from .commit-wizard.json if available
  const config = loadProjectConfig(process.cwd());
  const componentChoices = config.components?.map(c => ({
    value: c.id,
    name: `${c.name} (${c.path})`,
  })) || [
    { value: 'core', name: 'Core' },
    { value: 'ui', name: 'UI' },
    { value: 'api', name: 'API' },
  ];

  const affectedComponents = await checkbox({
    message: 'Components changed:',
    choices: componentChoices,
  });

  log.step(4, 4, 'Confirm');

  // Show summary box before proceeding
  const summary = boxen(
    [
      `${chalk.bold('Context:')} ${context}`,
      `${chalk.bold('Type:')} ${workType}`,
      `${chalk.bold('Components:')} ${affectedComponents.join(', ')}`,
      `${chalk.bold('Provider:')} ${this.provider.name} (${this.provider.model})`,
    ].join('\n'),
    { title: 'Commit Summary', padding: 1, borderColor: 'cyan' }
  );
  console.log(summary);

  const proceed = await confirm({ message: 'Generate commit?', default: true });
  if (!proceed) throw new Error('Cancelled');

  return { context, workType, affectedComponents };
}
```

#### Animated Step-by-Step Flow

The commit generation process should show a clear step-by-step progress with spinners and timing:

```typescript
async generate(): Promise<Result<ICommitResult, ...>> {
  // Step 1: Stage changes
  const stageSpinner = log.spinner('Staging changes...');
  stageSpinner.start();
  const stageResult = await this.stageAllChanges();
  if (isErr(stageResult)) { stageSpinner.fail('Failed to stage'); return err(...); }
  stageSpinner.succeed(`Staged ${fileCount} files`);

  // Step 2: Analyze repository
  const analyzeSpinner = log.spinner('Analyzing repository...');
  analyzeSpinner.start();
  const analysis = await this.generateAnalysisContext();
  analyzeSpinner.succeed(`Analyzed: +${stats.additions} -${stats.deletions} lines`);

  // Step 3: AI processing
  const aiSpinner = log.spinner(`Generating with ${this.provider.name}...`);
  aiSpinner.start();
  log.time('ai-generation');
  const response = await this.provider.generate(prompt);
  const elapsed = log.timeEnd('ai-generation');
  aiSpinner.succeed(`AI analysis complete (${elapsed}ms)`);

  // Step 4: Parse proposals
  const proposals = this.parseCommitProposals(response);

  // Show proposals in a formatted table
  const table = new Table({
    head: [chalk.cyan('#'), chalk.cyan('Title'), chalk.cyan('Files')],
  });
  proposals.forEach((p, i) => table.push([i + 1, p.title, p.files?.length || 'all']));
  console.log(table.toString());

  // Step 5: Execute commits (if auto-approve)
  if (this.options.autoApprove) {
    for (let i = 0; i < proposals.length; i++) {
      const commitSpinner = log.spinner(`Commit ${i + 1}/${proposals.length}: ${proposals[i].title}`);
      commitSpinner.start();
      const success = await this.executeCommit(proposals[i]);
      success ? commitSpinner.succeed() : commitSpinner.fail();
    }
  }

  // Final summary box
  console.log(boxen(
    `${chalk.green.bold(successCount)} commits executed\n${chalk.dim(`Provider: ${this.provider.name} | ${elapsed}ms`)}`,
    { title: 'Done', padding: 1, borderColor: 'green', borderStyle: 'round' }
  ));
}
```

#### ASCII Header / Branding

Add a subtle ASCII header when running interactively (not in `--quiet` or `--json` mode):

```typescript
function showHeader(): void {
  if (log.level === 'quiet' || log.level === 'silent') return;
  console.log(chalk.cyan.bold('  Commit Wizard') + chalk.dim(' v' + version));
  console.log(chalk.dim('  AI-powered commit generation\n'));
}
```

Keep it minimal — no giant ASCII art. Just clean branding.

#### Provider Status Table

For `--list-providers`, show a proper formatted table:

```typescript
const table = new Table({
  head: ['', 'Provider', 'Status', 'Model', 'Requirement'],
  style: { head: ['cyan'] },
});

for (const p of listProviders()) {
  table.push([
    p.available ? chalk.green(figures.tick) : chalk.red(figures.cross),
    p.name,
    p.available ? chalk.green('Available') : chalk.red('Missing'),
    p.available ? getDefaultModel(p.id) : chalk.dim('—'),
    chalk.dim(p.requirement),
  ]);
}
console.log(table.toString());
```

### Track 4: Prepare for @mks2508/better-logger v5 Integration (FUTURE — DO NOT IMPLEMENT YET)

**CONTEXT FOR THE FUTURE**: `@mks2508/better-logger` is being rewritten for v5 with these goals:
- **chalk integration** for rich colored output
- **Inquirer-style interactive prompts** built into the logger
- **Spinner/progress primitives** (ora-like but integrated)
- **Step-by-step animations** for multi-phase workflows
- **ANSI art / boxed output** for headers and summaries
- **Proper Node.js/Bun server-side support** (structured JSON logs, transports)
- **CLI mode vs Server mode** — automatic detection or explicit config
- **Verbosity levels** that map to CLI quietness

**What to do NOW in gemini-commit-wizard:**
- Build the internal `src/logger.ts` abstraction (Track 1) with the SAME interface that better-logger v5 will expose
- Use chalk, ora, boxen, cli-table3, @inquirer/prompts directly in v2.0
- When better-logger v5 ships, the migration will be: delete `src/logger.ts`, replace import with `@mks2508/better-logger`, done

**The `src/logger.ts` interface should be designed so that better-logger v5 is a DROP-IN replacement:**

```typescript
// This is the target interface for both src/logger.ts AND better-logger v5
export interface IWizardLogger {
  // Basic logging (like better-logger v4)
  info(msg: string, ...args: unknown[]): void;
  success(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;

  // CLI-specific (NEW in v5 / implemented in src/logger.ts)
  step(current: number, total: number, msg: string): void;
  spinner(msg: string): ISpinnerHandle;
  table(rows: Record<string, unknown>[]): void;
  box(content: string, options?: IBoxOptions): void;
  header(title: string, subtitle?: string): void;
  divider(): void;
  blank(): void;

  // Timing
  time(label: string): void;
  timeEnd(label: string): number; // returns elapsed ms

  // Config
  setLevel(level: LogLevel): void;
  readonly level: LogLevel;
}

export interface ISpinnerHandle {
  start(): void;
  stop(): void;
  succeed(msg?: string): void;
  fail(msg?: string): void;
  text(msg: string): void;
}
```

This way, the future migration to better-logger v5 will be mechanical (search & replace import path).

---

## File Structure After Refactor

```
gemini-commit-wizard/
├── src/
│   ├── index.ts              # SDK entry point (barrel export)
│   ├── logger.ts             # Internal logger (chalk+ora+boxen wrapper, future better-logger v5 drop-in)
│   ├── types/
│   │   ├── index.ts          # Barrel export for all types
│   │   ├── commit.types.ts   # IFileChange, IGitStats, ICommitAnalysis, ICommitProposal
│   │   ├── config.types.ts   # IProjectConfig, IProjectComponent, ICommitFormat
│   │   └── provider.types.ts # IAIProvider, ProviderName
│   ├── providers/
│   │   ├── index.ts          # Barrel export + factory + listProviders
│   │   ├── gemini-cli.ts     # GeminiCliProvider
│   │   ├── gemini-sdk.ts     # GeminiSdkProvider
│   │   ├── groq.ts           # GroqProvider
│   │   └── openrouter.ts     # OpenRouterProvider
│   ├── commit-generator.ts   # Core engine (SDK-first, options-based)
│   ├── commit-ui.ts          # Interactive UI (inquirer, uses CommitGenerator directly)
│   ├── project-config.ts     # Config loader
│   ├── prompt-templates.ts   # Prompt construction + response parser
│   └── version-manager.ts    # Versioning (separate concern)
├── package.json
├── CLAUDE.md
└── README.md
```

## Coding Standards Reference (MUST FOLLOW)

### Logger — Use internal src/logger.ts (NOT console.log, NOT better-logger v4)

```typescript
import { log } from './logger';

// Basic logging
log.info('Analyzing changes...');
log.success('Commit executed');
log.error('Failed', error);
log.warn('No changes found');
log.debug('Verbose detail', { data });

// Step progress
log.step(1, 5, 'Staging changes');
log.step(2, 5, 'Analyzing repository');

// Spinners
const spinner = log.spinner('Generating with AI...');
spinner.start();
// ... async work ...
spinner.succeed('Generated 3 proposals (1.2s)');
// or: spinner.fail('Provider error');

// Timing
log.time('ai-call');
await provider.generate(prompt);
const elapsed = log.timeEnd('ai-call');

// Formatted output
log.header('Commit Wizard', 'v2.0.0');
log.table([{ provider: 'Groq', status: 'Available', model: 'llama-3.3-70b' }]);
log.box('3 commits executed\nProvider: Groq | 1.2s', { title: 'Done', borderColor: 'green' });
log.divider();
```

### Result Pattern — ALWAYS for fallible operations

```typescript
import { ok, err, fail, isOk, isErr, tryCatchAsync, match, type Result, type ResultError } from '@mks2508/no-throw';

// Wrap all operations that can fail
async function gitCommand(args: string[]): Promise<Result<string, ResultError<'GIT_ERROR'>>> {
  return tryCatchAsync(
    async () => {
      const result = Bun.spawnSync(['git', ...args], { cwd: this.projectRoot, stdout: 'pipe', stderr: 'pipe' });
      if (result.exitCode !== 0) throw new Error(result.stderr?.toString() || 'Git command failed');
      return result.stdout?.toString().trim() || '';
    },
    'GIT_ERROR'
  );
}

// Pattern match on results
const statusResult = await this.gitCommand(['status', '--porcelain']);
if (isErr(statusResult)) {
  log.error('Git status failed', statusResult.error);
  return err(statusResult.error);
}
const output = statusResult.value;
```

### JSDoc — Complete on ALL exports

```typescript
/**
 * Generates AI-powered commit messages by analyzing git changes.
 *
 * @example
 * ```typescript
 * const generator = new CommitGenerator({ provider: 'groq' });
 * const result = await generator.analyze();
 * if (isOk(result)) {
 *   log.info('Proposals:', result.value);
 * }
 * ```
 */
export class CommitGenerator { ... }
```

### Interface Naming — Prefix I

```typescript
export interface ICommitGeneratorOptions { ... }
export interface IFileChange { ... }
export type CommitErrorCode = 'GIT_ERROR' | 'PROVIDER_ERROR' | 'PARSE_ERROR';
```

### Barrel Exports

Every directory with multiple files MUST have an `index.ts`:

```typescript
// src/types/index.ts
export * from './commit.types';
export * from './config.types';
export * from './provider.types';
```

### Async/Await — Always preferred

```typescript
// CORRECT
async function analyze(): Promise<Result<ICommitProposal[], ResultError<CommitErrorCode>>> {
  const status = await this.getRepositoryStatus();
  const stats = await this.getGitStats();
  return ok(proposals);
}

// WRONG
function analyze() {
  return this.getRepositoryStatus()
    .then(status => this.getGitStats().then(stats => proposals));
}
```

---

## Current Source Files (for reference)

The current source files are at the project location above. Read them all before starting:
- `src/providers.ts` — IAIProvider interface + 4 implementations (single file, should be split into `src/providers/`)
- `src/project-config.ts` — Config loader
- `src/commit-generator.ts` — Core engine (798 lines, CLI-coupled)
- `src/commit-ui.ts` — Interactive UI (shells out to commit-generator.ts via execSync, uses osascript/zenity hacks)
- `src/prompt-templates.ts` — Prompt construction + response parser
- `src/version-manager.ts` — Versioning system (separate concern, low priority for refactor)
- `package.json` — Current deps and scripts

## Execution Order

1. **First**: Add `@mks2508/no-throw`, `chalk`, `ora`, `@inquirer/prompts`, `cli-table3`, `boxen`, `figures` deps
2. **Second**: Create `src/logger.ts` — internal logger wrapping chalk+ora+boxen (future better-logger v5 drop-in)
3. **Third**: Create `src/types/` directory with properly named interfaces (IFileChange, etc.)
4. **Fourth**: Split `src/providers.ts` into `src/providers/` directory with one file per provider
5. **Fifth**: Refactor `CommitGenerator` to accept programmatic options (SDK-first)
6. **Sixth**: Refactor `CommitUI` — replace osascript/zenity with @inquirer/prompts, use CommitGenerator directly
7. **Seventh**: Replace ALL console.* with `log.*` from `src/logger.ts`
8. **Eighth**: Add animated step-by-step flow (spinners, timing, tables, boxes)
9. **Ninth**: Wrap ALL fallible operations with Result pattern
10. **Tenth**: Add complete JSDoc to all exports
11. **Eleventh**: Create `src/index.ts` barrel export
12. **Twelfth**: Add `--dry-run`, `--json`, `--verbose`/`--quiet` CLI flags
13. **Thirteenth**: Update README.md and CLAUDE.md with SDK usage examples + CLI screenshots
14. **Fourteenth**: Bump version to 2.0.0, publish

## Important Notes

- Runtime is **Bun** (not Node.js) — use Bun APIs where appropriate
- Keep the `if (import.meta.main)` pattern for CLI entry points
- The `.commit-wizard.json` config system works well — keep it
- The prompt templates and response parser work well — keep the core logic, just fix compliance
- Do NOT add tests yet (testing infrastructure doesn't exist in this project)
- Do NOT add build step — Bun runs .ts files directly
- **DO NOT use `@mks2508/better-logger` v4** — it's being rewritten. Use the internal `src/logger.ts` wrapper
- The `src/logger.ts` interface is designed as a **future drop-in target** for `@mks2508/better-logger` v5
- Author: MKS2508. Never mention AI assistance in code or commits
