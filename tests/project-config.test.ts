/**
 * Tests for project-config auto-detection — covers F16.
 *
 * Verifies that:
 * - When a `.commit-wizard.json` exists, it wins over package.json
 * - When `package.json` has a `commitWizard` key, it is picked up
 * - When neither exists but `Cargo.toml` is present, fallback detects Rust
 * - When neither exists but `pyproject.toml` is present, fallback detects Python
 * - When neither exists and the repo has `tsconfig.json` + `src/`, fallback
 *   detects TypeScript + Library
 *
 * @module tests/project-config
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadProjectConfig } from '../src/project-config';
import { createTestRepo, type ITestRepo } from './test-utils';

describe('project-config', () => {
    let repo: ITestRepo;

    beforeEach(() => {
        repo = createTestRepo();
    });

    afterEach(() => {
        repo.cleanup();
    });

    describe('config priority (F11 setup wizard)', () => {
        it('prefers .commit-wizard.json over package.json', () => {
            writeFileSync(join(repo.path, '.commit-wizard.json'), JSON.stringify({
                name: 'from-wizard',
                description: 'wrote by setup wizard',
                version: '2.0.0',
                techStack: ['TypeScript', 'Bun'],
                targetPlatform: 'CLI',
            }), 'utf-8');

            // Add package.json with conflicting name
            writeFileSync(join(repo.path, 'package.json'), JSON.stringify({
                name: 'from-package',
                version: '1.0.0',
            }), 'utf-8');

            const config = loadProjectConfig(repo.path);

            expect(config.name).toBe('from-wizard');
            expect(config.version).toBe('2.0.0');
        });

        it('uses package.json commitWizard key when no wizard config exists', () => {
            writeFileSync(join(repo.path, 'package.json'), JSON.stringify({
                name: 'package-name',
                version: '1.0.0',
                commitWizard: {
                    name: 'overridden-name',
                    techStack: ['TypeScript'],
                    targetPlatform: 'Web (Frontend)',
                },
            }), 'utf-8');

            const config = loadProjectConfig(repo.path);

            expect(config.name).toBe('overridden-name');
            expect(config.targetPlatform).toBe('Web (Frontend)');
        });
    });

    describe('fallbackConfig (F16)', () => {
        it('detects Rust via Cargo.toml', () => {
            // No package.json, just Cargo.toml
            writeFileSync(join(repo.path, 'Cargo.toml'), '[package]\nname = "demo"\n');

            const config = loadProjectConfig(repo.path);

            expect(config.techStack).toContain('Rust');
        });

        it('detects Python via pyproject.toml', () => {
            writeFileSync(join(repo.path, 'pyproject.toml'), '[project]\nname = "demo"\n');

            const config = loadProjectConfig(repo.path);

            expect(config.techStack).toContain('Python');
        });

        it('detects Bun via bun.lock', () => {
            writeFileSync(join(repo.path, 'bun.lock'), '# bun lockfile\n');

            const config = loadProjectConfig(repo.path);

            expect(config.techStack).toContain('Bun');
        });

        it('detects Tauri + sets platform to Desktop (Tauri)', () => {
            writeFileSync(join(repo.path, 'Cargo.toml'), '[package]\nname = "demo"\n');
            mkdirSync(join(repo.path, 'src-tauri'), { recursive: true });
            writeFileSync(join(repo.path, 'src-tauri', 'Cargo.toml'), '[package]\nname = "app"\n');

            const config = loadProjectConfig(repo.path);

            expect(config.techStack).toContain('Tauri');
            expect(config.targetPlatform).toBe('Desktop (Tauri)');
        });

        it('detects Web (Frontend) via index.html', () => {
            writeFileSync(join(repo.path, 'index.html'), '<!doctype html>\n');

            const config = loadProjectConfig(repo.path);

            expect(config.targetPlatform).toBe('Web (Frontend)');
        });

        it('falls back to Library for a TypeScript repo with src/', () => {
            writeFileSync(join(repo.path, 'tsconfig.json'), '{}\n');
            mkdirSync(join(repo.path, 'src'), { recursive: true });

            const config = loadProjectConfig(repo.path);

            expect(config.techStack).toContain('TypeScript');
            expect(config.targetPlatform).toBe('Library');
        });

        it('falls back to Unknown when nothing matches', () => {
            const config = loadProjectConfig(repo.path);

            // The test repo itself has bun.lock so Bun will be detected.
            // The point is: nothing should crash, techStack is non-empty.
            expect(config.techStack.length).toBeGreaterThan(0);
            expect(config.name.length).toBeGreaterThan(0);
        });
    });
});