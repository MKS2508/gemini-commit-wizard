/**
 * Tests for the setup wizard — covers F11.
 *
 * Verifies that:
 * - `gemini-commit init` generates a valid `.commit-wizard.json`
 * - Auto-detects components from a monorepo layout (`apps/`, `packages/`)
 * - Detects provider preference from env vars
 * - Honours `input` overrides (used in non-interactive mode)
 * - Refuses to overwrite without `--force`
 *
 * @module tests/setup-wizard
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
    runSetupWizard,
    detectComponents,
    detectProviderPreference,
    type ISetupPromptFn,
} from '../src/setup-wizard';
import { createTestRepo, type ITestRepo } from './test-utils';

describe('setup wizard', () => {
    let repo: ITestRepo;

    beforeEach(() => {
        repo = createTestRepo();
    });

    afterEach(() => {
        repo.cleanup();
    });

    describe('detectComponents', () => {
        it('finds components under apps/ and packages/', () => {
            mkdirSync(join(repo.path, 'apps/web'), { recursive: true });
            mkdirSync(join(repo.path, 'apps/api'), { recursive: true });
            mkdirSync(join(repo.path, 'packages/ui'), { recursive: true });
            // Add a file so the dir isn't empty
            writeFileSync(join(repo.path, 'apps/web/index.ts'), 'export const x = 1;\n');

            const components = detectComponents(repo.path);

            expect(components.length).toBeGreaterThan(0);
            const ids = components.map(c => c.id);
            expect(ids).toContain('web');
            expect(ids).toContain('api');
            expect(ids).toContain('ui');
        });

        it('returns empty when no monorepo layout exists', () => {
            const components = detectComponents(repo.path);
            expect(components).toEqual([]);
        });

        it('humanises kebab-case ids to title case', () => {
            mkdirSync(join(repo.path, 'apps/media-daemon'), { recursive: true });

            const components = detectComponents(repo.path);
            const daemon = components.find(c => c.id === 'media-daemon');

            expect(daemon).toBeDefined();
            expect(daemon?.name).toBe('Media Daemon');
        });
    });

    describe('detectProviderPreference', () => {
        it('prefers Gemini SDK when GEMINI_API_KEY is set', () => {
            const originalGemini = process.env.GEMINI_API_KEY;
            const originalGroq = process.env.GROQ_API_KEY;
            const originalOpen = process.env.OPENROUTER_API_KEY;

            process.env.GEMINI_API_KEY = 'fake-key';
            delete process.env.GROQ_API_KEY;
            delete process.env.OPENROUTER_API_KEY;

            try {
                const pref = detectProviderPreference();
                expect(pref?.provider).toBe('gemini-sdk');
                expect(pref?.model).toBe('gemini-2.5-flash');
            } finally {
                if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
                else delete process.env.GEMINI_API_KEY;
                if (originalGroq !== undefined) process.env.GROQ_API_KEY = originalGroq;
                if (originalOpen !== undefined) process.env.OPENROUTER_API_KEY = originalOpen;
            }
        });

        it('prefers Groq over OpenRouter when both keys are set', () => {
            const originalGemini = process.env.GEMINI_API_KEY;
            const originalGroq = process.env.GROQ_API_KEY;
            const originalOpen = process.env.OPENROUTER_API_KEY;

            // Clear Gemini so the priority resolves past it
            delete process.env.GEMINI_API_KEY;
            process.env.GROQ_API_KEY = 'fake-groq';
            process.env.OPENROUTER_API_KEY = 'fake-open';

            try {
                const pref = detectProviderPreference();
                expect(pref?.provider).toBe('groq');
            } finally {
                if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
                else delete process.env.GEMINI_API_KEY;
                if (originalGroq !== undefined) process.env.GROQ_API_KEY = originalGroq;
                else delete process.env.GROQ_API_KEY;
                if (originalOpen !== undefined) process.env.OPENROUTER_API_KEY = originalOpen;
                else delete process.env.OPENROUTER_API_KEY;
            }
        });

        it('returns null when no keys are set', () => {
            const originalGemini = process.env.GEMINI_API_KEY;
            const originalGroq = process.env.GROQ_API_KEY;
            const originalOpen = process.env.OPENROUTER_API_KEY;

            delete process.env.GEMINI_API_KEY;
            delete process.env.GROQ_API_KEY;
            delete process.env.OPENROUTER_API_KEY;

            try {
                const pref = detectProviderPreference();
                expect(pref).toBeNull();
            } finally {
                if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
                if (originalGroq !== undefined) process.env.GROQ_API_KEY = originalGroq;
                if (originalOpen !== undefined) process.env.OPENROUTER_API_KEY = originalOpen;
            }
        });
    });

    describe('runSetupWizard — dry run', () => {
        it('writes nothing and returns the resolved config (dryRun: true)', async () => {
            const result = await runSetupWizard({
                projectRoot: repo.path,
                dryRun: true,
                input: {
                    name: 'dryrun-test',
                    description: 'dry run',
                    techStack: ['TypeScript'],
                },
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.wrote).toBe(false);
                expect(result.value.config.name).toBe('dryrun-test');
            }

            const configPath = join(repo.path, '.commit-wizard.json');
            expect(existsSync(configPath)).toBe(false);
        });
    });

    describe('runSetupWizard — programmatic input', () => {
        it('writes the config file when input is provided', async () => {
            const result = await runSetupWizard({
                projectRoot: repo.path,
                input: {
                    name: 'prog-test',
                    description: 'programmatic test',
                    techStack: ['TypeScript', 'Bun'],
                    targetPlatform: 'CLI',
                    commitFormat: {
                        titleLanguage: 'english',
                        bodyLanguage: 'english',
                    },
                },
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.wrote).toBe(true);
            }

            const configPath = join(repo.path, '.commit-wizard.json');
            expect(existsSync(configPath)).toBe(true);

            const content = JSON.parse(readFileSync(configPath, 'utf-8'));
            expect(content.name).toBe('prog-test');
            expect(content.targetPlatform).toBe('CLI');
            expect(content.techStack).toContain('Bun');
            expect(content.commitFormat.bodyLanguage).toBe('english');
        });
    });

    describe('runSetupWizard — interactive (mocked promptFn)', () => {
        it('passes user answers through to the config', async () => {
            const mockPrompt: ISetupPromptFn = async () => ({
                name: 'from-prompt',
                description: 'interactive test',
                techStack: ['TypeScript', 'React'],
                targetPlatform: 'Web (Frontend)',
                titleLanguage: 'english',
                bodyLanguage: 'spanish',
                includeChangelog: true,
                noPush: true,
            });

            const result = await runSetupWizard({
                projectRoot: repo.path,
                promptFn: mockPrompt,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                const content = JSON.parse(
                    readFileSync(result.value.path, 'utf-8'),
                );
                expect(content.name).toBe('from-prompt');
                expect(content.targetPlatform).toBe('Web (Frontend)');
                expect(content.techStack).toContain('React');
                expect(content.commitFormat.titleLanguage).toBe('english');
                expect(content.commitFormat.bodyLanguage).toBe('spanish');
            }
        });

        it('refuses to overwrite without --force when config exists', async () => {
            // Pre-create an existing config
            const existingPath = join(repo.path, '.commit-wizard.json');
            writeFileSync(existingPath, JSON.stringify({
                name: 'existing',
                description: 'do not clobber',
                version: '1.0.0',
                techStack: ['TypeScript'],
                targetPlatform: 'Cross-platform',
            }), 'utf-8');

            const mockPrompt: ISetupPromptFn = async () => ({
                name: 'new-name',
                techStack: ['TypeScript'],
                targetPlatform: 'Cross-platform',
                titleLanguage: 'english',
                bodyLanguage: 'english',
                includeChangelog: true,
                noPush: false,
            });

            // First confirmFn returns false (no overwrite)
            let confirmCallCount = 0;
            const confirmingPrompt: ISetupPromptFn = async questions => {
                // Use mockPrompt for the first batch, then return false on overwrite
                if (questions.some(q => q.key === 'overwrite')) {
                    confirmCallCount++;
                    return { overwrite: false };
                }
                return mockPrompt(questions);
            };

            const result = await runSetupWizard({
                projectRoot: repo.path,
                promptFn: confirmingPrompt,
            });

            expect(result.ok).toBe(true);
            expect(confirmCallCount).toBeGreaterThan(0);
            if (result.ok) {
                expect(result.value.wrote).toBe(false);
            }

            // Original file untouched
            const after = JSON.parse(readFileSync(existingPath, 'utf-8'));
            expect(after.name).toBe('existing');
        });
    });
});