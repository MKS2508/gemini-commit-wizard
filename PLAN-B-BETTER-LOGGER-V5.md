# Plan B: @mks2508/better-logger v5.0 Rewrite

## Current State Assessment

- **Package**: `@mks2508/better-logger`
- **Current version**: `0.17.0-alpha.1` (v4.0.0 alpha track)
- **Repository**: `/Volumes/KODAK1TB/REPOS y PROYECTOS/nodejs/advanced-logger/`
- **Source code**: ~11,937 lines across 50+ TypeScript files
- **Build**: Vite 7.1.2 + vite-plugin-dts, outputs ESM + CJS + UMD
- **Only dependency**: chalk@5.6.2
- **Architecture**: Logger singleton + ScopedLogger delegation + Enterprise features (serializers, hooks, transports)

### What v4 Already Has (Keep)

| Feature | Location | Status |
|---------|----------|--------|
| Core logging (debug/info/warn/error/success/critical/trace) | `Logger.ts` | Solid |
| ScopedLogger delegation (50-100x memory savings) | `ScopedLogger.ts` | Solid |
| ComponentLogger / APILogger | `ScopedLogger.ts` | Solid |
| Custom serializers with priority | `serializers/` | Solid |
| Hooks & middleware | `hooks/` | Solid |
| Transport system (console/file/HTTP) | `transports/` | Solid |
| Smart presets (cyberpunk, glassmorphism, minimal, etc.) | `styling/` | Solid |
| Theme system (CSS + ANSI) | `styling/` | Solid |
| Badge system | `Logger.ts` | Solid |
| Environment detection (browser/terminal/CI) | `utils/` | Solid |
| Dual rendering (CSS for browser, ANSI for terminal) | `terminal/` | Solid |
| OutputWriter / BufferWriter | `writers/` | v4 alpha, needs polish |
| `time()` / `timeEnd()` | `Logger.ts` | Solid |
| `table()`, `group()`, `groupEnd()` | `Logger.ts` | Solid |
| Modular builds (core/styling/exports) | `packages/` | Solid |

### What v4 Lacks (v5 Goals)

| Missing Feature | Why It's Needed |
|----------------|----------------|
| **CLI-mode primitives** (spinners, step progress, boxes) | gemini-commit-wizard, any CLI tool |
| **Interactive prompts** (input, select, checkbox, confirm) | CLI workflows need user input |
| **Server-mode structured logging** (JSON lines, pino-compatible) | Production Node.js/Bun servers |
| **Automatic CLI vs Server detection** | Same `import logger` works in both contexts |
| **Verbosity levels mapping to CLI quietness** | `--quiet`, `--verbose`, `--silent` flags |
| **Step-by-step animation primitives** | Multi-phase workflows (build, deploy, commit) |
| **ANSI art / boxed output** | Headers, summaries, branding |
| **Drop-in replacement for ora + boxen + cli-table3** | Reduce dependency count for consumers |

---

## v5 Architecture Vision

### Core Principle: Two Modes, One API

```
@mks2508/better-logger v5
├── CLI Mode (auto-detected when TTY)
│   ├── Colored output (chalk)
│   ├── Spinners (ora-like, built-in)
│   ├── Progress steps
│   ├── Boxed output
│   ├── Tables
│   ├── Interactive prompts (inquirer-like)
│   └── Verbosity levels (silent/quiet/normal/verbose/debug)
│
├── Server Mode (auto-detected when !TTY or explicit)
│   ├── JSON structured logs (pino-compatible)
│   ├── Transports (file, HTTP, custom)
│   ├── Correlation IDs
│   ├── Request context
│   └── Log levels (trace/debug/info/warn/error/fatal)
│
└── Shared
    ├── Serializers
    ├── Hooks & middleware
    ├── Badges
    ├── Scoped loggers (delegation)
    └── TypeScript types
```

---

## Phase 1: Clean Foundation

### Step 1.1 - Audit & Prune v4 Code

The current `Logger.ts` is 1,654 lines. Too much is in one file. Before adding features, restructure:

**Current monolith** (`Logger.ts` 1654 lines):
- Core logging methods
- Badge management
- Theme/preset management
- Timer management
- Group management
- Table/animated/SVG methods
- CLI command processing
- Serializer integration
- Hook integration
- Transport integration
- Output formatting
- Configuration

**Split into**:

```
src/
├── core/
│   ├── Logger.ts              # Core class: log methods, level management (~300 lines)
│   ├── ScopedLogger.ts        # Delegation-based child loggers (keep)
│   ├── LogEntry.ts            # Log entry creation & formatting
│   └── index.ts               # Barrel
├── cli/
│   ├── CLIRenderer.ts         # ANSI output rendering for terminal
│   ├── SpinnerManager.ts      # Built-in ora-like spinners
│   ├── StepTracker.ts         # Step progress (step 1/5, step 2/5...)
│   ├── BoxRenderer.ts         # boxen-like framed output
│   ├── TableRenderer.ts       # cli-table3-like tables
│   ├── PromptManager.ts       # inquirer-like interactive prompts
│   ├── HeaderRenderer.ts      # ASCII art headers / branding
│   └── index.ts               # Barrel
├── server/
│   ├── ServerRenderer.ts      # JSON structured output
│   ├── CorrelationManager.ts  # Request correlation IDs
│   └── index.ts               # Barrel
├── enterprise/
│   ├── serializers/           # (keep existing)
│   ├── hooks/                 # (keep existing)
│   ├── transports/            # (keep existing)
│   └── index.ts               # Barrel
├── styling/                   # (keep existing themes/presets)
├── terminal/                  # (keep existing ANSI rendering)
├── utils/                     # (keep existing utilities)
├── types/
│   ├── index.ts               # All type exports
│   ├── core.types.ts          # LogLevel, Verbosity, LogEntry, etc.
│   ├── cli.types.ts           # ISpinnerHandle, IBoxOptions, IStepOptions, IPromptOptions
│   ├── server.types.ts        # IServerLogEntry, ICorrelationContext
│   └── enterprise.types.ts    # Serializer, Hook, Transport types
├── writers/                   # (keep existing OutputWriter)
└── index.ts                   # Main entry point
```

### Step 1.2 - Define the Target Public API

This is the API that both `@mks2508/better-logger` v5 and gemini-commit-wizard's `src/logger.ts` will share:

```typescript
// ============================================
// Core logging (exists in v4, keep as-is)
// ============================================
logger.debug(msg, ...args)
logger.info(msg, ...args)
logger.warn(msg, ...args)
logger.error(msg, ...args)
logger.success(msg, ...args)
logger.critical(msg, ...args)
logger.trace(msg, ...args)

// ============================================
// Scoped loggers (exists in v4, keep as-is)
// ============================================
logger.component(name)    // -> ComponentLogger
logger.api(name)          // -> APILogger
logger.scope(name)        // -> ScopedLogger

// ============================================
// CLI-mode primitives (NEW in v5)
// ============================================

// Step progress
logger.step(current: number, total: number, msg: string): void
// Output: "  [2/5] Analyzing repository..."
// Supports colors: step number in cyan, msg in default

// Spinners (replaces ora dependency for consumers)
logger.spinner(msg: string): ISpinnerHandle
// ISpinnerHandle: { start(), stop(), succeed(msg?), fail(msg?), text(msg) }

// Boxed output (replaces boxen dependency for consumers)
logger.box(content: string, options?: IBoxOptions): void
// IBoxOptions: { title?, borderColor?, borderStyle?, padding? }

// Tables (replaces cli-table3 dependency for consumers)
logger.table(rows: Record<string, unknown>[], options?: ITableOptions): void
// ITableOptions: { columns?, head?, style? }

// Header / branding
logger.header(title: string, subtitle?: string): void
// Output: "  Commit Wizard v2.0.0\n  AI-powered commit generation\n"

// Divider
logger.divider(): void
// Output: "  ─────────────────────────────"

// Blank line
logger.blank(): void

// ============================================
// Interactive prompts (NEW in v5)
// ============================================
logger.prompt.input(options: IInputOptions): Promise<string>
logger.prompt.select(options: ISelectOptions): Promise<string>
logger.prompt.checkbox(options: ICheckboxOptions): Promise<string[]>
logger.prompt.confirm(options: IConfirmOptions): Promise<boolean>

// ============================================
// Timing (exists in v4, keep as-is)
// ============================================
logger.time(label: string): void
logger.timeEnd(label: string): number  // returns elapsed ms

// ============================================
// Configuration
// ============================================
logger.setLevel(level: LogLevel): void
// LogLevel: 'silent' | 'quiet' | 'normal' | 'verbose' | 'debug'
// Mapping: silent=nothing, quiet=error+warn, normal=info+warn+error+success,
//          verbose=normal+step+spinner, debug=everything

logger.setMode(mode: 'cli' | 'server' | 'auto'): void
// auto (default): TTY -> cli, !TTY -> server

logger.setOutputFormat(format: 'pretty' | 'json'): void
// pretty (default in CLI mode): colored human-readable
// json (default in server mode): structured JSON lines

// ============================================
// Enterprise (exists in v4, keep as-is)
// ============================================
logger.addSerializer(type, fn, priority?)
logger.on(event, callback, priority?)
logger.use(middleware, priority?)
logger.addTransport(target)
logger.flushTransports()
logger.closeTransports()
```

### Step 1.3 - Maintain Backward Compatibility

v5 MUST NOT break v4 consumers. Strategy:

- All v4 methods stay (same signatures)
- New methods are purely additive
- `setVerbosity()` (v4) maps to `setLevel()` (v5) internally
- Smart presets still work
- Theme system still works
- Default behavior unchanged (if TTY -> colored output, if !TTY -> structured)

---

## Phase 2: CLI Primitives Implementation

### Step 2.1 - SpinnerManager

Built-in spinner that doesn't require `ora` as external dependency.

```typescript
// src/cli/SpinnerManager.ts

export class SpinnerManager {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: Timer | null = null;
  private frameIndex = 0;
  private currentText: string;

  constructor(text: string) { this.currentText = text; }

  start(): void {
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      process.stderr.write(`\r${chalk.cyan(frame)} ${this.currentText}`);
      this.frameIndex++;
    }, 80);
  }

  succeed(msg?: string): void {
    this.stop();
    process.stderr.write(`\r${chalk.green(figures.tick)} ${msg || this.currentText}\n`);
  }

  fail(msg?: string): void {
    this.stop();
    process.stderr.write(`\r${chalk.red(figures.cross)} ${msg || this.currentText}\n`);
  }

  text(msg: string): void { this.currentText = msg; }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    process.stderr.write('\r\x1B[K'); // clear line
  }
}
```

Key decisions:
- Write to `stderr` (not stdout) so spinners don't pollute piped output
- Use `figures` for cross-platform tick/cross symbols
- 80ms frame interval (same as ora default)
- Use Braille spinner pattern (same as ora default)

### Step 2.2 - StepTracker

```typescript
// src/cli/StepTracker.ts

export class StepTracker {
  render(current: number, total: number, msg: string): void {
    const stepLabel = chalk.cyan(`[${current}/${total}]`);
    console.log(`  ${stepLabel} ${msg}`);
  }
}
```

### Step 2.3 - BoxRenderer

Replaces `boxen` dependency. Renders bordered boxes in terminal:

```typescript
// src/cli/BoxRenderer.ts

export class BoxRenderer {
  render(content: string, options?: IBoxOptions): void {
    const { title, borderColor = 'white', padding = 1 } = options || {};
    const lines = content.split('\n');
    const maxWidth = Math.max(...lines.map(l => stripAnsi(l).length), (title?.length || 0) + 4);
    const width = maxWidth + padding * 2;

    const colorFn = chalk[borderColor] || chalk.white;
    const top = title
      ? `${colorFn('╭─')} ${title} ${colorFn('─'.repeat(width - title.length - 3) + '╮')}`
      : colorFn(`╭${'─'.repeat(width)}╮`);
    const bottom = colorFn(`╰${'─'.repeat(width)}╯`);
    const pad = ' '.repeat(padding);

    console.log(top);
    for (const line of lines) {
      const stripped = stripAnsi(line);
      const rightPad = ' '.repeat(maxWidth - stripped.length);
      console.log(`${colorFn('│')}${pad}${line}${rightPad}${pad}${colorFn('│')}`);
    }
    console.log(bottom);
  }
}
```

### Step 2.4 - TableRenderer

Replaces `cli-table3`. Simple table rendering:

```typescript
// src/cli/TableRenderer.ts

export class TableRenderer {
  render(rows: Record<string, unknown>[], options?: ITableOptions): void {
    if (rows.length === 0) return;
    const columns = options?.columns || Object.keys(rows[0]);
    const widths = columns.map(col =>
      Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length))
    );

    // Header
    const header = columns.map((col, i) => chalk.cyan(col.padEnd(widths[i]))).join('  ');
    console.log(`  ${header}`);
    console.log(`  ${widths.map(w => '─'.repeat(w)).join('──')}`);

    // Rows
    for (const row of rows) {
      const line = columns.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join('  ');
      console.log(`  ${line}`);
    }
  }
}
```

### Step 2.5 - HeaderRenderer

```typescript
// src/cli/HeaderRenderer.ts

export class HeaderRenderer {
  render(title: string, subtitle?: string): void {
    console.log(`  ${chalk.bold(title)}${subtitle ? chalk.dim(` ${subtitle}`) : ''}`);
    if (subtitle) console.log();
  }
}
```

---

## Phase 3: Interactive Prompts

### Step 3.1 - PromptManager

Built-in prompts that replace `@inquirer/prompts` dependency for consumers.

**Decision**: For v5.0, bundle `@inquirer/prompts` internally and re-export through the logger API. In v5.1+, consider a custom implementation to reduce bundle size.

**Why**: Building a full readline-based prompt system from scratch is a large effort. For v5.0, wrapping @inquirer/prompts is pragmatic and still gives consumers a unified API through the logger.

```typescript
// src/cli/PromptManager.ts

import { input, select, checkbox, confirm } from '@inquirer/prompts';

export class PromptManager {
  async input(options: IInputOptions): Promise<string> {
    return input({
      message: options.message,
      default: options.default,
      validate: options.validate,
    });
  }

  async select<T extends string>(options: ISelectOptions<T>): Promise<T> {
    return select({
      message: options.message,
      choices: options.choices,
    });
  }

  async checkbox<T extends string>(options: ICheckboxOptions<T>): Promise<T[]> {
    return checkbox({
      message: options.message,
      choices: options.choices,
    });
  }

  async confirm(options: IConfirmOptions): Promise<boolean> {
    return confirm({
      message: options.message,
      default: options.default ?? true,
    });
  }
}
```

### Step 3.2 - Prompt Types

```typescript
// src/types/cli.types.ts

export interface IInputOptions {
  message: string;
  default?: string;
  validate?: (value: string) => boolean | string;
}

export interface ISelectChoice<T extends string = string> {
  value: T;
  name: string;
  description?: string;
}

export interface ISelectOptions<T extends string = string> {
  message: string;
  choices: ISelectChoice<T>[];
}

export interface ICheckboxOptions<T extends string = string> {
  message: string;
  choices: ISelectChoice<T>[];
}

export interface IConfirmOptions {
  message: string;
  default?: boolean;
}
```

---

## Phase 4: Server Mode

### Step 4.1 - ServerRenderer

JSON structured output for production environments:

```typescript
// src/server/ServerRenderer.ts

export class ServerRenderer {
  render(entry: ILogEntry): void {
    const structured = {
      level: entry.level,
      msg: entry.message,
      time: Date.now(),
      ...(entry.scope && { scope: entry.scope }),
      ...(entry.badges?.length && { badges: entry.badges }),
      ...(entry.correlationId && { correlationId: entry.correlationId }),
      ...(entry.args?.length && { data: entry.args }),
    };
    process.stdout.write(JSON.stringify(structured) + '\n');
  }
}
```

**Format**: JSON lines (one JSON object per line), compatible with pino consumers (fluentd, datadog, etc.)

### Step 4.2 - Mode Auto-Detection

```typescript
// src/core/ModeDetector.ts

export function detectMode(): 'cli' | 'server' {
  // Explicit override
  if (process.env.LOGGER_MODE === 'cli') return 'cli';
  if (process.env.LOGGER_MODE === 'server') return 'server';

  // CI/CD -> server
  if (process.env.CI || process.env.GITHUB_ACTIONS) return 'server';

  // TTY -> cli
  if (process.stdout.isTTY) return 'cli';

  // Piped output -> server
  return 'server';
}
```

### Step 4.3 - Mode-Aware Logger Methods

When in server mode:
- `logger.spinner()` -> no-op (returns dummy handle that just logs start/succeed/fail as info)
- `logger.box()` -> logs content as info
- `logger.table()` -> logs rows as JSON
- `logger.step()` -> logs as info with step metadata
- `logger.header()` -> logs as info
- `logger.prompt.*()` -> throws error ("Prompts not available in server mode")

This ensures the same code works in both modes without crashes.

---

## Phase 5: Verbosity / Level System

### Level Mapping

| Level | CLI Output | Server Output |
|-------|-----------|---------------|
| `silent` | Nothing | Nothing |
| `quiet` | error, warn | error, warn |
| `normal` | error, warn, info, success | error, warn, info |
| `verbose` | normal + step, spinner text | normal + debug |
| `debug` | everything | everything |

### Integration with CLI Flags

Consumers can set level from their CLI flags:

```typescript
// In gemini-commit-wizard
import logger from '@mks2508/better-logger';

if (args.includes('--quiet')) logger.setLevel('quiet');
if (args.includes('--verbose')) logger.setLevel('verbose');
if (args.includes('--silent')) logger.setLevel('silent');
if (args.includes('--debug')) logger.setLevel('debug');
```

### Backward Compatibility

```typescript
// v4 method (keep working)
logger.setVerbosity('debug');  // maps to setLevel('debug')
logger.setVerbosity('info');   // maps to setLevel('normal')
logger.setVerbosity('warn');   // maps to setLevel('quiet')
logger.setVerbosity('error');  // maps to setLevel('quiet')
logger.setVerbosity('silent'); // maps to setLevel('silent')
```

---

## Phase 6: Integration with Logger.ts Core

### Step 6.1 - Integrate CLI Primitives into Logger Class

```typescript
// src/core/Logger.ts

import { SpinnerManager } from '../cli/SpinnerManager';
import { StepTracker } from '../cli/StepTracker';
import { BoxRenderer } from '../cli/BoxRenderer';
import { TableRenderer } from '../cli/TableRenderer';
import { HeaderRenderer } from '../cli/HeaderRenderer';
import { PromptManager } from '../cli/PromptManager';
import { ServerRenderer } from '../server/ServerRenderer';
import { detectMode } from './ModeDetector';

class Logger {
  private mode: 'cli' | 'server';
  private _level: LogLevel = 'normal';

  // CLI renderers
  private stepTracker = new StepTracker();
  private boxRenderer = new BoxRenderer();
  private tableRenderer = new TableRenderer();
  private headerRenderer = new HeaderRenderer();
  private _prompt = new PromptManager();

  // Server renderer
  private serverRenderer = new ServerRenderer();

  constructor() {
    this.mode = detectMode();
  }

  // --- NEW v5 methods ---

  get level(): LogLevel { return this._level; }

  setLevel(level: LogLevel): void { this._level = level; }

  step(current: number, total: number, msg: string): void {
    if (!this.shouldLog('verbose')) return;
    if (this.mode === 'cli') {
      this.stepTracker.render(current, total, msg);
    } else {
      this.serverRenderer.render({ level: 'info', message: msg, meta: { step: current, totalSteps: total } });
    }
  }

  spinner(msg: string): ISpinnerHandle {
    if (this.mode === 'server' || !this.shouldLog('verbose')) {
      return new NoopSpinnerHandle(msg, this); // logs start/succeed/fail as info
    }
    return new SpinnerManager(msg);
  }

  box(content: string, options?: IBoxOptions): void {
    if (!this.shouldLog('normal')) return;
    if (this.mode === 'cli') {
      this.boxRenderer.render(content, options);
    } else {
      this.info(content);
    }
  }

  table(rows: Record<string, unknown>[], options?: ITableOptions): void {
    if (!this.shouldLog('normal')) return;
    if (this.mode === 'cli') {
      this.tableRenderer.render(rows, options);
    } else {
      this.serverRenderer.render({ level: 'info', message: 'table', meta: { rows } });
    }
  }

  header(title: string, subtitle?: string): void {
    if (!this.shouldLog('normal')) return;
    if (this.mode === 'cli') {
      this.headerRenderer.render(title, subtitle);
    } else {
      this.info(`${title}${subtitle ? ` ${subtitle}` : ''}`);
    }
  }

  divider(): void {
    if (!this.shouldLog('normal') || this.mode !== 'cli') return;
    console.log(chalk.dim(`  ${'─'.repeat(40)}`));
  }

  blank(): void {
    if (!this.shouldLog('normal') || this.mode !== 'cli') return;
    console.log();
  }

  get prompt(): PromptManager { return this._prompt; }

  time(label: string): void { /* exists in v4, keep */ }
  timeEnd(label: string): number { /* exists in v4, keep */ }
}
```

### Step 6.2 - NoopSpinnerHandle

For server mode or when level suppresses spinner output:

```typescript
class NoopSpinnerHandle implements ISpinnerHandle {
  constructor(private msg: string, private logger: Logger) {}
  start(): void { this.logger.info(this.msg); }
  stop(): void {}
  succeed(msg?: string): void { this.logger.success(msg || this.msg); }
  fail(msg?: string): void { this.logger.error(msg || this.msg); }
  text(msg: string): void { this.msg = msg; }
}
```

---

## Phase 7: Build & Distribution

### Step 7.1 - Update Vite Config

Add `@inquirer/prompts` as external dependency (peer dep or bundled).

**Decision**: Make `@inquirer/prompts` an optional peer dependency. If not installed, `logger.prompt.*` throws a helpful error.

```typescript
// Optional: check at runtime
async input(options: IInputOptions): Promise<string> {
  try {
    const { input } = await import('@inquirer/prompts');
    return input({ message: options.message, ... });
  } catch {
    throw new Error(
      '@inquirer/prompts is required for interactive prompts. Install it: bun add @inquirer/prompts'
    );
  }
}
```

### Step 7.2 - Package.json Updates

```json
{
  "name": "@mks2508/better-logger",
  "version": "5.0.0",
  "dependencies": {
    "chalk": "^5.6.0"
  },
  "optionalDependencies": {
    "@inquirer/prompts": "^7.0.0"
  },
  "peerDependencies": {
    "@inquirer/prompts": ">=7.0.0"
  },
  "peerDependenciesMeta": {
    "@inquirer/prompts": { "optional": true }
  },
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./core": { "import": "./dist/core.js", "require": "./dist/core.cjs" },
    "./cli": { "import": "./dist/cli.js", "require": "./dist/cli.cjs" },
    "./server": { "import": "./dist/server.js", "require": "./dist/server.cjs" },
    "./types": { "import": "./dist/types/index.js" }
  }
}
```

### Step 7.3 - Bundle Sizes (Target)

| Bundle | Target Size |
|--------|------------|
| Core (logging only) | ~8KB |
| CLI (spinners, boxes, tables, steps) | ~15KB |
| Server (JSON renderer) | ~4KB |
| Full (everything) | ~70KB |

---

## Phase 8: Testing & Documentation

### Step 8.1 - Test Suite

```
tests/
├── core/
│   ├── logger.test.ts
│   ├── scoped-logger.test.ts
│   └── level-filtering.test.ts
├── cli/
│   ├── spinner.test.ts
│   ├── step-tracker.test.ts
│   ├── box-renderer.test.ts
│   ├── table-renderer.test.ts
│   └── prompt-manager.test.ts
├── server/
│   ├── server-renderer.test.ts
│   └── mode-detection.test.ts
└── integration/
    ├── cli-workflow.test.ts
    └── server-workflow.test.ts
```

### Step 8.2 - Documentation Updates

- Update README with v5 features
- Add migration guide from v4 -> v5
- Add "CLI Mode" section with spinner/step/box examples
- Add "Server Mode" section with JSON output examples
- Add "Prompt System" section

---

## Phase 9: Drop-In Replacement Validation

### Critical Success Criteria

gemini-commit-wizard's `src/logger.ts` uses this interface:

```typescript
interface IWizardLogger {
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

**Validation checklist**:

| Method | v5 Logger has it? | Signature matches? |
|--------|-------------------|-------------------|
| `info()` | Yes (v4) | Yes |
| `success()` | Yes (v4) | Yes |
| `warn()` | Yes (v4) | Yes |
| `error()` | Yes (v4) | Yes |
| `debug()` | Yes (v4) | Yes |
| `step()` | NEW v5 | Yes |
| `spinner()` | NEW v5 | Yes |
| `table()` | Yes (v4, different signature) | Need to add overload |
| `box()` | NEW v5 | Yes |
| `header()` | NEW v5 | Yes |
| `divider()` | NEW v5 | Yes |
| `blank()` | NEW v5 | Yes |
| `time()` | Yes (v4) | Yes |
| `timeEnd()` | Yes (v4) | Need to ensure returns number |
| `setLevel()` | NEW v5 | Yes |
| `level` getter | NEW v5 | Yes |

**Migration in gemini-commit-wizard** (after v5 ships):

```diff
- import { log } from './logger';
+ import logger from '@mks2508/better-logger';
+ const log = logger; // or use logger directly
```

Delete `src/logger.ts`. Done.

---

## Execution Order Summary

| # | Phase | Key Deliverable | Scope |
|---|-------|----------------|-------|
| 1 | Foundation | Restructure Logger.ts, split into core/ | Refactor ~1654 lines |
| 2 | CLI Primitives | SpinnerManager, StepTracker, BoxRenderer, TableRenderer, HeaderRenderer | 5 new files (~400 lines) |
| 3 | Prompts | PromptManager wrapping @inquirer/prompts | 1 new file + types |
| 4 | Server Mode | ServerRenderer, ModeDetector, NoopSpinnerHandle | 3 new files (~200 lines) |
| 5 | Verbosity | LogLevel system with CLI/Server mapping | Integrate into Logger |
| 6 | Integration | Wire all primitives into Logger class | Modify Logger.ts |
| 7 | Build | Update Vite config, package.json exports | Config changes |
| 8 | Testing | Test suite for new features | ~15 test files |
| 9 | Validation | Verify drop-in compatibility with wizard's logger interface | Integration test |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking v4 API | Existing consumers break | Keep ALL v4 methods, v5 is purely additive |
| `@inquirer/prompts` bundle size | Bloated full build | Make it optional peer dep, lazy import |
| Spinner conflicts with other console output | Garbled terminal | Write spinners to stderr, log to stdout |
| Server mode missing CLI methods | Runtime errors | NoopSpinnerHandle + graceful fallbacks for all CLI methods |
| `Logger.ts` refactor too large | Regressions | Phase 1 is pure restructure (no behavior changes), test heavily |
| `timeEnd()` return type | v4 may return void | Ensure v5 returns `number` (elapsed ms) |

---

## NOT in Scope for v5.0

- Custom prompt implementations (use @inquirer/prompts wrapper)
- Log rotation for file transport
- Remote log aggregation dashboards
- Plugin system redesign
- Browser DevTools CLI primitives (spinners don't work in browser)
- Breaking changes to v4 API
