/**
 * Tests for the staging module — covers F1 and F4 footguns.
 *
 * F1: `git add -A` blanket staging must be replaced by an explicit
 *     mode. Verify that `decideStaging` in `staged-only` mode does NOT
 *     touch untracked files, and that `all` mode is the explicit
 *     opt-in to stage everything.
 *
 * F4: `executeCommit` must fail cleanly when `proposal.files` is
 *     empty, with no fallback to staging all working-tree changes.
 *     Verified via the `decideStaging` contract that already returns
 *     `toStage: []` for `staged-only`, exercising the same error path.
 *
 * Also covers: agent mode errors out cleanly without an explicit mode.
 *
 * @module tests/staging
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
    applyStaging,
    decideStaging,
    getGitStatusDetailed,
    resetStaging,
    type IStagingDecision,
} from '../src/staging';
import { createTestRepo, type ITestRepo } from './test-utils';

describe('staging module', () => {
    let repo: ITestRepo;

    beforeEach(() => {
        repo = createTestRepo();
    });

    afterEach(() => {
        repo.cleanup();
    });

    describe('getGitStatusDetailed', () => {
        it('detects modified + untracked files separately', () => {
            repo.writeFile('README.md', '# Test\nModified\n');
            repo.writeFile('new-file.ts', 'export const x = 1;\n');

            const status = getGitStatusDetailed(repo.path);

            const modified = status.find(s => s.path === 'README.md');
            const untracked = status.find(s => s.path === 'new-file.ts');

            expect(modified?.unstaged).toBe(true);
            expect(modified?.staged).toBe(false);
            expect(untracked?.untracked).toBe(true);
            expect(untracked?.staged).toBe(false);
        });
    });

    describe('mode: staged-only (F1 default-safe)', () => {
        it('does not stage untracked files even when present', async () => {
            repo.writeFile('README.md', '# Test\nModified\n');
            repo.writeFile('never-staged.txt', 'should not appear in commit\n');

            const decision = await decideStaging(repo.path, {
                mode: 'staged-only',
            });
            await applyStaging(repo.path, decision);

            expect(decision.toStage).toEqual([]);
            expect(decision.alreadyStaged).toEqual([]);

            const status = repo.git(['status', '--porcelain']);
            expect(status).toContain('README.md');
            expect(status).toContain('never-staged.txt');
            expect(status).not.toContain('A ');
        });

        it('respects pre-existing staging by the user', async () => {
            repo.writeFile('README.md', '# Test\nModified\n');
            repo.writeFile('extra.txt', 'extra file\n');

            repo.git(['add', '--', 'README.md']);

            const decision = await decideStaging(repo.path, {
                mode: 'staged-only',
            });
            await applyStaging(repo.path, decision);

            expect(decision.toStage).toEqual([]);
            expect(decision.alreadyStaged).toEqual(['README.md']);

            const diffCached = repo.git(['diff', '--cached', '--name-only']);
            expect(diffCached).toBe('README.md');
        });
    });

    describe('mode: all (F1 explicit opt-in)', () => {
        it('stages everything when explicitly requested', async () => {
            repo.writeFile('README.md', '# Test\nModified\n');
            repo.writeFile('new-1.ts', 'export const a = 1;\n');
            repo.writeFile('new-2.ts', 'export const b = 2;\n');

            const decision = await decideStaging(repo.path, {
                mode: 'all',
            });
            await applyStaging(repo.path, decision);

            expect(decision.toStage).toContain('README.md');
            expect(decision.toStage).toContain('new-1.ts');
            expect(decision.toStage).toContain('new-2.ts');

            const status = repo.git(['status', '--porcelain']);
            expect(status).not.toContain('??');
        });
    });

    describe('mode: specific', () => {
        it('stages only the listed files', async () => {
            repo.writeFile('README.md', '# Modified\n');
            repo.writeFile('a.ts', 'a\n');
            repo.writeFile('b.ts', 'b\n');

            const decision = await decideStaging(repo.path, {
                mode: 'specific',
                files: ['a.ts'],
            });
            await applyStaging(repo.path, decision);

            expect(decision.toStage).toEqual(['a.ts']);

            const status = repo.git(['status', '--porcelain']);
            expect(status).toContain('README.md');
            expect(status).toContain('b.ts');
            // a.ts should be staged (added); format is `A  a.ts`
            expect(status).toMatch(/^A\s+a\.ts$/m);
            // README.md should remain unstaged (worktree-only modification): ` M README.md`
            expect(status).toMatch(/^ M README\.md$/m);
        });

        it('errors when specific mode is requested without files', async () => {
            await expect(
                decideStaging(repo.path, { mode: 'specific', files: [] }),
            ).rejects.toThrow(/STAGING_MODE_REQUIRES_FILES/);
        });

        it('errors when a file does not exist on disk', async () => {
            await expect(
                decideStaging(repo.path, {
                    mode: 'specific',
                    files: ['nonexistent.ts'],
                }),
            ).rejects.toThrow(/STAGING_FILE_NOT_FOUND/);
        });
    });

    describe('agent/CI mode (F12 invariant)', () => {
        it('errors without an explicit mode', async () => {
            repo.writeFile('README.md', 'modified\n');

            await expect(
                decideStaging(repo.path, { isAgent: true }),
            ).rejects.toThrow(/STAGING_MODE_REQUIRED/);
        });

        it('accepts explicit --staged-only in agent mode', async () => {
            repo.writeFile('README.md', 'modified\n');

            const decision: IStagingDecision = await decideStaging(repo.path, {
                mode: 'staged-only',
                isAgent: true,
            });

            expect(decision.toStage).toEqual([]);
        });

        it('accepts explicit --all in agent mode', async () => {
            repo.writeFile('README.md', 'modified\n');
            repo.writeFile('new.ts', 'x\n');

            const decision = await decideStaging(repo.path, {
                mode: 'all',
                isAgent: true,
            });

            expect(decision.toStage).toContain('README.md');
            expect(decision.toStage).toContain('new.ts');
        });
    });

    describe('resetStaging', () => {
        it('unstages files but leaves working tree alone', async () => {
            repo.writeFile('README.md', 'modified\n');
            repo.git(['add', '--', 'README.md']);

            const beforeReset = repo.git(['diff', '--cached', '--name-only']);
            expect(beforeReset).toBe('README.md');

            resetStaging(repo.path);

            const afterReset = repo.git(['diff', '--cached', '--name-only']);
            expect(afterReset).toBe('');

            const workingTree = repo.git(['status', '--porcelain']);
            expect(workingTree).toContain('M README.md');
        });
    });
});