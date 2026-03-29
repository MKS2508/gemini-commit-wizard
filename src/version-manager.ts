#!/usr/bin/env bun

/**
 * Version Manager — analyzes commits, extracts changelogs,
 * assigns versions, and updates configuration files.
 *
 * @module version-manager
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Logger } from '@mks2508/better-logger';
import { ok, err, isErr, tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type {
    IChangelogEntry,
    IVersion,
    IChangelogData,
    IVersionCommitInfo,
    VersionErrorCode,
} from './types/index.js';

const log = new Logger();

/**
 * Manages semantic versioning by analyzing git commits,
 * extracting changelog entries, and syncing version numbers
 * across configuration files.
 */
class VersionManager {
    private projectRoot: string;
    private changelogPath: string;
    private packageJsonPath: string;
    private tauriConfigPath: string;
    private cargoTomlPath: string;

    /**
     * @param projectRoot - Root directory of the project (defaults to cwd)
     */
    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot || process.cwd();
        this.changelogPath = join(this.projectRoot, 'changelog.json');
        this.packageJsonPath = join(this.projectRoot, 'package.json');
        this.tauriConfigPath = join(this.projectRoot, 'src-tauri/tauri.conf.json');
        this.cargoTomlPath = join(this.projectRoot, 'src-tauri/Cargo.toml');
    }

    /**
     * Execute a git command and return stdout.
     * @param args - Git command arguments
     * @returns Command stdout
     */
    private async gitCommand(args: string[]): Promise<string> {
        const result = Bun.spawnSync(['git', ...args], {
            cwd: this.projectRoot,
            stdout: 'pipe',
            stderr: 'pipe',
        });

        if (result.exitCode !== 0) {
            const error = result.stderr?.toString() || 'Git command failed';
            throw new Error(`Git error: ${error}`);
        }

        return result.stdout?.toString().trim() || '';
    }

    /**
     * Get all commits since a specific hash.
     * @param sinceHash - Starting commit hash (exclusive), or undefined for all
     * @returns Array of commit info objects
     */
    private async getCommitsSince(sinceHash?: string): Promise<IVersionCommitInfo[]> {
        const args = ['log', '--pretty=format:%H|%ci|%s', '--reverse'];
        if (sinceHash) {
            args.push(`${sinceHash}..HEAD`);
        }

        const output = await this.gitCommand(args);
        if (!output) return [];

        const commits: IVersionCommitInfo[] = [];

        for (const line of output.split('\n')) {
            const [hash, date, title] = line.split('|');
            if (!hash) continue;

            try {
                const fullMessage = await this.gitCommand(['log', '-1', '--pretty=format:%B', hash]);
                const sections = this.parseCommitMessage(fullMessage);

                commits.push({
                    hash,
                    date: new Date(date).toISOString().split('T')[0],
                    title,
                    description: fullMessage,
                    technical_section: sections.technical,
                    changelog_section: sections.changelog,
                });
            } catch {
                log.warn(`Could not read full message for commit ${hash}`);
                commits.push({
                    hash,
                    date: new Date(date).toISOString().split('T')[0],
                    title,
                    description: title,
                });
            }
        }

        return commits;
    }

    /**
     * Extract <technical> and <changelog> sections from a commit message.
     * @param message - Full commit message
     * @returns Extracted sections
     */
    private parseCommitMessage(message: string): { technical?: string; changelog?: string } {
        const technicalMatch = message.match(/<technical>([\s\S]*?)<\/technical>/);
        const changelogMatch = message.match(/<changelog>([\s\S]*?)<\/changelog>/);

        return {
            technical: technicalMatch?.[1]?.trim(),
            changelog: changelogMatch?.[1]?.trim(),
        };
    }

    /**
     * Convert changelog section text into structured entries.
     * @param changelog - Raw changelog section text
     * @returns Array of structured changelog entries
     */
    private parseChangelogSection(changelog: string): IChangelogEntry[] {
        if (!changelog) return [];

        const entries: IChangelogEntry[] = [];
        const lines = changelog.split('\n').map(line => line.trim()).filter(line => line);

        let currentSection = '';
        let currentEntries: string[] = [];

        for (const line of lines) {
            if (line.startsWith('##')) {
                if (currentSection && currentEntries.length > 0) {
                    entries.push(...this.processSectionEntries(currentSection, currentEntries));
                }
                currentSection = line.replace(/^##\s*/, '').toLowerCase();
                currentEntries = [];
            } else if (line.startsWith('-')) {
                currentEntries.push(line.replace(/^-\s*/, ''));
            }
        }

        if (currentSection && currentEntries.length > 0) {
            entries.push(...this.processSectionEntries(currentSection, currentEntries));
        }

        return entries;
    }

    /**
     * Process entries from a specific changelog section.
     * @param section - Section header text
     * @param entries - Array of entry strings
     * @returns Typed changelog entries
     */
    private processSectionEntries(section: string, entries: string[]): IChangelogEntry[] {
        let type: IChangelogEntry['type'] = 'improvement';

        if (section.includes('fix')) {
            type = 'fix';
        } else if (section.includes('feature')) {
            type = 'feature';
        } else if (section.includes('breaking')) {
            type = 'breaking';
        }

        return entries.map(entry => ({
            type,
            title: entry.split('.')[0] || entry,
            description: entry,
        }));
    }

    /**
     * Determine version bump type based on commit contents.
     * @param commits - Array of commits to analyze
     * @returns Detected version type
     */
    private determineVersionType(commits: IVersionCommitInfo[]): IVersion['type'] {
        const hasBreaking = commits.some(c =>
            c.changelog_section?.includes('breaking') ||
            c.title.toLowerCase().includes('breaking'),
        );

        if (hasBreaking) return 'major';

        const hasFeature = commits.some(c =>
            c.title.startsWith('feat(') ||
            c.changelog_section?.includes('feature'),
        );

        if (hasFeature) return 'minor';

        return 'patch';
    }

    /**
     * Increment version string according to type and prefix.
     * @param currentVersion - Current version string
     * @param type - Detected version type
     * @param targetPrefix - Optional target prefix override
     * @param overrideType - Optional type override
     * @returns New version string
     */
    private incrementVersion(
        currentVersion: string,
        type: IVersion['type'],
        targetPrefix?: string,
        overrideType?: IVersion['type'],
    ): string {
        const { prefix, baseVersion } = this.parseVersionString(currentVersion);
        const [major, minor, patch] = baseVersion.split('.').map(Number);
        const newPrefix = targetPrefix !== undefined ? targetPrefix : prefix;
        const actualType = overrideType || type;

        let newBaseVersion: string;
        switch (actualType) {
            case 'major':
                newBaseVersion = `${major + 1}.0.0`;
                break;
            case 'minor':
                newBaseVersion = `${major}.${minor + 1}.0`;
                break;
            case 'patch':
                newBaseVersion = `${major}.${minor}.${patch + 1}`;
                break;
            default:
                newBaseVersion = baseVersion;
        }

        return this.buildVersionString(newPrefix, newBaseVersion);
    }

    /**
     * Parse a version string with optional prefix.
     * @param version - Full version string (e.g. "alpha-1.2.3")
     * @returns Parsed prefix and base version
     */
    private parseVersionString(version: string): { prefix?: string; baseVersion: string } {
        const prefixMatch = version.match(/^(pre-alpha-|alpha-|beta-|rc-)?(.+)$/);
        if (prefixMatch) {
            return {
                prefix: prefixMatch[1]?.replace(/-$/, ''),
                baseVersion: prefixMatch[2],
            };
        }
        return { baseVersion: version };
    }

    /**
     * Build a version string with optional prefix.
     * @param prefix - Version prefix (e.g. "alpha")
     * @param baseVersion - Semver base (e.g. "1.2.3")
     * @returns Combined version string
     */
    private buildVersionString(prefix?: string, baseVersion?: string): string {
        if (!baseVersion) return '1.0.0';
        if (!prefix) return baseVersion;
        return `${prefix}-${baseVersion}`;
    }

    /**
     * Validate that a prefix transition is logical.
     * @param currentVersion - Current version string
     * @param targetPrefix - Target prefix to transition to
     */
    private validatePrefixTransition(currentVersion: string, targetPrefix?: string): void {
        const { prefix: currentPrefix } = this.parseVersionString(currentVersion);

        const prefixOrder = ['pre-alpha', 'alpha', 'beta', 'rc', undefined];
        const currentIndex = prefixOrder.indexOf(currentPrefix);
        const targetIndex = prefixOrder.indexOf(targetPrefix);

        if (currentIndex !== -1 && targetIndex !== -1 && targetIndex < currentIndex) {
            log.warn(`Regressive prefix transition ${currentPrefix || 'stable'} -> ${targetPrefix || 'stable'}`);
        }

        const validPrefixes = ['pre-alpha', 'alpha', 'beta', 'rc'];
        if (targetPrefix && !validPrefixes.includes(targetPrefix)) {
            throw new Error(`Invalid prefix: ${targetPrefix}. Valid: ${validPrefixes.join(', ')}, or empty for stable`);
        }
    }

    /**
     * Load existing changelog data from disk.
     * @returns Parsed changelog data
     */
    private loadChangelogData(): IChangelogData {
        if (existsSync(this.changelogPath)) {
            try {
                const content = readFileSync(this.changelogPath, 'utf-8');
                return JSON.parse(content);
            } catch {
                log.warn('Error reading changelog.json, creating new');
            }
        }

        return { current_version: '0.1.0', versions: [] };
    }

    /**
     * Get the last versioned commit hash.
     * @param data - Changelog data
     * @returns Commit hash or undefined
     */
    private getLastVersionedCommit(data: IChangelogData): string | undefined {
        const sortedVersions = [...data.versions].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        return sortedVersions[0]?.commit_hash;
    }

    /**
     * Analyze commits and create a new version entry.
     * @param options - Versioning options (type override, prefix)
     * @returns Result with void or error
     */
    async analyzeAndVersion(options: {
        type?: IVersion['type'];
        prefix?: string;
    } = {}): Promise<Result<void, ResultError<VersionErrorCode>>> {
        log.header('Version Manager', 'Analyze & Bump');
        log.divider();

        return tryCatchAsync(async () => {
            const changelogData = this.loadChangelogData();
            log.info(`Current version: ${changelogData.current_version}`);

            const lastVersionedCommit = this.getLastVersionedCommit(changelogData);
            log.info(`Last versioned commit: ${lastVersionedCommit || 'none'}`);

            const newCommits = await this.getCommitsSince(lastVersionedCommit);
            log.info(`Found ${newCommits.length} new commits`);

            if (newCommits.length === 0) {
                log.success('No new commits to version');
                return;
            }

            log.step(1, 4, 'Analyzing commits');
            for (const commit of newCommits) {
                log.info(`  ${commit.hash.slice(0, 7)} - ${commit.title}`);
            }

            const detectedVersionType = this.determineVersionType(newCommits);
            const finalVersionType = options.type || detectedVersionType;

            if (options.prefix !== undefined) {
                this.validatePrefixTransition(changelogData.current_version, options.prefix);
            }

            const newVersion = this.incrementVersion(
                changelogData.current_version,
                detectedVersionType,
                options.prefix,
                finalVersionType,
            );

            log.step(2, 4, 'Computing version');
            log.info(`${changelogData.current_version} -> ${newVersion}`);
            log.info(`Type detected: ${detectedVersionType}${options.type ? ` -> Forced: ${options.type}` : ''}`);

            log.step(3, 4, 'Processing changes');
            const allChanges: IChangelogEntry[] = [];
            let technicalNotes = '';

            for (const commit of newCommits) {
                if (commit.changelog_section) {
                    const changes = this.parseChangelogSection(commit.changelog_section);
                    allChanges.push(...changes);
                } else {
                    let type: IChangelogEntry['type'] = 'improvement';
                    if (commit.title.startsWith('feat(')) type = 'feature';
                    else if (commit.title.startsWith('fix(')) type = 'fix';

                    allChanges.push({
                        type,
                        title: commit.title.replace(/^(feat|fix|refactor)\([^)]+\)\s*-\s*/, ''),
                        description: commit.title,
                    });
                }

                if (commit.technical_section) {
                    technicalNotes += `\n${commit.technical_section}`;
                }
            }

            const { prefix } = this.parseVersionString(newVersion);
            const newVersionEntry: IVersion = {
                version: newVersion,
                date: new Date().toISOString().split('T')[0],
                type: finalVersionType,
                title: this.generateVersionTitle(allChanges, finalVersionType, prefix),
                changes: allChanges,
                technical_notes: technicalNotes.trim(),
                breaking_changes: allChanges
                    .filter(c => c.type === 'breaking')
                    .map(c => c.description),
                commit_hash: newCommits[newCommits.length - 1].hash,
                prefix,
            };

            changelogData.current_version = newVersion;
            changelogData.versions.unshift(newVersionEntry);

            writeFileSync(this.changelogPath, JSON.stringify(changelogData, null, 2));
            log.info(`Changelog updated: ${this.changelogPath}`);

            log.step(4, 4, 'Syncing version files');
            await this.updateAllVersionFiles(newVersion);

            log.blank();
            log.box(
                [
                    `Version: ${newVersion}`,
                    `Changes: ${allChanges.length}`,
                    `Commits: ${newCommits.length}`,
                ].join('\n'),
                { title: 'Version Complete', borderStyle: 'rounded', borderColor: '#00ff00' },
            );
        }, 'VERSION_ERROR');
    }

    /**
     * Generate a descriptive title for a version.
     * @param changes - Array of changelog entries
     * @param type - Version type
     * @param prefix - Version prefix
     * @returns Version title string
     */
    private generateVersionTitle(changes: IChangelogEntry[], type: IVersion['type'], prefix?: string): string {
        const features = changes.filter(c => c.type === 'feature');
        const fixes = changes.filter(c => c.type === 'fix');
        const improvements = changes.filter(c => c.type === 'improvement');

        const prefixLabel = prefix
            ? `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} - `
            : '';

        if (type === 'major') {
            return `${prefixLabel}Major update with significant changes`;
        }

        if (features.length > 0) {
            const mainFeature = features[0].title;
            if (features.length === 1) {
                return `${prefixLabel}New feature: ${mainFeature}`;
            }
            return `${prefixLabel}New features including ${mainFeature} and ${features.length - 1} more`;
        }

        if (fixes.length > 0) {
            if (fixes.length === 1) {
                return `${prefixLabel}Fix: ${fixes[0].title}`;
            }
            return `${prefixLabel}Fixes and improvements (${fixes.length} fixes, ${improvements.length} improvements)`;
        }

        return `${prefixLabel}Improvements and optimizations`;
    }

    /**
     * Sync version across all configuration files.
     * @param version - New version string
     */
    private async updateAllVersionFiles(version: string): Promise<void> {
        log.info(`Syncing version ${version} across files...`);

        await this.updatePackageVersion(version);

        if (existsSync(this.tauriConfigPath)) {
            await this.updateTauriVersion(version);
        }

        if (existsSync(this.cargoTomlPath)) {
            await this.updateCargoVersion(version);
        }

        log.info(`All versions synced to ${version}`);
    }

    /**
     * Update version in package.json.
     * @param version - New version string
     */
    private async updatePackageVersion(version: string): Promise<void> {
        const packageJson = JSON.parse(readFileSync(this.packageJsonPath, 'utf-8'));
        packageJson.version = version;
        writeFileSync(this.packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        log.info(`Updated package.json -> ${version}`);
    }

    /**
     * Update version in tauri.conf.json (semver only, no prefix).
     * @param version - New version string
     */
    private async updateTauriVersion(version: string): Promise<void> {
        const tauriConfig = JSON.parse(readFileSync(this.tauriConfigPath, 'utf-8'));
        const { baseVersion } = this.parseVersionString(version);
        tauriConfig.version = baseVersion;
        writeFileSync(this.tauriConfigPath, JSON.stringify(tauriConfig, null, 2) + '\n');
        log.info(`Updated tauri.conf.json -> ${baseVersion}`);
    }

    /**
     * Update version in Cargo.toml (semver only, no prefix).
     * @param version - New version string
     */
    private async updateCargoVersion(version: string): Promise<void> {
        const cargoContent = readFileSync(this.cargoTomlPath, 'utf-8');
        const { baseVersion } = this.parseVersionString(version);
        const updatedContent = cargoContent.replace(
            /^version\s*=\s*"[^"]*"/m,
            `version = "${baseVersion}"`,
        );
        writeFileSync(this.cargoTomlPath, updatedContent);
        log.info(`Updated Cargo.toml -> ${baseVersion}`);
    }

    /**
     * Sync all config files with the current changelog version.
     * @returns Result with void or error
     */
    async syncVersionFiles(): Promise<Result<void, ResultError<VersionErrorCode>>> {
        log.header('Version Manager', 'Sync Files');

        return tryCatchAsync(async () => {
            const changelogData = this.loadChangelogData();
            const currentVersion = changelogData.current_version;

            log.info(`Current changelog version: ${currentVersion}`);
            await this.updateAllVersionFiles(currentVersion);
            log.success(`All files synced to ${currentVersion}`);
        }, 'VERSION_ERROR');
    }

    /**
     * Initialize changelog from full git history.
     * @returns Result with void or error
     */
    async initializeFromHistory(): Promise<Result<void, ResultError<VersionErrorCode>>> {
        log.header('Version Manager', 'Init from History');

        return tryCatchAsync(async () => {
            const allCommits = await this.getCommitsSince();
            log.info(`Found ${allCommits.length} total commits in history`);

            if (allCommits.length === 0) {
                log.success('No commits to process');
                return;
            }

            const versionGroups = this.groupCommitsIntoVersions(allCommits);
            log.info(`Grouped into ${versionGroups.length} logical versions`);

            const changelogData: IChangelogData = {
                current_version: '0.1.0',
                versions: [],
            };

            for (let i = 0; i < versionGroups.length; i++) {
                const group = versionGroups[i];
                const versionNumber = this.generateVersionNumber(i, versionGroups.length);

                const allChanges: IChangelogEntry[] = [];
                let technicalNotes = '';

                for (const commit of group.commits) {
                    if (commit.changelog_section) {
                        const changes = this.parseChangelogSection(commit.changelog_section);
                        allChanges.push(...changes);
                    } else {
                        let type: IChangelogEntry['type'] = 'improvement';
                        if (commit.title.startsWith('feat(')) type = 'feature';
                        else if (commit.title.startsWith('fix(')) type = 'fix';

                        allChanges.push({
                            type,
                            title: commit.title.replace(/^(feat|fix|refactor)\([^)]+\)\s*-\s*/, ''),
                            description: commit.title,
                        });
                    }

                    if (commit.technical_section) {
                        technicalNotes += `\n${commit.technical_section}`;
                    }
                }

                const version: IVersion = {
                    version: versionNumber,
                    date: group.date,
                    type: group.type,
                    title: group.title,
                    changes: allChanges,
                    technical_notes: technicalNotes.trim(),
                    breaking_changes: allChanges
                        .filter(c => c.type === 'breaking')
                        .map(c => c.description),
                    commit_hash: group.commits[group.commits.length - 1].hash,
                };

                changelogData.versions.push(version);
            }

            if (changelogData.versions.length > 0) {
                changelogData.current_version = changelogData.versions[0].version;
            }

            writeFileSync(this.changelogPath, JSON.stringify(changelogData, null, 2));
            log.info(`Changelog initialized: ${this.changelogPath}`);

            await this.updateAllVersionFiles(changelogData.current_version);

            log.blank();
            log.box(
                [
                    `Current version: ${changelogData.current_version}`,
                    `Versions created: ${changelogData.versions.length}`,
                ].join('\n'),
                { title: 'Init Complete', borderStyle: 'rounded', borderColor: '#00ff00' },
            );
        }, 'VERSION_ERROR');
    }

    /**
     * Group commits into logical version groups.
     * @param commits - Array of all commits
     * @returns Grouped commits
     */
    private groupCommitsIntoVersions(commits: IVersionCommitInfo[]): Array<{
        commits: IVersionCommitInfo[];
        date: string;
        type: IVersion['type'];
        title: string;
    }> {
        const groups: Array<{
            commits: IVersionCommitInfo[];
            date: string;
            type: IVersion['type'];
            title: string;
        }> = [];

        let currentGroup: IVersionCommitInfo[] = [];
        let currentDate = '';

        for (let i = 0; i < commits.length; i++) {
            const commit = commits[i];

            if (!currentDate || this.daysDifference(currentDate, commit.date) > 7 || currentGroup.length >= 10) {
                if (currentGroup.length > 0) {
                    groups.push({
                        commits: [...currentGroup],
                        date: currentDate,
                        type: this.determineVersionType(currentGroup),
                        title: this.generateGroupTitle(currentGroup),
                    });
                }
                currentGroup = [commit];
                currentDate = commit.date;
            } else {
                currentGroup.push(commit);
            }
        }

        if (currentGroup.length > 0) {
            groups.push({
                commits: currentGroup,
                date: currentDate,
                type: this.determineVersionType(currentGroup),
                title: this.generateGroupTitle(currentGroup),
            });
        }

        return groups.reverse();
    }

    /**
     * Calculate difference in days between two date strings.
     * @param date1 - First date string
     * @param date2 - Second date string
     * @returns Absolute difference in days
     */
    private daysDifference(date1: string, date2: string): number {
        const d1 = new Date(date1).getTime();
        const d2 = new Date(date2).getTime();
        return Math.abs((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    /**
     * Generate a title for a commit group.
     * @param commits - Group of commits
     * @returns Group title string
     */
    private generateGroupTitle(commits: IVersionCommitInfo[]): string {
        const features = commits.filter(c => c.title.startsWith('feat('));
        const fixes = commits.filter(c => c.title.startsWith('fix('));

        if (features.length > 0) return 'New features and improvements';
        if (fixes.length > 0) return 'Fixes and optimizations';
        return 'System improvements';
    }

    /**
     * Generate version number for initialization.
     * @param index - Group index
     * @param total - Total number of groups
     * @returns Version number string
     */
    private generateVersionNumber(index: number, total: number): string {
        if (total === 1) return '1.0.0';
        if (index === 0) return '1.0.0';
        if (index < 3) return `0.${9 - index}.0`;

        const patchVersion = Math.max(1, total - index);
        return `0.1.${patchVersion}`;
    }
}

// ─── CLI Entry Point ─────────────────────────────────────────
if (import.meta.main) {
    const manager = new VersionManager();

    const args = process.argv.slice(2);
    const isInit = args.includes('--init') || args.includes('-i');
    const isSync = args.includes('--sync') || args.includes('-s');

    const typeIndex = args.indexOf('--type');
    const type = typeIndex > -1 && args[typeIndex + 1] ? args[typeIndex + 1] as IVersion['type'] : undefined;

    const prefixIndex = args.indexOf('--prefix');
    const prefix = prefixIndex > -1 ? (args[prefixIndex + 1] || '') : undefined;

    if (type && !['major', 'minor', 'patch'].includes(type)) {
        log.error(`Invalid version type: ${type}. Valid: major, minor, patch`);
        process.exit(1);
    }

    if (args.includes('--help') || args.includes('-h')) {
        log.header('Version Manager', 'Help');
        log.info('Usage: bun src/version-manager.ts [options]');
        log.blank();
        log.info('Options:');
        log.info('  --init, -i              Initialize from full history');
        log.info('  --sync, -s              Sync config files with current version');
        log.info('  --type <type>           Force version type (major|minor|patch)');
        log.info('  --prefix <prefix>       Change prefix (pre-alpha|alpha|beta|rc|empty for stable)');
        log.info('  --help, -h              Show this help');
        process.exit(0);
    }

    let result;
    if (isInit) {
        result = await manager.initializeFromHistory();
    } else if (isSync) {
        result = await manager.syncVersionFiles();
    } else {
        result = await manager.analyzeAndVersion({
            type,
            prefix: prefix === '' ? undefined : prefix,
        });
    }

    if (isErr(result)) {
        log.error(`Version manager failed: ${result.error.message}`);
        process.exit(1);
    }
}

export { VersionManager };
