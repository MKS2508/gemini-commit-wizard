#!/usr/bin/env bun

/**
 * GitHub Release Manager — detects new versions in /releases
 * and creates GitHub releases automatically.
 *
 * @module github-release-manager
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { Logger } from '@mks2508/better-logger';
import { isErr, tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type {
    IReleaseInfo,
    IVersionData,
    IChangelogEntry,
    ReleaseErrorCode,
} from './types/index.js';

const log = new Logger();

/**
 * Manages creation of GitHub releases from local release directories.
 * Scans /releases for versioned folders and creates corresponding
 * GitHub releases with generated release notes.
 */
class GitHubReleaseManager {
    private projectRoot: string;
    private releasesDir: string;
    private changelogPath: string;

    /**
     * @param projectRoot - Root directory of the project (defaults to cwd)
     */
    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot || process.cwd();
        this.releasesDir = join(this.projectRoot, 'releases');
        this.changelogPath = join(this.projectRoot, 'public/data/changelog.json');
    }

    /**
     * Execute a gh CLI command.
     * @param args - Arguments for the gh command
     * @returns Command stdout
     */
    private async ghCommand(args: string[]): Promise<string> {
        const result = Bun.spawnSync(['gh', ...args], {
            cwd: this.projectRoot,
            stdout: 'pipe',
            stderr: 'pipe',
        });

        if (result.exitCode !== 0) {
            const error = result.stderr?.toString() || 'gh command failed';
            throw new Error(`GitHub CLI error: ${error}`);
        }

        return result.stdout?.toString().trim() || '';
    }

    /**
     * Verify gh CLI is installed and authenticated.
     */
    private async checkGitHubCLI(): Promise<void> {
        try {
            await this.ghCommand(['auth', 'status']);
            log.success('GitHub CLI authenticated');
        } catch (error) {
            log.error('GitHub CLI not installed or not authenticated');
            log.info('Install gh CLI: https://cli.github.com/');
            log.info('Authenticate with: gh auth login');
            throw error;
        }
    }

    /**
     * Get all existing releases from GitHub.
     * @returns Set of existing tag names
     */
    private async getExistingReleases(): Promise<Set<string>> {
        try {
            const output = await this.ghCommand(['release', 'list', '--json', 'tagName']);
            const releases = JSON.parse(output);
            return new Set(releases.map((r: any) => r.tagName));
        } catch {
            log.warn('Could not fetch existing releases');
            return new Set();
        }
    }

    /**
     * Scan the releases directory for available versions.
     * @returns Array of release info objects
     */
    private scanReleases(): IReleaseInfo[] {
        const releases: IReleaseInfo[] = [];

        if (!existsSync(this.releasesDir)) {
            log.warn('Releases directory does not exist');
            return releases;
        }

        const prefixes = readdirSync(this.releasesDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const prefix of prefixes) {
            const prefixDir = join(this.releasesDir, prefix);

            const versions = readdirSync(prefixDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const version of versions) {
                const versionDir = join(prefixDir, version);
                const readmePath = join(versionDir, 'README.md');

                if (existsSync(readmePath)) {
                    const files = readdirSync(versionDir)
                        .filter(file => file !== 'README.md')
                        .map(file => join(versionDir, file));

                    const fullVersion = prefix === 'stable' ? version : `${prefix}-${version}`;

                    releases.push({
                        version: fullVersion,
                        prefix: prefix === 'stable' ? undefined : prefix,
                        baseVersion: version,
                        path: versionDir,
                        files,
                        readme: readFileSync(readmePath, 'utf-8'),
                        isPrerelease: prefix !== 'stable',
                    });
                }
            }
        }

        return releases.sort((a, b) => b.version.localeCompare(a.version));
    }

    /**
     * Load changelog info for a specific version.
     * @param version - Version string to look up
     * @returns Version data or null
     */
    private getChangelogForVersion(version: string): IVersionData | null {
        try {
            const changelogData = JSON.parse(readFileSync(this.changelogPath, 'utf-8'));
            return changelogData.versions.find((v: IVersionData) => v.version === version) || null;
        } catch {
            log.warn(`Could not load changelog for ${version}`);
            return null;
        }
    }

    /**
     * Generate release notes from changelog and README.
     * @param release - Release info object
     * @returns Formatted release notes markdown
     */
    private generateReleaseNotes(release: IReleaseInfo): string {
        const changelog = this.getChangelogForVersion(release.version);

        let notes = `# Release ${release.version}\n\n`;

        if (changelog) {
            notes += `## Summary\n${changelog.title}\n\n`;

            const features = changelog.changes.filter(c => c.type === 'feature');
            const fixes = changelog.changes.filter(c => c.type === 'fix');
            const improvements = changelog.changes.filter(c => c.type === 'improvement');
            const breaking = changelog.changes.filter(c => c.type === 'breaking');

            if (features.length > 0) {
                notes += `## New Features\n`;
                features.forEach(f => notes += `- ${f.title}\n`);
                notes += '\n';
            }

            if (fixes.length > 0) {
                notes += `## Fixes\n`;
                fixes.forEach(f => notes += `- ${f.title}\n`);
                notes += '\n';
            }

            if (improvements.length > 0) {
                notes += `## Improvements\n`;
                improvements.forEach(i => notes += `- ${i.title}\n`);
                notes += '\n';
            }

            if (breaking.length > 0) {
                notes += `## Breaking Changes\n`;
                breaking.forEach(b => notes += `- ${b.title}\n`);
                notes += '\n';
            }
        }

        const readmeLines = release.readme.split('\n');
        const installIndex = readmeLines.findIndex(line => line.includes('## Instalación'));
        const compatIndex = readmeLines.findIndex(line => line.includes('## Compatibilidad'));

        if (installIndex !== -1) {
            notes += `## Installation\n\n`;
            const endIndex = compatIndex !== -1 ? compatIndex : readmeLines.length;
            const installSection = readmeLines.slice(installIndex + 1, endIndex);
            notes += installSection.join('\n') + '\n\n';
        }

        notes += `## Release Files\n\n`;
        release.files.forEach(file => {
            const fileName = basename(file);
            const stats = statSync(file);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
            notes += `- **${fileName}** (${sizeMB} MB)\n`;
        });

        notes += `\n---\n\n`;
        notes += `Date: ${changelog?.date || new Date().toISOString().split('T')[0]}\n`;

        if (release.isPrerelease) {
            notes += `\nNote: This is a ${release.prefix} pre-release. Not recommended for production.\n`;
        }

        return notes;
    }

    /**
     * Create a single GitHub release.
     * @param release - Release info object
     */
    private async createGitHubRelease(release: IReleaseInfo): Promise<void> {
        log.info(`Creating release ${release.version}...`);

        const tagName = `v${release.version}`;
        const title = `v${release.version}`;
        const notes = this.generateReleaseNotes(release);

        const notesFile = join(this.projectRoot, `.release-notes-${release.version}.md`);
        Bun.write(notesFile, notes);

        try {
            const args = [
                'release', 'create', tagName,
                '--title', title,
                '--notes-file', notesFile,
                ...release.files,
            ];

            if (release.isPrerelease) {
                args.push('--prerelease');
            }

            await this.ghCommand(args);
            log.success(`Release ${release.version} created`);

            await Bun.file(notesFile).write('');
        } catch (error) {
            log.error(`Failed to create release ${release.version}: ${error}`);
            throw error;
        }
    }

    /**
     * Process all local releases and create GitHub releases.
     * @param force - Whether to recreate existing releases
     * @returns Result with void or error
     */
    async processReleases(force = false): Promise<Result<void, ResultError<ReleaseErrorCode>>> {
        log.header('GitHub Release Manager', 'Process');
        log.divider();

        return tryCatchAsync(async () => {
            await this.checkGitHubCLI();

            const localReleases = this.scanReleases();
            log.info(`Found ${localReleases.length} local releases`);

            if (localReleases.length === 0) {
                log.success('No releases to process');
                return;
            }

            const existingReleases = await this.getExistingReleases();
            log.info(`${existingReleases.size} releases already on GitHub`);

            let created = 0;
            let skipped = 0;

            for (const release of localReleases) {
                const tagName = `v${release.version}`;

                if (existingReleases.has(tagName) && !force) {
                    log.info(`Release ${release.version} already exists, skipping`);
                    skipped++;
                    continue;
                }

                if (force && existingReleases.has(tagName)) {
                    log.info(`Deleting existing release ${release.version}...`);
                    try {
                        await this.ghCommand(['release', 'delete', tagName, '--yes']);
                    } catch {
                        log.warn(`Could not delete release ${tagName}`);
                    }
                }

                await this.createGitHubRelease(release);
                created++;

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            log.blank();
            log.box(
                [
                    `Created: ${created}`,
                    `Skipped: ${skipped}`,
                ].join('\n'),
                { title: 'Release Summary', borderStyle: 'rounded', borderColor: '#4488ff' },
            );
        }, 'RELEASE_ERROR');
    }
}

// ─── CLI Entry Point ─────────────────────────────────────────
if (import.meta.main) {
    const manager = new GitHubReleaseManager();

    const args = process.argv.slice(2);
    const force = args.includes('--force') || args.includes('-f');

    if (args.includes('--help') || args.includes('-h')) {
        log.header('GitHub Release Manager', 'Help');
        log.info('Usage: bun src/github-release-manager.ts [options]');
        log.blank();
        log.info('Options:');
        log.info('  --force, -f     Recreate existing releases');
        log.info('  --help, -h      Show this help');
        process.exit(0);
    }

    const result = await manager.processReleases(force);
    if (isErr(result)) {
        log.error(`Release manager failed: ${result.error.message}`);
        process.exit(1);
    }
}

export { GitHubReleaseManager };
