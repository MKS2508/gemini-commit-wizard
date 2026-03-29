# Plan A: gemini-commit-wizard v2.0 Upgrade

## Current State Assessment

- **Version**: 1.1.3 (CLI-only, no SDK API)
- **Source files**: 9 files in flat `src/` (~4,962 lines total)
- **Violations found**:
  - ~180+ `console.log/warn/error` statements across 6 files
  - 0 uses of `Result<T,E>` pattern (all raw try/catch + thrown exceptions)
  - ~17 interfaces missing `I` prefix
  - ~150+ exported symbols missing JSDoc
  - No barrel exports anywhere
  - CLI-coupled classes (read `process.argv` in constructors)
  - `commit-ui.ts` shells out via `execSync` to `commit-generator.ts` instead of importing it
  - Platform-specific UI hacks (osascript, zenity) instead of proper terminal prompts

---

## Phase 1: Foundation (Dependencies + Logger + Types)

### Step 1.1 - Install Dependencies

```bash
bun add @mks2508/no-throw@^0.1.0
bun add chalk@^5.4.0
bun add ora@^8.0.0
bun add @inquirer/prompts@^7
bun add cli-table3@^0.6.5
bun add boxen@^8.0.0
bun add figures@^6.1.0
```

Add `@types/cli-table3` if needed as devDep.

### Step 1.2 - Create `src/logger.ts`

Internal logger wrapping chalk + ora + boxen. Designed as future drop-in target for `@mks2508/better-logger` v5.

**Interface** (from HANDOFF-PROMPT):

```typescript
export type LogLevel = 'silent' | 'quiet' | 'normal' | 'verbose' | 'debug';

export interface ISpinnerHandle {
  start(): void;
  stop(): void;
  succeed(msg?: string): void;
  fail(msg?: string): void;
  text(msg: string): void;
}

export interface IBoxOptions {
  title?: string;
  borderColor?: string;
  borderStyle?: string;
  padding?: number;
}

export interface IWizardLogger {
  info(msg: string, ...args: unknown[]): void;
  success(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  step(current: number, total: number, msg: string): void;
  spinner(msg: string): ISpinnerHandle;
  table(rows: Record<string, unknown>[]): void;
  box(content: string, options?: IBoxOptions): void;
  header(title: string, subtitle?: string): void;
  divider(): void;
  blank(): void;
  time(label: string): void;
  timeEnd(label: string): number;
  setLevel(level: LogLevel): void;
  readonly level: LogLevel;
}
```

**Implementation**: chalk for colors, ora for spinners, boxen for boxes, cli-table3 for tables. Level filtering gates all output. `silent` suppresses everything (SDK usage). `quiet` only shows errors/warnings. Export singleton `log`.

### Step 1.3 - Create `src/types/` Directory

Extract and rename all interfaces with `I` prefix:

| File | Current | New Location | New Name |
|------|---------|-------------|----------|
| `commit-generator.ts` | `FileChange` | `src/types/commit.types.ts` | `IFileChange` |
| `commit-generator.ts` | `GitStats` | `src/types/commit.types.ts` | `IGitStats` |
| `commit-generator.ts` | `CommitAnalysis` | `src/types/commit.types.ts` | `ICommitAnalysis` |
| `commit-generator.ts` | `CommitProposal` | `src/types/commit.types.ts` | `ICommitProposal` |
| `commit-ui.ts` | `CommitOptions` | `src/types/commit.types.ts` | `ICommitOptions` |
| `prompt-templates.ts` | `GeminiPromptConfig` | `src/types/prompt.types.ts` | `IGeminiPromptConfig` |
| `prompt-templates.ts` | `StandardResponseFormat` | `src/types/prompt.types.ts` | `IStandardResponseFormat` |
| `version-manager.ts` | `ChangelogEntry` | `src/types/version.types.ts` | `IChangelogEntry` |
| `version-manager.ts` | `Version` | `src/types/version.types.ts` | `IVersion` |
| `version-manager.ts` | `ChangelogData` | `src/types/version.types.ts` | `IChangelogData` |
| `version-manager.ts` | `CommitInfo` | `src/types/version.types.ts` | `ICommitInfo` |
| `git-utils.ts` | `GitFileStatus` | `src/types/git.types.ts` | `IGitFileStatus` |
| `git-utils.ts` | `CommitInfo` | `src/types/git.types.ts` | `IGitCommitInfo` (avoid clash) |
| `github-release-manager.ts` | `ReleaseInfo` | `src/types/release.types.ts` | `IReleaseInfo` |
| `github-release-manager.ts` | `ChangelogEntry` | reuse `IChangelogEntry` from version.types |
| `github-release-manager.ts` | `VersionData` | `src/types/release.types.ts` | `IVersionData` |
| `auto-release-gemini.ts` | `ChangelogData` | reuse `IChangelogData` from version.types |
| `auto-release-gemini.ts` | `ReleaseInfo` | reuse `IReleaseInfo` from release.types |

Also add SDK-specific types:

- `src/types/sdk.types.ts`: `ICommitGeneratorOptions`, `ICommitResult`, `CommitErrorCode` type union
- `src/types/provider.types.ts`: `IAIProvider` (moved from providers.ts), `ProviderName`
- `src/types/config.types.ts`: `IProjectConfig`, `IProjectComponent`, `ICommitFormat` (already have `I` prefix, just move)

Create `src/types/index.ts` barrel export:

```typescript
export * from './commit.types';
export * from './config.types';
export * from './provider.types';
export * from './prompt.types';
export * from './version.types';
export * from './git.types';
export * from './release.types';
export * from './sdk.types';
```

---

## Phase 2: Provider Refactor

### Step 2.1 - Split `src/providers.ts` into `src/providers/`

Current `providers.ts` (312 lines) contains 4 provider classes + factory + listing. Split into:

```
src/providers/
├── index.ts              # Barrel + createProvider() + listProviders()
├── base.ts               # IAIProvider import from types (if needed for shared logic)
├── gemini-sdk.ts          # GeminiSdkProvider
├── gemini-cli.ts          # GeminiCliProvider
├── groq.ts                # GroqProvider
└── openrouter.ts          # OpenRouterProvider
```

Each provider file:
- Import `IAIProvider` from `../types`
- Import `log` from `../logger`
- Wrap `generate()` with `tryCatchAsync()` returning `Result<string, ResultError<'PROVIDER_ERROR'>>`
- Wrap `isAvailable()` with Result pattern
- Add complete JSDoc to class and all methods

`src/providers/index.ts`:
- Re-export all providers
- Export `createProvider()` factory
- Export `listProviders()` function
- Export types from `../types/provider.types`

### Step 2.2 - Result Pattern in Providers

Every provider method that can fail:

```typescript
// generate() -> Result<string, ResultError<'PROVIDER_ERROR'>>
// isAvailable() -> Result<boolean, ResultError<'PROVIDER_CHECK_ERROR'>>
```

---

## Phase 3: Core Engine Refactor (CommitGenerator)

### Step 3.1 - SDK-First CommitGenerator

Refactor `commit-generator.ts` (798 lines) to accept programmatic options:

**Constructor changes**:
- Accept `ICommitGeneratorOptions` parameter
- Remove ALL `process.argv` reading from constructor and methods
- Store options as instance property

**New public API**:

```typescript
export class CommitGenerator {
  constructor(options?: ICommitGeneratorOptions);
  async analyze(): Promise<Result<ICommitProposal[], ResultError<CommitErrorCode>>>;
  async generate(): Promise<Result<ICommitResult, ResultError<CommitErrorCode>>>;
  getProvider(): IAIProvider;
  getConfig(): IProjectConfig;
}
```

**Internal method changes**:
- All `console.log` -> `log.*` from logger
- All try/catch -> `tryCatchAsync()` / `Result`
- All git operations (`Bun.spawnSync(['git',...])`) wrapped in Result
- `stageAllChanges()`, `getGitDiff()`, `getGitStatus()`, `executeCommit()` all return Result

### Step 3.2 - CLI Entry Point

Keep `if (import.meta.main)` block at bottom of file. This becomes a thin wrapper:

```typescript
if (import.meta.main) {
  const options = parseCliArgs(process.argv); // extract to helper
  const generator = new CommitGenerator(options);

  if (options.listProviders) {
    showProviderTable(); // formatted table with cli-table3
    process.exit(0);
  }

  const result = await generator.generate();
  if (isErr(result)) {
    log.error(result.error.message);
    process.exit(1);
  }
}
```

### Step 3.3 - Animated Step-by-Step Flow

Replace raw console output with the spinner/step pattern from HANDOFF-PROMPT:
1. Stage changes (spinner)
2. Analyze repository (spinner)
3. AI processing (spinner + timing)
4. Parse proposals (table output)
5. Execute commits (per-commit spinner)
6. Final summary (boxen)

---

## Phase 4: CommitUI Overhaul

### Step 4.1 - Replace Platform Hacks with @inquirer/prompts

Current `commit-ui.ts` (255 lines) uses:
- macOS: `osascript -l JavaScript` (AppleScript) for dialogs
- Linux: `zenity` for dialogs
- Fallback: `readline` for terminal input

**Replace ALL with `@inquirer/prompts`**:
- `input()` for text input (context description)
- `select()` for single choice (work type)
- `checkbox()` for multi-choice (affected components)
- `confirm()` for proceed/cancel

### Step 4.2 - Use CommitGenerator Directly

Current `generateCommit()` uses `execSync('bun src/commit-generator.ts ...')`. Replace with:

```typescript
import { CommitGenerator } from './commit-generator';

async run(): Promise<Result<void, ResultError<CommitErrorCode>>> {
  const options = await this.collectCommitInfo();
  const generator = new CommitGenerator({
    ...this.baseOptions,
    context: options.context,
    workType: options.workType,
    affectedComponents: options.affectedComponents.join(','),
    autoApprove: true,
  });
  return generator.generate();
}
```

### Step 4.3 - Summary Box Before Generation

Show a `boxen` summary of collected info before calling AI:
- Context, work type, components, provider/model
- Confirm prompt before proceeding

---

## Phase 5: Replace All console.* with log.*

### Files to Update (by violation count)

| File | ~Violations | Priority |
|------|------------|----------|
| `commit-generator.ts` | 50+ | HIGH |
| `auto-release-gemini.ts` | 50+ | HIGH |
| `version-manager.ts` | 40+ | HIGH |
| `github-release-manager.ts` | 20+ | MEDIUM |
| `commit-ui.ts` | 10 | MEDIUM |
| `project-config.ts` | 7 | LOW |

**Mapping**:
- `console.log('...')` -> `log.info('...')`
- `console.log(chalk.green('...'))` -> `log.success('...')`
- `console.error('...')` -> `log.error('...')`
- `console.warn('...')` -> `log.warn('...')`
- Step indicators (`[1/5]`, `Step N:`) -> `log.step(n, total, msg)`
- Loading states -> `log.spinner(msg)`

---

## Phase 6: Result Pattern Everywhere

### Files to Refactor

Every file that has try/catch needs Result wrapping:

| File | try/catch blocks | Direct throws |
|------|-----------------|---------------|
| `commit-generator.ts` | ~8 | 2 |
| `auto-release-gemini.ts` | ~10 | 9 |
| `version-manager.ts` | ~5 | 2 |
| `github-release-manager.ts` | ~7 | 2 |
| `commit-ui.ts` | ~3 | 0 |
| `project-config.ts` | ~2 | 0 |
| `providers/*.ts` | ~4 | 4 |

**Error code taxonomy**:

```typescript
export type CommitErrorCode =
  | 'GIT_ERROR'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_CHECK_ERROR'
  | 'PARSE_ERROR'
  | 'CONFIG_ERROR'
  | 'STAGING_ERROR'
  | 'COMMIT_EXEC_ERROR';

export type VersionErrorCode =
  | 'GIT_ERROR'
  | 'VERSION_PARSE_ERROR'
  | 'CHANGELOG_ERROR'
  | 'FILE_WRITE_ERROR';

export type ReleaseErrorCode =
  | 'GIT_ERROR'
  | 'BUILD_ERROR'
  | 'GITHUB_ERROR'
  | 'PROVIDER_ERROR';
```

---

## Phase 7: JSDoc on All Exports

### Scope

Every exported symbol needs full JSDoc with:
- Description
- `@param` for each parameter
- `@returns` with Result type explanation
- `@example` code block
- `@throws` if applicable (should be none after Result refactor)

**Estimated count**: ~150 exported symbols across all files.

Priority order:
1. `src/types/**/*.ts` - All interfaces and types
2. `src/providers/**/*.ts` - Provider classes and factory
3. `src/commit-generator.ts` - Core engine class
4. `src/commit-ui.ts` - UI class
5. `src/logger.ts` - Logger interface and class
6. `src/prompt-templates.ts` - Prompt functions and parser
7. `src/project-config.ts` - Config loader
8. `src/git-utils.ts` - Utility functions
9. `src/version-manager.ts` - Version manager
10. `src/github-release-manager.ts` - Release manager
11. `src/auto-release-gemini.ts` - Auto-release

---

## Phase 8: Barrel Export + SDK Entry Point

### Step 8.1 - Create `src/index.ts`

```typescript
// Core classes
export { CommitGenerator } from './commit-generator';
export { CommitUI } from './commit-ui';

// Providers
export {
  createProvider,
  listProviders,
  GeminiSdkProvider,
  GroqProvider,
  OpenRouterProvider,
  GeminiCliProvider,
} from './providers';

// Config
export { loadProjectConfig } from './project-config';

// Prompt system
export {
  createCommitPrompt,
  createWorkflowPrompt,
  createReleasePrompt,
  GeminiResponseParser,
} from './prompt-templates';

// Logger (for consumers who want to integrate)
export { log } from './logger';

// All types
export type * from './types';
```

### Step 8.2 - Update `package.json` Exports

```json
{
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./providers": "./src/providers/index.ts",
    "./config": "./src/project-config.ts",
    "./prompts": "./src/prompt-templates.ts",
    "./logger": "./src/logger.ts",
    "./types": "./src/types/index.ts"
  }
}
```

---

## Phase 9: CLI Flags + Polish

### New CLI Flags

- `--dry-run` - Analyze and show proposals without executing commits
- `--json` - Output proposals as JSON (for piping/scripting)
- `--verbose` / `-v` - Show debug-level output
- `--quiet` / `-q` - Only show errors and final result
- `--silent` - No output at all (SDK mode)

### ASCII Header

```typescript
function showHeader(): void {
  if (log.level === 'quiet' || log.level === 'silent') return;
  log.header('Commit Wizard', 'v' + version);
}
```

### Provider Status Table (--list-providers)

Formatted table with cli-table3 + figures for tick/cross marks.

---

## Phase 10: Final File Structure

```
gemini-commit-wizard/
├── src/
│   ├── index.ts                  # SDK barrel export
│   ├── logger.ts                 # Internal logger (future better-logger v5 drop-in)
│   ├── types/
│   │   ├── index.ts              # Barrel export
│   │   ├── commit.types.ts       # IFileChange, IGitStats, ICommitAnalysis, ICommitProposal, ICommitOptions
│   │   ├── config.types.ts       # IProjectConfig, IProjectComponent, ICommitFormat
│   │   ├── provider.types.ts     # IAIProvider, ProviderName
│   │   ├── prompt.types.ts       # IGeminiPromptConfig, IStandardResponseFormat
│   │   ├── sdk.types.ts          # ICommitGeneratorOptions, ICommitResult, CommitErrorCode
│   │   ├── version.types.ts      # IChangelogEntry, IVersion, IChangelogData, ICommitInfo
│   │   ├── git.types.ts          # IGitFileStatus, IGitCommitInfo
│   │   └── release.types.ts      # IReleaseInfo, IVersionData, ReleaseErrorCode
│   ├── providers/
│   │   ├── index.ts              # Barrel + factory + listProviders
│   │   ├── gemini-sdk.ts         # GeminiSdkProvider
│   │   ├── gemini-cli.ts         # GeminiCliProvider
│   │   ├── groq.ts               # GroqProvider
│   │   └── openrouter.ts         # OpenRouterProvider
│   ├── commit-generator.ts       # Core engine (SDK-first, options-based)
│   ├── commit-ui.ts              # Interactive UI (@inquirer/prompts, uses CommitGenerator directly)
│   ├── project-config.ts         # Config loader
│   ├── prompt-templates.ts       # Prompt construction + response parser
│   ├── git-utils.ts              # Git utility functions
│   ├── version-manager.ts        # Semantic versioning
│   ├── github-release-manager.ts # GitHub releases
│   └── auto-release-gemini.ts    # Auto-release pipeline
├── package.json
├── CLAUDE.md
└── README.md
```

---

## Execution Order Summary

| # | Phase | Key Deliverable | Estimated Scope |
|---|-------|----------------|----------------|
| 1 | Dependencies | Install 7 packages | 1 command |
| 2 | Logger | `src/logger.ts` (~200 lines) | 1 new file |
| 3 | Types | `src/types/` directory (8 type files + barrel) | 9 new files |
| 4 | Providers | Split into `src/providers/` (5 files) | 5 new files, delete 1 |
| 5 | CommitGenerator | SDK-first refactor + Result + logger | 1 file rewrite (~800 lines) |
| 6 | CommitUI | @inquirer/prompts + direct import | 1 file rewrite (~300 lines) |
| 7 | Console replacement | All remaining files | 5 files modified |
| 8 | Result pattern | All remaining files | 5 files modified |
| 9 | JSDoc | All exports | All files touched |
| 10 | Barrel export | `src/index.ts` + package.json exports | 2 files |
| 11 | CLI flags | `--dry-run`, `--json`, `--verbose`, `--quiet` | 1 file modified |
| 12 | Polish | Header, provider table, summary boxes | Minor touches |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking existing CLI behavior | Users' scripts break | Keep same `process.argv` flags, just refactor internals |
| `@mks2508/no-throw` API mismatch | Build errors | Pin to `^0.1.0`, test Result wrapping on first file before proceeding |
| ESM-only deps (chalk, ora, boxen, figures) | Import issues in Bun | Bun handles ESM natively, should be fine |
| Large refactor scope | Incomplete migration | Phase-by-phase approach, each phase independently testable |
| osascript/zenity removal | Users who prefer native dialogs | @inquirer/prompts works better everywhere, no loss |

---

## NOT in Scope (Explicit Exclusions)

- No tests (testing infra doesn't exist yet)
- No build step (Bun runs .ts directly)
- No `@mks2508/better-logger` v4 usage
- No new AI providers
- No changes to prompt templates logic (only compliance fixes)
- No changes to `.commit-wizard.json` config format
