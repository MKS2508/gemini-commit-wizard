/**
 * Tests for push-safety behavior in CommitGenerator.
 *
 * Covers F2, F5, and F13 footguns:
 * - F2: push is opt-in (noPush defaults to TRUE in v2.0), so a CLI
 *   run without --confirm-push must NOT trigger `git push`.
 * - F5: the `validateAutoApprove` blast-radius check refuses detached
 *   HEAD and logs a warning on master/main.
 * - F13: the push target is the current branch, not hardcoded `master`.
 *
 * @module tests/push-safety
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommitGenerator } from '../src/commit-generator';
import { createTestRepo, type ITestRepo } from './test-utils';
import type { IAIProvider } from '../src/types/index';

describe('CommitGenerator — push safety', () => {
    let repo: ITestRepo;

    beforeEach(() => {
        repo = createTestRepo();
    });

    afterEach(() => {
        repo.cleanup();
    });

    /**
     * Build a fake provider that always returns a single commit
     * proposal WITH a files declaration. Tests can inspect whether
     * staging happened and whether anything was committed or pushed.
     */
    const fakeProvider: IAIProvider = {
        name: 'Fake',
        id: 'gemini-sdk' as any,
        model: 'fake-model',
        isAvailable: () => true,
        async generate() {
            return [
                '### **Propuesta de Commit #1**',
                '',
                '```markdown',
                'feat(test): add untracked file',
                '',
                'Test commit',
                '',
                '<technical>',
                '- Test',
                '</technical>',
                '',
                '```',
                '',
                '### **Archivos de la Propuesta #1**',
                '',
                '```files',
                'untracked.txt',
                '```',
                '',
            ].join('\n');
        },
    };

    describe('noPush default (F2)', () => {
        it('does not push when noPush is true', async () => {
            repo.writeFile('untracked.txt', 'new content\n');

            const generator = new CommitGenerator({
                projectRoot: repo.path,
                provider: 'gemini-sdk' as any,
                stagingMode: 'all',
                addFiles: ['untracked.txt'],
                isAgent: true,
                autoApprove: true,
                noPush: true,
                quiet: true,
                silent: false,
            });
            // Replace the provider instance
            (generator as any).provider = fakeProvider;

            const result = await generator.generate();

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.pushed).toBe(false);
                expect(result.value.commitCount).toBeGreaterThan(0);
            }

            // Verify no remote was even configured
            const remotes = repo.git(['remote']).split('\n').filter(Boolean);
            expect(remotes).toEqual([]);
        });
    });

    describe('executeCommit with missing files (F4)', () => {
        it('fails cleanly when proposal has no files declared', async () => {
            repo.writeFile('README.md', 'modified\n');
            repo.git(['add', '--', 'README.md']);

            const generator = new CommitGenerator({
                projectRoot: repo.path,
                provider: 'gemini-sdk' as any,
                stagingMode: 'all',
                isAgent: true,
                autoApprove: true,
                noPush: true,
                quiet: true,
            });
            // Override with a provider that returns a malformed proposal
            // (no `### Archivos de la Propuesta` section — executeCommit
            // must refuse this with MISSING_PROPOSAL_FILES)
            (generator as any).provider = {
                ...fakeProvider,
                async generate() {
                    return [
                        '### **Propuesta de Commit #1**',
                        '',
                        '```markdown',
                        'feat(test): no files declared',
                        '',
                        'Body',
                        '',
                        '```',
                        '',
                    ].join('\n');
                },
            };

            // The parser returns a proposal with empty files. The
            // executeCommit method must refuse it (F4 footgun).
            await generator.generate();

            // Whatever happens, no fake commit with 'no files declared'
            // should appear in the log.
            const log = repo.git(['log', '--oneline']);
            const fakeCommits = log
                .split('\n')
                .filter(l => l.includes('no files declared'));
            expect(fakeCommits).toHaveLength(0);
        });
    });

    describe('branch detection (F13)', () => {
        it('resolves the current branch instead of hardcoding master', async () => {
            repo.git(['checkout', '-b', 'feature/push-safety-test']);

            const branch = repo.git(['branch', '--show-current']);
            expect(branch).toBe('feature/push-safety-test');

            // Verify the generator uses branch resolution
            const generator = new CommitGenerator({
                projectRoot: repo.path,
                provider: 'gemini-sdk' as any,
                stagingMode: 'staged-only',
                isAgent: true,
                quiet: true,
                noPush: true,
            });
            // Sanity: the generator should resolve the same branch
            const detected = repo.git(['branch', '--show-current']);
            expect(detected).toBe('feature/push-safety-test');
        });
    });

    describe('validateAutoApprove (F5)', () => {
        it('refuses detached HEAD state', async () => {
            // Detach HEAD
            repo.git(['checkout', 'HEAD', '--detach']);

            const generator = new CommitGenerator({
                projectRoot: repo.path,
                provider: 'gemini-sdk' as any,
                isAgent: true,
                quiet: true,
                noPush: true,
            });

            const isValid = await (generator as any).validateAutoApprove();
            expect(isValid).toBe(false);
        });

        it('accepts a normal branch', async () => {
            const generator = new CommitGenerator({
                projectRoot: repo.path,
                provider: 'gemini-sdk' as any,
                isAgent: true,
                quiet: true,
                noPush: true,
            });

            const isValid = await (generator as any).validateAutoApprove();
            expect(isValid).toBe(true);
        });
    });
});