#!/usr/bin/env bun

/**
 * Loadable project configuration for gemini-commit-wizard.
 *
 * Loads config from (in priority order):
 * 1. `.commit-wizard.json` in project root
 * 2. `package.json` → `"commitWizard": { ... }` key
 * 3. Fallback to auto-detected config (scan package.json name/description)
 *
 * @module project-config
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Logger } from '@mks2508/better-logger';
import type { IProjectConfig } from './types/index.js';

const log = new Logger();

/**
 * Load project configuration from the project root.
 *
 * Priority order:
 * 1. `.commit-wizard.json` in projectRoot
 * 2. `package.json` → `commitWizard` key
 * 3. Auto-detect from `package.json` fields
 *
 * @param projectRoot - Path to the project root directory
 * @returns Resolved project configuration
 */
export function loadProjectConfig(projectRoot: string): IProjectConfig {
    // 1. Try .commit-wizard.json
    const wizardConfigPath = join(projectRoot, '.commit-wizard.json');
    if (existsSync(wizardConfigPath)) {
        try {
            const raw = readFileSync(wizardConfigPath, 'utf-8');
            const config = JSON.parse(raw) as Partial<IProjectConfig>;
            log.info('Loaded config from .commit-wizard.json');
            return fillDefaults(config);
        } catch (error) {
            log.warn(`Failed to parse .commit-wizard.json: ${error}`);
        }
    }

    // 2. Try package.json → commitWizard key
    const packageJsonPath = join(projectRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
        try {
            const raw = readFileSync(packageJsonPath, 'utf-8');
            const pkg = JSON.parse(raw);

            if (pkg.commitWizard && typeof pkg.commitWizard === 'object') {
                log.info('Loaded config from package.json → commitWizard');
                return fillDefaults(pkg.commitWizard as Partial<IProjectConfig>);
            }

            // 3. Auto-detect from package.json fields
            return autoDetectConfig(pkg, projectRoot);
        } catch (error) {
            log.warn(`Failed to parse package.json: ${error}`);
        }
    }

    // 4. Ultimate fallback
    return fallbackConfig(projectRoot);
}

/**
 * Fill missing fields with sensible defaults.
 * @param partial - Partial project configuration
 * @returns Full project configuration with defaults applied
 */
function fillDefaults(partial: Partial<IProjectConfig>): IProjectConfig {
    return {
        name: partial.name || 'Unknown Project',
        description: partial.description || 'Software project',
        version: partial.version || '0.0.0',
        techStack: partial.techStack || ['TypeScript'],
        targetPlatform: partial.targetPlatform || 'Cross-platform',
        components: partial.components,
        commitFormat: {
            titleLanguage: partial.commitFormat?.titleLanguage || 'english',
            bodyLanguage: partial.commitFormat?.bodyLanguage || 'spanish',
            includeTechnical: partial.commitFormat?.includeTechnical !== false,
            includeChangelog: partial.commitFormat?.includeChangelog !== false,
        },
        provider: partial.provider,
        model: partial.model,
    };
}

/**
 * Auto-detect project config from package.json fields.
 * @param pkg - Parsed package.json content
 * @param projectRoot - Project root directory
 * @returns Detected project configuration
 */
function autoDetectConfig(pkg: any, projectRoot: string): IProjectConfig {
    const techStack = detectTechStack(pkg);
    log.info(`Auto-detected config from package.json (${pkg.name || 'unknown'})`);

    return fillDefaults({
        name: pkg.name || 'Unknown Project',
        description: pkg.description || `Project at ${projectRoot}`,
        version: pkg.version || '0.0.0',
        techStack,
        targetPlatform: detectPlatform(pkg),
    });
}

/**
 * Detect tech stack from package.json dependencies.
 * @param pkg - Parsed package.json content
 * @returns Array of detected technology names
 */
function detectTechStack(pkg: any): string[] {
    const stack: string[] = [];
    const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
    };

    if (pkg.engines?.bun || allDeps['bun-types']) stack.push('Bun');
    else if (pkg.engines?.node) stack.push('Node.js');

    if (allDeps['typescript'] || allDeps['@types/node']) stack.push('TypeScript');
    else stack.push('JavaScript');

    if (allDeps['react'] || allDeps['react-dom']) stack.push('React');
    if (allDeps['next']) stack.push('Next.js');
    if (allDeps['vue']) stack.push('Vue');
    if (allDeps['svelte']) stack.push('Svelte');
    if (allDeps['express']) stack.push('Express');
    if (allDeps['elysia']) stack.push('Elysia');
    if (allDeps['hono']) stack.push('Hono');

    if (allDeps['vitest']) stack.push('Vitest');
    if (allDeps['tailwindcss']) stack.push('Tailwind CSS');
    if (allDeps['prisma'] || allDeps['@prisma/client']) stack.push('Prisma');
    if (allDeps['drizzle-orm']) stack.push('Drizzle');

    if (stack.length === 0) stack.push('JavaScript');

    return stack;
}

/**
 * Detect target platform from package.json hints.
 * @param pkg - Parsed package.json content
 * @returns Platform description string
 */
function detectPlatform(pkg: any): string {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps['react-native'] || allDeps['expo']) return 'Mobile (React Native)';
    if (allDeps['electron']) return 'Desktop (Electron)';
    if (allDeps['@tauri-apps/api']) return 'Desktop (Tauri)';
    if (allDeps['next'] || allDeps['nuxt']) return 'Web (Full-stack)';
    if (allDeps['react'] || allDeps['vue'] || allDeps['svelte']) return 'Web (Frontend)';
    if (allDeps['express'] || allDeps['elysia'] || allDeps['hono']) return 'Server (Backend)';

    return 'Cross-platform';
}

/**
 * Ultimate fallback when no package.json exists.
 * @param projectRoot - Project root directory
 * @returns Fallback project configuration
 */
function fallbackConfig(projectRoot: string): IProjectConfig {
    const dirName = projectRoot.split('/').pop() || 'project';
    log.info(`Using fallback config for "${dirName}"`);

    return fillDefaults({
        name: dirName,
        description: `Project at ${projectRoot}`,
    });
}
