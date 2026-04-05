/**
 * Git utilities for the commit generator.
 * Provides helpers for parsing git status, analyzing diffs,
 * and generating technical summaries.
 *
 * Now uses simple-git for Git operations.
 *
 * @module git-utils
 */

import simpleGit from 'simple-git';
import type {
    SimpleGit,
    StatusResult,
    LogResult,
    CommitResult,
    PushResult,
    PullResult,
    FetchResult,
} from 'simple-git';
import { ok, err, type Result } from '@mks2508/no-throw';
import type { IGitFileStatus, IGitCommitInfo } from './types/index.js';

// Re-export types for backward compatibility
export type { IGitFileStatus as GitFileStatus } from './types/index.js';
export type { IGitCommitInfo as CommitInfo } from './types/index.js';

/**
 * Parse output of `git status --porcelain` into structured file statuses.
 * @param statusOutput - Raw output from git status --porcelain
 * @returns Array of parsed file status objects
 */
export function parseGitStatus(statusOutput: string): IGitFileStatus[] {
    const files: IGitFileStatus[] = [];

    for (const line of statusOutput.split('\n').filter(l => l.trim())) {
        const staged = line[0];
        const unstaged = line[1];
        const filePath = line.substring(3);

        files.push({
            path: filePath,
            staged: staged !== ' ' && staged !== '?',
            unstaged: unstaged !== ' ',
            untracked: staged === '?' && unstaged === '?',
            deleted: staged === 'D' || unstaged === 'D',
            renamed: staged === 'R' ? filePath.split(' -> ')[1] : undefined,
        });
    }

    return files;
}

/**
 * Determine the functional area of a file based on its path.
 * @param filePath - File path relative to project root
 * @returns Area identifier string
 */
export function getFileArea(filePath: string): string {
    const areas = [
        { pattern: /^src\/components\/|^src\/layouts\//, area: 'ui' },
        { pattern: /^src-tauri\//, area: 'backend' },
        { pattern: /^src\/models\/|types|interfaces/, area: 'types' },
        { pattern: /^src\/stores\/|state/, area: 'state' },
        { pattern: /^src\/pages\/|routing|navigation/, area: 'navigation' },
        { pattern: /^src\/styles\/|\.css$|theme/, area: 'theme' },
        { pattern: /config|\.json$|\.toml$|package\.json/, area: 'config' },
        { pattern: /^project-utils\/|tools|scripts/, area: 'tools' },
        { pattern: /database|migration|sql/, area: 'database' },
        { pattern: /test|spec|\.test\.|\.spec\./, area: 'testing' },
        { pattern: /doc|readme|\.md$/, area: 'docs' },
    ];

    for (const { pattern, area } of areas) {
        if (pattern.test(filePath.toLowerCase())) {
            return area;
        }
    }

    return 'misc';
}

/**
 * Determine if files are functionally related.
 * @param files - Array of file paths
 * @returns Whether the files belong to related functional areas
 */
export function areFilesRelated(files: string[]): boolean {
    if (files.length <= 1) return true;

    const areas = files.map(getFileArea);
    const uniqueAreas = [...new Set(areas)];

    if (uniqueAreas.length === 1) return true;

    const relatedAreas = [
        ['ui', 'theme', 'navigation'],
        ['backend', 'database', 'types'],
        ['config', 'tools', 'docs'],
        ['types', 'state'],
    ];

    for (const group of relatedAreas) {
        if (uniqueAreas.every(area => group.includes(area))) {
            return true;
        }
    }

    return false;
}

/**
 * Suggest commit type based on file changes.
 * @param files - Array of git file statuses
 * @returns Suggested commit type
 */
export function suggestCommitType(files: IGitFileStatus[]): 'feat' | 'fix' | 'refactor' | 'feat-phase' {
    const hasNewFiles = files.some(f => f.untracked);
    const hasDeletedFiles = files.some(f => f.deleted);
    const modifiedFiles = files.filter(f => f.staged || f.unstaged);

    if (hasNewFiles && files.length > 3) {
        return 'feat-phase';
    }

    if (hasNewFiles) {
        return 'feat';
    }

    if (modifiedFiles.length > 0 && !hasNewFiles) {
        if (modifiedFiles.length > 5) {
            return 'refactor';
        }
        return 'fix';
    }

    return 'feat';
}

/**
 * Extract relevant information from a file diff.
 * @param diff - Raw git diff output
 * @returns Analysis of the diff contents
 */
export function analyzeDiff(diff: string): {
    addedLines: number;
    removedLines: number;
    hasNewFunctions: boolean;
    hasNewTypes: boolean;
    hasNewImports: boolean;
    hasFixes: boolean;
} {
    const lines = diff.split('\n');
    const addedLines = lines.filter(l => l.startsWith('+')).length;
    const removedLines = lines.filter(l => l.startsWith('-')).length;

    const addedCode = lines.filter(l => l.startsWith('+')).join('\n');
    const removedCode = lines.filter(l => l.startsWith('-')).join('\n');

    return {
        addedLines,
        removedLines,
        hasNewFunctions: /function\s+\w+|const\s+\w+\s*=|async\s+function/.test(addedCode),
        hasNewTypes: /interface\s+\w+|type\s+\w+|enum\s+\w+/.test(addedCode),
        hasNewImports: /import\s+.*from/.test(addedCode),
        hasFixes: /fix|error|bug|issue|problem/i.test(addedCode) || removedCode.includes('TODO') || removedCode.includes('FIXME'),
    };
}

/**
 * Generate a technical summary based on modified files and their diffs.
 * @param files - Array of git file statuses
 * @param diffs - Map of file paths to their diff content
 * @returns Formatted technical summary string
 */
export function generateTechnicalSummary(files: IGitFileStatus[], diffs: Record<string, string>): string {
    const summary: string[] = [];

    for (const file of files) {
        const area = getFileArea(file.path);
        const diff = diffs[file.path];

        if (!diff) continue;

        const analysis = analyzeDiff(diff);
        const changes: string[] = [];

        if (file.untracked) {
            changes.push(`Creado ${file.path}`);
        } else if (file.deleted) {
            changes.push(`Eliminado ${file.path}`);
        } else {
            if (analysis.hasNewFunctions) changes.push('nuevas funciones');
            if (analysis.hasNewTypes) changes.push('nuevos tipos');
            if (analysis.hasNewImports) changes.push('nuevas dependencias');
            if (analysis.hasFixes) changes.push('correcciones');

            if (changes.length > 0) {
                changes.unshift(`Modificado ${file.path} con`);
            } else {
                changes.push(`Actualizado ${file.path}`);
            }
        }

        if (changes.length > 0) {
            summary.push(`- ${changes.join(' ')}`);
        }
    }

    return summary.join('\n');
}

// ─── simple-git wrapper functions ─────────────────────────

/**
 * Get git status using simple-git.
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Parsed status result
 */
export async function getGitStatus(repoPath?: string): Promise<Result<StatusResult, Error>> {
    try {
        const git = simpleGit(repoPath);
        const status = await git.status();
        return ok(status);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Get git diff using simple-git.
 * @param from - From ref (optional)
 * @param to - To ref (optional)
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Diff output
 */
export async function getGitDiff(from?: string, to?: string, repoPath?: string): Promise<Result<string, Error>> {
    try {
        const git = simpleGit(repoPath);
        const diff = from && to ? await git.diff([from, to]) : await git.diff();
        return ok(diff);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Get commit log using simple-git.
 * @param options - Log options
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Log result
 */
export async function getGitLog(options?: { from?: string; to?: string; maxCount?: number; file?: string }, repoPath?: string): Promise<Result<LogResult, Error>> {
    try {
        const git = simpleGit(repoPath);
        const log = await git.log(options);
        return ok(log);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Stage files using simple-git.
 * @param files - File paths to stage
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Command output
 */
export async function gitAdd(files: string | string[], repoPath?: string): Promise<Result<string, Error>> {
    try {
        const git = simpleGit(repoPath);
        const result = await git.add(Array.isArray(files) ? files : [files]);
        return ok(result);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Commit staged changes using simple-git.
 * @param message - Commit message
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Commit result
 */
export async function gitCommit(message: string, repoPath?: string): Promise<Result<CommitResult, Error>> {
    try {
        const git = simpleGit(repoPath);
        const result = await git.commit(message);
        return ok(result);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Push to remote using simple-git.
 * @param remote - Remote name (optional)
 * @param branch - Branch name (optional)
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Push result
 */
export async function gitPush(remote?: string, branch?: string, repoPath?: string): Promise<Result<PushResult, Error>> {
    try {
        const git = simpleGit(repoPath);
        const result = await git.push(remote, branch);
        return ok(result);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Pull from remote using simple-git.
 * @param remote - Remote name (optional)
 * @param branch - Branch name (optional)
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Pull result
 */
export async function gitPull(remote?: string, branch?: string, repoPath?: string): Promise<Result<PullResult, Error>> {
    try {
        const git = simpleGit(repoPath);
        const result = await git.pull(remote, branch);
        return ok(result);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Fetch from remote using simple-git.
 * @param remote - Remote name (optional)
 * @param branch - Branch name (optional)
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Fetch result
 */
export async function gitFetch(remote?: string, branch?: string, repoPath?: string): Promise<Result<FetchResult, Error>> {
    try {
        const git = simpleGit(repoPath);
        if (remote && branch) {
            const result = await git.fetch(remote, branch);
            return ok(result);
        }
        const result = await git.fetch();
        return ok(result);
    } catch (e) {
        return err(e as Error);
    }
}

/**
 * Get current branch name using simple-git.
 * @param repoPath - Repository path (defaults to cwd)
 * @returns Branch name
 */
export async function gitGetCurrentBranch(repoPath?: string): Promise<Result<string, Error>> {
    try {
        const git = simpleGit(repoPath);
        const branches = await git.branch();
        return ok(branches.current);
    } catch (e) {
        return err(e as Error);
    }
}
