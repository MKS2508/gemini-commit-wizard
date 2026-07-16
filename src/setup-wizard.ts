#!/usr/bin/env bun

/**
 * Setup wizard for gemini-commit-wizard.
 *
 * Interactive command that generates a `.commit-wizard.json` for the
 * current project. Auto-detects tech stack and existing config, then
 * prompts for the remaining fields. Designed to be run once per project
 * (or whenever the config needs an update).
 *
 * Usage:
 *   bun src/setup-wizard.ts            # interactive
 *   bun src/setup-wizard.ts --force     # overwrite existing config
 *   bun src/setup-wizard.ts --dry-run   # show what would be written
 *
 * @module setup-wizard
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import logger from '@mks2508/better-logger';
// Alias so the file's existing `log.xxx(...)` call sites stay unchanged.
const log = logger;
import { tryCatchAsync, type Result } from '@mks2508/no-throw';
import { loadProjectConfig, detectTechStack, detectPlatform } from './project-config.js';
import type { IProjectConfig, IProjectComponent } from './types/index.js';


/**
 * Result type for the setup wizard.
 */
export type SetupResult = {
    wrote: boolean;
    path: string;
    config: IProjectConfig;
};

/**
 * Input provided to the wizard. When supplied (e.g. by the test suite),
 * the wizard skips interactive prompts and uses these values directly.
 * Any field left undefined falls back to auto-detection or a default.
 */
export interface ISetupWizardInput {
    name?: string;
    description?: string;
    techStack?: string[];
    targetPlatform?: string;
    components?: IProjectComponent[];
    commitFormat?: {
        titleLanguage?: string;
        bodyLanguage?: string;
        includeTechnical?: boolean;
        includeChangelog?: boolean;
    };
    provider?: 'gemini-sdk' | 'groq' | 'openrouter' | 'gemini-cli';
    model?: string;
    noPush?: boolean;
    stagingMode?: 'all' | 'staged-only' | 'specific';
    protectedBranches?: string[];
}

/**
 * Prompt function used by the wizard. Defaults to @inquirer/prompts in
 * TTY mode. Tests inject `promptFn` to drive the flow programmatically.
 */
export type ISetupPromptFn = (questions: ISetupQuestion[]) => Promise<Record<string, unknown>>;

/**
 * A single prompt question.
 */
export interface ISetupQuestion {
    /** Prompt key used to read back the answer */
    key: string;
    /** Prompt type */
    type: 'input' | 'select' | 'checkbox' | 'confirm';
    /** Question text */
    message: string;
    /** Default value (for input) or default-selected choices (for checkbox) */
    default?: unknown;
    /** Available choices for select/checkbox */
    choices?: Array<{ name: string; value: string }>;
}

/**
 * Merge `ISetupWizardInput` overrides into the detected config so that
 * programmatic callers (tests, scripts) can bypass individual prompts.
 *
 * @param detected - Defaults derived from the existing repo
 * @param input - Caller-supplied overrides
 * @returns A new Partial<IProjectConfig> with input fields taking precedence
 */
function applyInputOverrides(
    detected: Partial<IProjectConfig>,
    input: ISetupWizardInput,
): Partial<IProjectConfig> {
    const merged = { ...detected };

    if (input.name !== undefined) merged.name = input.name;
    if (input.description !== undefined) merged.description = input.description;
    if (input.techStack !== undefined) merged.techStack = input.techStack;
    if (input.targetPlatform !== undefined) merged.targetPlatform = input.targetPlatform;
    if (input.components !== undefined) merged.components = input.components;

    if (input.commitFormat) {
        merged.commitFormat = {
            ...(merged.commitFormat ?? {}),
            ...input.commitFormat,
        };
    }

    return merged;
}

/**
 * Read `package.json` from `projectRoot` if present.
 *
 * @param projectRoot - Path to project root
 * @returns Parsed package.json or null when not found / unparseable
 */
function readPackageJson(projectRoot: string): Record<string, unknown> | null {
    const path = join(projectRoot, 'package.json');
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Detect project components from a monorepo layout.
 *
 * Heuristic: every first-level directory under `apps/`, `packages/`,
 * or `core/packages/` is treated as a component. The id is the dir
 * name; the path is the relative path; the name is the humanised id.
 *
 * @param projectRoot - Path to project root
 * @returns Detected components (empty when no monorepo layout is found)
 */
export function detectComponents(projectRoot: string): IProjectComponent[] {
    const candidateRoots = ['apps', 'packages', 'core/packages'];
    const components: IProjectComponent[] = [];

    for (const root of candidateRoots) {
        const fullPath = join(projectRoot, root);
        if (!existsSync(fullPath)) continue;
        try {
            const { readdirSync, statSync } = require('fs') as typeof import('fs');
            for (const entry of readdirSync(fullPath)) {
                const entryPath = join(fullPath, entry);
                if (!statSync(entryPath).isDirectory()) continue;
                const relPath = `${root}/${entry}`;
                components.push({
                    id: entry,
                    path: `${relPath}/`,
                    name: humaniseComponentName(entry),
                });
            }
        } catch {
            // ignore — non-critical
        }
    }

    return components;
}

/**
 * Convert a kebab/camel component id into a human-friendly title.
 * @param id - Component id (e.g. `media-daemon`)
 * @returns Humanised title (e.g. `Media Daemon`)
 */
function humaniseComponentName(id: string): string {
    return id
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

/**
 * Pick a sensible default provider and model based on env vars.
 *
 * Priority order (matches `providers/index.ts`):
 * 1. GEMINI_API_KEY -> gemini-2.5-flash
 * 2. GROQ_API_KEY -> llama-3.3-70b-versatile
 * 3. OPENROUTER_API_KEY -> anthropic/claude-sonnet-4
 * 4. (none)
 *
 * @returns Resolved provider/model pair, or null when no keys are set
 */
export function detectProviderPreference(): { provider: string; model: string } | null {
    if (process.env.GEMINI_API_KEY) {
        return { provider: 'gemini-sdk', model: 'gemini-2.5-flash' };
    }
    if (process.env.GROQ_API_KEY) {
        return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
    }
    if (process.env.OPENROUTER_API_KEY) {
        return { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' };
    }
    return null;
}

// ─── Wizard core ──────────────────────────────────────────────

/**
 * Determine whether to overwrite an existing config.
 *
 * @param path - Path to .commit-wizard.json
 * @param force - Force flag from CLI
 * @returns Whether to overwrite
 */
async function shouldOverwrite(path: string, force: boolean, promptFn: ISetupPromptFn): Promise<boolean> {
    if (!existsSync(path)) return true;
    if (force) return true;

    const { confirm } = await promptFn([
        {
            key: 'overwrite',
            type: 'confirm',
            message: `.commit-wizard.json already exists at ${path}. Overwrite?`,
            default: false,
        },
    ]);
    return confirm === true;
}

/**
 * Build the list of questions for the wizard, factoring in
 * auto-detected defaults so the user only confirms what's missing.
 */
function buildQuestions(
    detected: Partial<IProjectConfig>,
    projectRoot: string,
): ISetupQuestion[] {
    const pkg = readPackageJson(projectRoot);
    const repoName = pkg?.name ? String(pkg.name) : basename(projectRoot);

    return [
        {
            key: 'name',
            type: 'input',
            message: 'Project name:',
            default: detected.name ?? repoName,
        },
        {
            key: 'description',
            type: 'input',
            message: 'Project description:',
            default: detected.description ?? `Project at ${projectRoot}`,
        },
        {
            key: 'techStack',
            type: 'checkbox',
            message: 'Tech stack (toggle to customise what was auto-detected):',
            default: detected.techStack ?? ['TypeScript'],
            choices: (detected.techStack ?? ['TypeScript']).map(t => ({
                name: t,
                value: t,
            })),
        },
        {
            key: 'targetPlatform',
            type: 'select',
            message: 'Target platform:',
            default: detected.targetPlatform ?? 'Cross-platform',
            choices: [
                { name: 'Web (Frontend)', value: 'Web (Frontend)' },
                { name: 'Web (Full-stack)', value: 'Web (Full-stack)' },
                { name: 'Server (Backend)', value: 'Server (Backend)' },
                { name: 'Desktop (Electron)', value: 'Desktop (Electron)' },
                { name: 'Desktop (Tauri)', value: 'Desktop (Tauri)' },
                { name: 'Mobile (React Native)', value: 'Mobile (React Native)' },
                { name: 'CLI', value: 'CLI' },
                { name: 'Library', value: 'Library' },
                { name: 'Cross-platform', value: 'Cross-platform' },
            ],
        },
        {
            key: 'titleLanguage',
            type: 'select',
            message: 'Commit title language:',
            default: detected.commitFormat?.titleLanguage ?? 'english',
            choices: [
                { name: 'English', value: 'english' },
                { name: 'Spanish', value: 'spanish' },
                { name: 'Both (English title, Spanish body)', value: 'both' },
            ],
        },
        {
            key: 'bodyLanguage',
            type: 'select',
            message: 'Commit body language:',
            default: detected.commitFormat?.bodyLanguage ?? 'spanish',
            choices: [
                { name: 'English', value: 'english' },
                { name: 'Spanish', value: 'spanish' },
            ],
        },
        {
            key: 'includeChangelog',
            type: 'confirm',
            message: 'Include <changelog> section in commits?',
            default: detected.commitFormat?.includeChangelog ?? true,
        },
        {
            key: 'noPush',
            type: 'confirm',
            message: 'Default to --no-push (require --confirm-push to push)?',
            default: true,
        },
    ];
}

/**
 * Persist the wizard's config to `.commit-wizard.json`.
 *
 * @param projectRoot - Path to project root
 * @param config - Resolved config to write
 * @returns Result with the path written or an error message
 */
function writeConfigFile(
    projectRoot: string,
    config: IProjectConfig,
): Result<{ path: string }, string> {
    const path = join(projectRoot, '.commit-wizard.json');
    try {
        const json = JSON.stringify(config, null, 2) + '\n';
        writeFileSync(path, json, 'utf-8');
        return { path, ok: true } as any;
    } catch (error) {
        return { ok: false, error: String(error) } as any;
    }
}

/**
 * Run the setup wizard for `projectRoot`.
 *
 * @param options - Wizard options (`force`, `dryRun`, `input`, `promptFn`)
 * @returns Result with the result (or error)
 */
export async function runSetupWizard(options: {
    projectRoot?: string;
    force?: boolean;
    dryRun?: boolean;
    input?: ISetupWizardInput;
    promptFn?: ISetupPromptFn;
} = {}): Promise<Result<SetupResult, string>> {
    return tryCatchAsync(async () => {
        const projectRoot = options.projectRoot ?? process.cwd();
        const targetPath = join(projectRoot, '.commit-wizard.json');

        // Load existing config as the base for detection
        const existing = loadProjectConfig(projectRoot);
        const detected: Partial<IProjectConfig> = {
            name: existing.name,
            description: existing.description,
            techStack: existing.techStack,
            targetPlatform: existing.targetPlatform,
            commitFormat: existing.commitFormat,
            components: existing.components,
        };

        // Try to detect components from a monorepo layout if none were configured
        if (!detected.components || detected.components.length === 0) {
            const found = detectComponents(projectRoot);
            if (found.length > 0) {
                detected.components = found;
            }
        }

        const providerPref = detectProviderPreference();
        if (providerPref) {
            detected.provider = providerPref.provider as IProjectConfig['provider'];
            detected.model = providerPref.model;
        }

        const override = options.input ?? {};
        const merged = applyInputOverrides(detected, override);

        let answers: Record<string, unknown>;

        if (options.promptFn) {
            answers = await options.promptFn(
                buildQuestions(detected, projectRoot),
            );
        } else {
            // Fallback: use merged defaults (no interactive prompt)
            // This branch is used by `bun src/setup-wizard.ts --dry-run` in CI
            answers = {
                name: merged.name ?? basename(projectRoot),
                description: merged.description ?? '',
                techStack: merged.techStack ?? ['TypeScript'],
                targetPlatform: merged.targetPlatform ?? 'Cross-platform',
                titleLanguage: merged.commitFormat?.titleLanguage ?? 'english',
                bodyLanguage: merged.commitFormat?.bodyLanguage ?? 'spanish',
                includeChangelog: merged.commitFormat?.includeChangelog ?? true,
                noPush: override.noPush ?? true,
            };
        }

        const mergedConfig: IProjectConfig = {
            name: String(answers.name ?? merged.name ?? basename(projectRoot)),
            description: String(answers.description ?? merged.description ?? ''),
            version: existing.version || '0.1.0',
            techStack: Array.isArray(answers.techStack)
                ? (answers.techStack as string[])
                : (merged.techStack ?? ['TypeScript']),
            targetPlatform: String(answers.targetPlatform ?? merged.targetPlatform ?? 'Cross-platform'),
            components: merged.components,
            commitFormat: {
                titleLanguage: String(answers.titleLanguage ?? 'english'),
                bodyLanguage: String(answers.bodyLanguage ?? 'spanish'),
                includeTechnical: merged.commitFormat?.includeTechnical ?? true,
                includeChangelog: Boolean(answers.includeChangelog ?? true),
            },
            provider: (merged.provider ?? 'groq') as IProjectConfig['provider'],
            model: merged.model,
        };

        if (options.dryRun) {
            log.info('Dry run — would write the following config:');
            log.info(JSON.stringify(mergedConfig, null, 2));
            return { wrote: false, path: targetPath, config: mergedConfig };
        }

        if (!options.input) {
            // Interactive: ask before overwriting an existing file
            const overwrite = await shouldOverwrite(targetPath, options.force ?? false, options.promptFn ?? defaultPrompt);
            if (!overwrite) {
                log.info('Cancelled by user');
                return { wrote: false, path: targetPath, config: mergedConfig };
            }
        }

        const write = writeConfigFile(projectRoot, mergedConfig);
        if (!(write as any).ok) {
            throw new Error(`Failed to write config: ${(write as any).error}`);
        }
        log.success(`Wrote .commit-wizard.json to ${(write as any).path}`);
        return { wrote: true, path: (write as any).path, config: mergedConfig };
    }, 'SETUP_ERROR');
}

// ─── Default prompt (TTY only) ────────────────────────────────

async function defaultPrompt(questions: ISetupQuestion[]): Promise<Record<string, unknown>> {
    const { input, select, checkbox, confirm } = await import('@inquirer/prompts');
    const answers: Record<string, unknown> = {};

    for (const q of questions) {
        switch (q.type) {
            case 'input':
                answers[q.key] = await input({
                    message: q.message,
                    default: q.default as string | undefined,
                });
                break;
            case 'select':
                answers[q.key] = await select({
                    message: q.message,
                    choices: q.choices ?? [],
                    default: q.default as string | undefined,
                });
                break;
            case 'checkbox':
                answers[q.key] = await checkbox({
                    message: q.message,
                    choices: q.choices ?? [],
                    default: q.default as string[] | undefined,
                });
                break;
            case 'confirm':
                answers[q.key] = await confirm({
                    message: q.message,
                    default: q.default as boolean | undefined,
                });
                break;
        }
    }

    return answers;
}

// ─── CLI entry point ──────────────────────────────────────────

if (import.meta.main) {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const dryRun = args.includes('--dry-run');

    if (args.includes('--help') || args.includes('-h')) {
        log.header('Setup Wizard', 'Generate .commit-wizard.json');
        log.blank();
        log.info('Usage: bun src/setup-wizard.ts [options]');
        log.blank();
        log.info('Options:');
        log.info('  --force     Overwrite existing .commit-wizard.json');
        log.info('  --dry-run   Show the config that would be written without writing');
        log.info('  --help, -h  Show this help');
        process.exit(0);
    }

    runSetupWizard({ force, dryRun }).then(result => {
        if (!result.ok) {
            log.error(`Setup wizard failed: ${(result as any).error}`);
            process.exit(1);
        }
    });
}

export { defaultPrompt };