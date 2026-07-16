#!/usr/bin/env bun

/**
 * Staging control for commit generation.
 *
 * Provides safe staging decisions before commit generation. Replaces the
 * previous blanket `git add -A` behavior with explicit, agent-friendly
 * staging modes that prevent accidental commits of unrelated untracked files.
 *
 * Modes:
 * - `all`: `git add -A` — every modified + untracked file (explicit only)
 * - `staged-only`: respect what the user has already staged
 * - `select`: interactive file picker (TTY only)
 * - `specific`: stage only the provided file paths
 *
 * Agent/CI mode (`isAgent: true`) skips all prompts and errors out on
 * ambiguity. This keeps the tool safe to call from scripts and other
 * agents that cannot answer interactive prompts.
 *
 * @module staging
 */

import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { Logger } from '@mks2508/better-logger';
import type { IGitFileStatus } from './types/git.types.js';

const log = new Logger();

/**
 * Staging strategy selected for a commit run.
 */
export type StagingMode = 'all' | 'staged-only' | 'select' | 'specific';

/**
 * Options controlling staging behavior.
 */
export interface IStagingOptions {
    /**
     * Staging mode. Required unless the run is interactive (TTY + non-agent),
     * in which case the user is prompted to choose.
     */
    mode?: StagingMode;
    /**
     * File paths to stage when `mode === 'specific'`.
     * Each path must exist relative to the project root.
     */
    files?: string[];
    /**
     * Whether the run can interact with the user via prompts.
     * Defaults to true when in a TTY and `isAgent` is false.
     */
    interactive?: boolean;
    /**
     * Agent/CI mode: skip all prompts and error on ambiguity.
     * Required for any non-interactive run.
     */
    isAgent?: boolean;
    /**
     * Optional callback invoked when an interactive prompt is needed.
     * Defaults to using @inquirer/prompts in a TTY.
     */
    promptFn?: IStagingPromptFn;
}

/**
 * Async prompt callback signature for staging selection.
 * @returns The selected staging mode and (if `specific`) file paths
 */
export type IStagingPromptFn = () => Promise<{
    mode: StagingMode;
    files?: string[];
}>;

/**
 * Result of the staging decision step.
 *
 * `toStage` is the list of files the caller must `git add` before
 * generating commits. `alreadyStaged` is informational only — those
 * files will already be in the index after `applyStaging`.
 */
export interface IStagingDecision {
    /** File paths to add to the staging area */
    toStage: string[];
    /** Files already in the index that should be preserved */
    alreadyStaged: string[];
    /** Files explicitly excluded from staging (informational) */
    excluded: string[];
    /** Human-readable explanation of the decision */
    reason: string;
    /** The mode that was ultimately selected */
    mode: StagingMode;
}

/**
 * Result of `applyStaging`: void on success, throws on git error.
 */
export type ApplyStagingResult = void;

// ─── Git helpers (uses Bun.spawnSync to keep parity with commit-generator) ───

/**
 * Run a git command and return stdout. Throws on non-zero exit.
 *
 * Uses Node's `child_process.spawnSync` so this module runs in any
 * JS runtime (Bun, Node, vitest under Node). Using Bun.spawnSync
 * would break vitest.
 *
 * The trailing newline is trimmed but leading whitespace is preserved
 * because `git status --porcelain` relies on leading spaces to encode
 * the worktree status (e.g. ` M path` for staged-only changes).
 *
 * @param args - Git subcommand and arguments
 * @param cwd - Working directory for the git invocation
 * @returns Stdout text with trailing newline removed
 */
function runGit(args: string[], cwd: string): string {
    const result = spawnSync('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
    });

    if (result.status !== 0) {
        const stderr = result.stderr || 'Git command failed';
        throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
    }

    let out = (result.stdout || '').toString();
    if (out.endsWith('\n')) out = out.slice(0, -1);
    return out;
}

/**
 * Parse `git status --porcelain` into structured `IGitFileStatus` entries.
 *
 * Git's porcelain v1 format is `XY PATH` where:
 * - X (column 0) = INDEX status
 * - Y (column 1) = WORKTREE status
 * - Column 2 = space separator
 * - Column 3+ = path
 *
 * Examples:
 * - ` M README.md` → index clean, worktree modified (unstaged)
 * - `M  README.md` → index modified, worktree clean (staged)
 * - `MM README.md` → both modified
 * - `?? new.txt`   → untracked (both columns)
 *
 * When the worktree status is empty, the format collapses to a single
 * status letter + space + path (e.g. `M path` for staged-only).
 *
 * @param porcelain - Raw output of `git status --porcelain`
 * @returns Array of parsed file status entries
 */
function parsePorcelain(porcelain: string): IGitFileStatus[] {
    const files: IGitFileStatus[] = [];

    for (const rawLine of porcelain.split('\n')) {
        if (!rawLine.trim()) continue;

        // Format is strictly `XY PATH` where XY is exactly 2 chars (may
        // include leading spaces) and path starts at index 3.
        if (rawLine.length < 3) continue;
        const indexStatus = rawLine[0];
        const workTreeStatus = rawLine[1];
        const filePath = rawLine.substring(3);

        const staged =
            indexStatus !== ' ' &&
            indexStatus !== '?' &&
            indexStatus !== undefined;
        const unstaged = workTreeStatus !== ' ' && workTreeStatus !== undefined;
        const untracked = indexStatus === '?' && workTreeStatus === '?';
        const deleted = indexStatus === 'D' || workTreeStatus === 'D';
        const renamed = indexStatus === 'R' || workTreeStatus === 'R'
            ? filePath.split(' -> ')[1] ?? filePath
            : undefined;

        files.push({
            path: filePath,
            staged,
            unstaged,
            untracked,
            deleted,
            renamed,
        });
    }

    return files;
}

/**
 * Get the current working-tree status for the project root.
 *
 * @param projectRoot - Absolute path to the project root
 * @returns Array of file status entries (empty when the tree is clean)
 */
export function getGitStatusDetailed(projectRoot: string): IGitFileStatus[] {
    const output = runGit(['status', '--porcelain'], projectRoot);
    return parsePorcelain(output);
}

// ─── Decision logic ──────────────────────────────────────────────

/**
 * Validate the staging decision inputs.
 *
 * Centralised so both interactive and agent paths fail with the same
 * error shape. Throws an Error with a stable message suitable for
 * machine consumption by agents and scripts.
 *
 * @param options - Caller-supplied staging options
 */
function validateOptions(options: IStagingOptions): void {
    if (options.mode === 'specific') {
        if (!options.files || options.files.length === 0) {
            throw new Error(
                'STAGING_MODE_REQUIRES_FILES: --add mode requires at least one file path. ' +
                'Pass --add <file>... or use a different staging mode.',
            );
        }
    }
}

/**
 * Validate that all provided file paths exist relative to the project root.
 *
 * @param files - File paths to validate
 * @param projectRoot - Absolute path to the project root
 * @returns Same array, for chaining
 */
function validateFiles(files: string[], projectRoot: string): string[] {
    for (const file of files) {
        if (!existsSync(`${projectRoot}/${file}`)) {
            throw new Error(
                `STAGING_FILE_NOT_FOUND: file '${file}' does not exist relative to project root. ` +
                `Run from the project root or pass paths relative to it.`,
            );
        }
    }
    return files;
}

/**
 * Resolve the staging mode: prefer explicit option, fall back to prompt
 * in interactive mode, error in agent mode.
 *
 * @param options - Caller-supplied staging options
 * @param status - Current git status
 * @returns The resolved mode and (for specific) file list
 */
async function resolveMode(
    options: IStagingOptions,
    status: IGitFileStatus[],
): Promise<{ mode: StagingMode; files?: string[] }> {
    // Explicit mode always wins
    if (options.mode) {
        return { mode: options.mode, files: options.files };
    }

    // No explicit mode: interactive or agent
    if (options.isAgent) {
        throw new Error(
            'STAGING_MODE_REQUIRED: agent/CI mode requires an explicit staging mode. ' +
            'Pass one of: --staged-only, --all, --add <files>. ' +
            `Working tree has ${status.length} changed files.`,
        );
    }

    if (options.interactive === false) {
        throw new Error(
            'STAGING_MODE_REQUIRED: non-interactive run requires an explicit staging mode. ' +
            'Pass one of: --staged-only, --all, --add <files>.',
        );
    }

    // Interactive prompt
    const promptFn = options.promptFn ?? defaultPrompt;
    return await promptFn();
}

/**
 * Default interactive prompt using @inquirer/prompts.
 * Only invoked in a real TTY; the agent/CI path bypasses this entirely.
 */
async function defaultPrompt(): Promise<{ mode: StagingMode; files?: string[] }> {
    const { select, input, checkbox } = await import('@inquirer/prompts');

    const mode = await select<StagingMode>({
        message: 'What to stage?',
        choices: [
            {
                value: 'staged-only',
                name: 'Already staged only — respect what you already git-add\'d',
            },
            {
                value: 'all',
                name: 'All changes — every modified + untracked file (explicit)',
            },
            {
                value: 'select',
                name: 'Select files — pick from the working tree',
            },
            {
                value: 'specific',
                name: 'Specific paths — type the files you want',
            },
        ],
    });

    if (mode === 'specific') {
        const raw = await input({
            message: 'File paths (space-separated, relative to project root):',
            validate: (v: string) => v.trim().length > 0 || 'At least one file is required',
        });
        return { mode, files: raw.trim().split(/\s+/).filter(Boolean) };
    }

    if (mode === 'select') {
        const status = getGitStatusDetailed(process.cwd());
        const choices = status
            .filter(f => !f.staged)
            .map(f => ({
                name: `${f.path} (${describeStatus(f)})`,
                value: f.path,
            }));
        if (choices.length === 0) {
            throw new Error('STAGING_NOTHING_TO_SELECT: no unstaged files available to select.');
        }
        const selected = await checkbox({
            message: 'Pick files to stage:',
            choices,
            validate: (v: readonly unknown[]) => v.length > 0 || 'Pick at least one file',
        });
        return { mode, files: selected as string[] };
    }

    return { mode };
}

/**
 * Short human label for a git file status entry.
 * @param f - File status entry
 * @returns Short status label
 */
function describeStatus(f: IGitFileStatus): string {
    if (f.untracked) return 'untracked';
    if (f.deleted) return 'deleted';
    if (f.staged && f.unstaged) return 'modified+staged';
    if (f.staged) return 'staged';
    if (f.unstaged) return 'modified';
    if (f.renamed) return `renamed -> ${f.renamed}`;
    return 'changed';
}

/**
 * Decide what to stage based on the resolved mode and current git status.
 *
 * This is the single entry point for staging decisions. The caller MUST
 * pass `mode` explicitly unless interactive=true and isAgent=false.
 *
 * Behavior matrix:
 * - `staged-only`: `toStage = []`, `alreadyStaged = [...staged]`
 * - `all`: `toStage = [...not staged]`, `alreadyStaged = [...staged]`
 * - `select`: prompt for files, then like `specific`
 * - `specific`: `toStage = options.files` (after validation)
 *
 * @param projectRoot - Absolute path to the project root
 * @param options - Staging options (mode may be resolved via prompt)
 * @returns A decision object describing what to add and why
 *
 * @example
 * ```typescript
 * const decision = await decideStaging(projectRoot, {
 *   mode: 'staged-only',
 *   isAgent: true,
 * });
 * await applyStaging(projectRoot, decision);
 * ```
 */
export async function decideStaging(
    projectRoot: string,
    options: IStagingOptions = {},
): Promise<IStagingDecision> {
    const status = getGitStatusDetailed(projectRoot);
    const resolved = await resolveMode(options, status);
    validateOptions({ ...options, ...resolved });

    const alreadyStaged = status.filter(f => f.staged).map(f => f.path);

    switch (resolved.mode) {
        case 'staged-only': {
            return {
                toStage: [],
                alreadyStaged,
                excluded: status.filter(f => !f.staged).map(f => f.path),
                reason: 'staged-only: respect user\'s pre-existing staging',
                mode: 'staged-only',
            };
        }
        case 'all': {
            const toStage = status
                .filter(f => !f.staged && !f.deleted)
                .map(f => f.path);
            const excluded = status.filter(f => f.deleted && !f.staged).map(f => f.path);
            return {
                toStage,
                alreadyStaged,
                excluded,
                reason: 'all: stage every modified + untracked file',
                mode: 'all',
            };
        }
        case 'select':
        case 'specific': {
            const files = validateFiles(resolved.files ?? [], projectRoot);
            return {
                toStage: files,
                alreadyStaged,
                excluded: status
                    .filter(f => !f.staged && !files.includes(f.path))
                    .map(f => f.path),
                reason: `${resolved.mode}: stage ${files.length} file(s)`,
                mode: resolved.mode,
            };
        }
    }
}

/**
 * Apply a staging decision to the working tree.
 *
 * Adds the `toStage` paths to the index using `git add -- <path>...`.
 * Already-staged files are left untouched. This function does NOT run
 * `git add -A` under any circumstance — that is the footgun this whole
 * module exists to prevent.
 *
 * @param projectRoot - Absolute path to the project root
 * @param decision - The decision returned by `decideStaging`
 *
 * @example
 * ```typescript
 * const decision = await decideStaging(projectRoot, { mode: 'staged-only' });
 * await applyStaging(projectRoot, decision);
 * // Now `git diff --cached` reflects the staged set.
 * ```
 */
export async function applyStaging(
    projectRoot: string,
    decision: IStagingDecision,
): Promise<ApplyStagingResult> {
    if (decision.toStage.length === 0) {
        log.debug('No additional files to stage (already-staged only mode)');
        return;
    }

    log.debug(`Staging ${decision.toStage.length} file(s) via git add --`);
    runGit(['add', '--', ...decision.toStage], projectRoot);
}

/**
 * Reset the staging area to HEAD, leaving the working tree untouched.
 *
 * Use this in tests or when aborting a staging decision that has already
 * been applied. Not exposed as a CLI flag — only via the SDK.
 *
 * @param projectRoot - Absolute path to the project root
 */
export function resetStaging(projectRoot: string): void {
    runGit(['reset', 'HEAD', '--', '.'], projectRoot);
}