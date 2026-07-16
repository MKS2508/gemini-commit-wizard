/**
 * Shared utilities for staging tests.
 *
 * Provides helpers to create a temp git repository on the fly so tests
 * can exercise real git behavior (branch detection, staging, push
 * prompts) without depending on the host repo state.
 *
 * @module tests/test-utils
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

/**
 * A isolated git repository for a single test.
 *
 * The repo has:
 * - One initial commit (`Initial commit`) on the active branch
 * - `git config user.email` / `user.name` set so commits don't fail
 *
 * Tests can add files, stage them, and run the staging module against
 * this directory just like a real project.
 */
export interface ITestRepo {
    /** Absolute path to the temp repo root */
    path: string;
    /** Cleanup function — must be called in afterEach / afterAll */
    cleanup: () => void;
    /** Run a git command against this repo, return stdout */
    git: (args: string[]) => string;
    /** Write a file under this repo, return its relative path */
    writeFile: (relPath: string, content: string) => string;
}

/**
 * Create a fresh isolated git repository in a temp dir.
 *
 * @param opts - Options (`branch` overrides the default branch name)
 * @returns A disposable test repo instance
 */
export function createTestRepo(opts: { branch?: string } = {}): ITestRepo {
    const branch = opts.branch ?? 'master';
    const dir = mkdtempSync(join(tmpdir(), 'gcw-test-'));

    const git = (args: string[]): string => {
        const result = spawnSync('git', args, {
            cwd: dir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (result.status !== 0) {
            throw new Error(
                `git ${args.join(' ')} failed: ${result.stderr?.toString() ?? 'unknown'}`,
            );
        }
        let out = result.stdout?.toString() ?? '';
        // Trim trailing newline only — preserve leading whitespace
        // because `git status --porcelain` uses it to encode the worktree
        // status (e.g. ` M path`).
        if (out.endsWith('\n')) out = out.slice(0, -1);
        return out;
    };

    git(['init', '--initial-branch', branch, '--quiet']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test User']);
    git(['config', 'commit.gpgsign', 'false']);

    // Seed with one initial commit so HEAD is valid
    writeFileSync(join(dir, 'README.md'), '# Test\n');
    git(['add', '--', 'README.md']);
    git(['commit', '-m', 'Initial commit', '--quiet']);

    const writeFile = (relPath: string, content: string): string => {
        const absPath = join(dir, relPath);
        writeFileSync(absPath, content);
        return relPath;
    };

    const cleanup = () => {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore — best effort
        }
    };

    return { path: dir, git, writeFile, cleanup };
}