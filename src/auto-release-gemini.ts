#!/usr/bin/env bun

/**
 * Auto-Release Manager with AI integration.
 * Advanced system that uses AI for documentation generation
 * and intelligent commits.
 *
 * @module auto-release-gemini
 */

import { spawn } from 'bun';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Logger } from '@mks2508/better-logger';
import { isErr, tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import { createReleasePrompt, TPV_PROJECT_CONFIG } from './prompt-templates';
import type { IGeminiPromptConfig, IAutoReleaseInfo, ReleaseErrorCode } from './types/index.js';

const log = new Logger();

/** Internal changelog data shape */
interface IChangelogData {
    current_version: string;
    versions: Array<{
        version: string;
        date: string;
        type: string;
        title: string;
        changes: Array<{
            type: string;
            title: string;
            description: string;
        }>;
        technical_notes: string;
        breaking_changes: string[];
        commit_hash: string;
        prefix?: string;
    }>;
}

/**
 * Automates the full release cycle: pull, build, create release structure,
 * generate documentation (with optional AI), commit, push, and create
 * GitHub releases.
 */
class AutoReleaseManagerAI {
    private projectRoot: string;
    private releaseDir: string;
    private changelogPath: string;
    private tempDir: string;
    private forceMode: boolean;
    private useAI: boolean;
    private noGitHub: boolean;

    /**
     * @param options - CLI-derived options
     */
    constructor(options: {
        force?: boolean;
        useAI?: boolean;
        noGitHub?: boolean;
        projectRoot?: string;
    } = {}) {
        this.projectRoot = options.projectRoot || process.cwd();
        this.releaseDir = join(this.projectRoot, 'releases');
        this.changelogPath = join(this.projectRoot, 'public/data/changelog.json');
        this.tempDir = join(this.projectRoot, 'project-utils/.temp');
        this.forceMode = options.force || false;
        this.useAI = options.useAI !== false;
        this.noGitHub = options.noGitHub || false;

        if (!existsSync(this.tempDir)) {
            mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Run the full auto-release pipeline.
     * @returns Result with void or error
     */
    async run(): Promise<Result<void, ResultError<ReleaseErrorCode>>> {
        log.header('Auto-Release Manager', this.useAI ? 'AI Mode' : 'Basic Mode');
        log.divider();

        return tryCatchAsync(async () => {
            log.step(1, 8, 'Pulling remote changes');
            await this.pullRemoteChanges();

            log.step(2, 8, 'Installing dependencies');
            await this.installDependencies();

            log.step(3, 8, 'Checking versions');
            const currentVersion = this.getCurrentVersion();
            log.info(`Current version: ${currentVersion}`);

            const latestRelease = this.getLatestRelease();
            log.info(`Latest release: ${latestRelease || 'none'}`);

            if (latestRelease === currentVersion && !this.forceMode) {
                log.success('No new version to build. Release already exists.');
                log.info('Use --force to rebuild.');
                return;
            }

            if (this.forceMode && latestRelease === currentVersion) {
                log.warn('Force mode: regenerating existing release...');
            } else {
                log.info(`New version detected: ${currentVersion}`);
            }

            log.step(4, 8, 'Building application');
            await this.buildApplication();

            log.step(5, 8, 'Creating release structure');
            const releaseInfo = this.parseVersion(currentVersion);
            await this.createReleaseStructure(releaseInfo);

            log.step(6, 8, 'Copying executables');
            await this.copyExecutables(releaseInfo);

            log.step(7, 8, 'Generating documentation');
            await this.generateReleaseDocumentation(releaseInfo);

            log.step(8, 8, 'Commit, push & GitHub release');
            await this.commitAndPushReleaseAI(releaseInfo);
            await this.createGitHubRelease(releaseInfo);

            log.blank();
            log.box(
                [
                    `Version: ${currentVersion}`,
                    `AI: ${this.useAI ? 'enabled' : 'disabled'}`,
                    `GitHub: ${this.noGitHub ? 'skipped' : 'created'}`,
                ].join('\n'),
                { title: 'Release Complete', borderStyle: 'rounded', borderColor: '#00ff00' },
            );
        }, 'RELEASE_ERROR');
    }

    /**
     * Pull remote changes and sync local repo.
     */
    private async pullRemoteChanges(): Promise<void> {
        try {
            await this.runCommand('git', ['fetch', 'origin']);
            const result = await this.runCommand('git', ['log', 'HEAD..origin/master', '--oneline']);

            if (result.stdout.trim()) {
                log.info('Remote changes detected. Updating...');

                const statusResult = await this.runCommand('git', ['status', '--porcelain']);
                if (statusResult.stdout.trim()) {
                    log.info('Stashing local changes...');
                    await this.runCommand('git', ['stash', 'push', '-m', 'auto-release-stash']);
                }

                await this.runCommand('git', ['pull', 'origin', 'master']);
                log.success('Repository updated');
            } else {
                log.success('Repository up to date');
            }
        } catch (error) {
            throw new Error(`Failed to update repository: ${error}`);
        }
    }

    /**
     * Install project dependencies.
     */
    private async installDependencies(): Promise<void> {
        try {
            await this.runCommand('bun', ['install']);
            log.success('Dependencies installed');
        } catch (error) {
            throw new Error(`Failed to install dependencies: ${error}`);
        }
    }

    /**
     * Get current version from changelog.
     * @returns Current version string
     */
    private getCurrentVersion(): string {
        try {
            const changelog: IChangelogData = JSON.parse(readFileSync(this.changelogPath, 'utf8'));
            return changelog.current_version;
        } catch (error) {
            throw new Error(`Failed to read changelog: ${error}`);
        }
    }

    /**
     * Get the latest local release version.
     * @returns Latest version string or null
     */
    private getLatestRelease(): string | null {
        if (!existsSync(this.releaseDir)) return null;

        const prefixes = readdirSync(this.releaseDir);
        let latestVersion = null;
        let latestDate = new Date(0);

        for (const prefix of prefixes) {
            const prefixDir = join(this.releaseDir, prefix);
            if (!statSync(prefixDir).isDirectory()) continue;

            const versions = readdirSync(prefixDir);
            for (const version of versions) {
                const versionDir = join(prefixDir, version);
                if (!statSync(versionDir).isDirectory()) continue;

                const stat = statSync(versionDir);
                if (stat.mtime > latestDate) {
                    latestDate = stat.mtime;
                    latestVersion = `${prefix}-${version}`;
                }
            }
        }

        return latestVersion;
    }

    /**
     * Parse a version string into its components.
     * @param version - Version string to parse
     * @returns Parsed release info
     */
    private parseVersion(version: string): IAutoReleaseInfo {
        const match = version.match(/^(pre-alpha-|alpha-|beta-|rc-)?(\d+)\.(\d+)\.(\d+)$/);
        if (!match) {
            throw new Error(`Invalid version format: ${version}`);
        }

        return {
            version,
            prefix: match[1] ? match[1].slice(0, -1) : 'stable',
            major: parseInt(match[2]),
            minor: parseInt(match[3]),
            patch: parseInt(match[4]),
        };
    }

    /**
     * Build the application (Tauri + cargo).
     */
    private async buildApplication(): Promise<void> {
        try {
            await this.runCommand('cargo', ['clean'], {
                cwd: join(this.projectRoot, 'src-tauri'),
            });

            const env = {
                ...process.env,
                OPENSSL_LIB_DIR: '/usr/lib/aarch64-linux-gnu',
            };

            await this.runCommand('bun', ['run', 'tauri', 'build'], { env });
            log.success('Build complete');
        } catch (error: any) {
            if (error.toString().includes('regex')) {
                log.info('Adding regex dependency...');
                await this.runCommand('cargo', ['add', 'regex'], {
                    cwd: join(this.projectRoot, 'src-tauri'),
                });

                const env = {
                    ...process.env,
                    OPENSSL_LIB_DIR: '/usr/lib/aarch64-linux-gnu',
                };
                await this.runCommand('bun', ['run', 'tauri', 'build'], { env });
                log.success('Build complete (with regex)');
            } else {
                throw new Error(`Build failed: ${error}`);
            }
        }
    }

    /**
     * Create the release directory structure.
     * @param releaseInfo - Parsed release info
     */
    private async createReleaseStructure(releaseInfo: IAutoReleaseInfo): Promise<void> {
        const dir = join(this.releaseDir, releaseInfo.prefix, `${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}`);
        log.info(`Creating structure: ${dir}`);

        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Copy built executables to the release directory.
     * @param releaseInfo - Parsed release info
     */
    private async copyExecutables(releaseInfo: IAutoReleaseInfo): Promise<void> {
        const releaseDir = join(this.releaseDir, releaseInfo.prefix, `${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}`);
        const targetDir = join(this.projectRoot, 'src-tauri/target/release');
        const bundleDir = join(targetDir, 'bundle');

        try {
            const binarySource = join(targetDir, 'el-haido-tpv');
            const binaryDest = join(releaseDir, 'el-haido-tpv');
            await this.runCommand('cp', [binarySource, binaryDest]);

            const debPattern = `EL Haido TPV_${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}_arm64.deb`;
            const debSource = join(bundleDir, 'deb', debPattern);
            if (existsSync(debSource)) {
                await this.runCommand('cp', [debSource, join(releaseDir, debPattern)]);
            }

            const rpmPattern = `EL Haido TPV-${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}-1.aarch64.rpm`;
            const rpmSource = join(bundleDir, 'rpm', rpmPattern);
            if (existsSync(rpmSource)) {
                await this.runCommand('cp', [rpmSource, join(releaseDir, rpmPattern)]);
            }

            log.success('Executables copied');
        } catch (error) {
            throw new Error(`Failed to copy executables: ${error}`);
        }
    }

    /**
     * Generate release documentation (with AI if enabled).
     * @param releaseInfo - Parsed release info
     */
    private async generateReleaseDocumentation(releaseInfo: IAutoReleaseInfo): Promise<void> {
        if (this.useAI) {
            await this.generateAIDocumentation(releaseInfo);
        } else {
            await this.generateBasicREADME(releaseInfo);
        }
    }

    /**
     * Generate documentation using Gemini AI.
     * @param releaseInfo - Parsed release info
     */
    private async generateAIDocumentation(releaseInfo: IAutoReleaseInfo): Promise<void> {
        const releaseDir = join(this.releaseDir, releaseInfo.prefix, `${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}`);
        log.info('Generating documentation with AI...');

        try {
            const changelog: IChangelogData = JSON.parse(readFileSync(this.changelogPath, 'utf8'));
            const versionInfo = changelog.versions.find(v => v.version === releaseInfo.version);

            if (!versionInfo) {
                throw new Error(`No changelog info for version ${releaseInfo.version}`);
            }

            const files = readdirSync(releaseDir);
            const fileInfo = this.getFileInfo(releaseDir, files);

            const config: IGeminiPromptConfig = {
                projectContext: {
                    name: TPV_PROJECT_CONFIG.name,
                    description: TPV_PROJECT_CONFIG.description,
                    version: releaseInfo.version,
                    techStack: [...TPV_PROJECT_CONFIG.techStack],
                    targetPlatform: TPV_PROJECT_CONFIG.targetPlatform,
                },
                analysisType: 'release',
                specificContext: `Release ${releaseInfo.version} (${releaseInfo.prefix})`,
                data: { releaseInfo, versionInfo, fileInfo, date: new Date().toISOString().split('T')[0] },
            };

            const prompt = createReleasePrompt(config);
            const promptPath = join(this.tempDir, 'release-doc-prompt.txt');
            writeFileSync(promptPath, prompt);

            try {
                const geminiResult = Bun.spawnSync(['gemini'], {
                    cwd: this.projectRoot,
                    stdin: Buffer.from(prompt) as any,
                    stdout: 'pipe',
                    stderr: 'pipe',
                });

                if (geminiResult.exitCode !== 0) {
                    throw new Error(geminiResult.stderr?.toString() || 'Gemini CLI failed');
                }

                const aiResponse = geminiResult.stdout?.toString() || '';
                const responsePath = join(this.tempDir, 'release-doc-response.md');
                writeFileSync(responsePath, aiResponse);

                const readmePath = join(releaseDir, 'README.md');
                writeFileSync(readmePath, aiResponse, 'utf8');

                log.success('AI documentation generated');
            } catch (aiError) {
                log.warn(`AI failed, falling back to basic: ${aiError}`);
                await this.generateBasicREADME(releaseInfo);
            }
        } catch (error) {
            throw new Error(`Documentation generation failed: ${error}`);
        }
    }

    /**
     * Get file size info for release directory contents.
     * @param releaseDir - Release directory path
     * @param files - Array of filenames
     * @returns Map of filename to size string
     */
    private getFileInfo(releaseDir: string, files: string[]): Record<string, string> {
        const fileInfo: Record<string, string> = {};

        for (const file of files) {
            if (file !== 'README.md') {
                const filePath = join(releaseDir, file);
                const stats = statSync(filePath);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                fileInfo[file] = `${sizeMB}MB`;
            }
        }

        return fileInfo;
    }

    /**
     * Generate a basic README when AI is unavailable.
     * @param releaseInfo - Parsed release info
     */
    private async generateBasicREADME(releaseInfo: IAutoReleaseInfo): Promise<void> {
        const releaseDir = join(this.releaseDir, releaseInfo.prefix, `${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}`);
        const changelog: IChangelogData = JSON.parse(readFileSync(this.changelogPath, 'utf8'));
        const versionInfo = changelog.versions.find(v => v.version === releaseInfo.version);

        const date = new Date().toISOString().split('T')[0];
        const files = readdirSync(releaseDir);
        const fileInfo = this.getFileInfo(releaseDir, files);

        const readme = `# Release ${releaseInfo.version}

## Info

- **Version**: ${releaseInfo.version}
- **Date**: ${date}
- **Architecture**: ARM64 (aarch64)
- **Type**: ${versionInfo?.type} (${versionInfo?.title.toLowerCase()})

## Files

${Object.entries(fileInfo).map(([file, size]) => `- \`${file}\` - ${size}`).join('\n')}

## Quick Install

\`\`\`bash
sudo dpkg -i "EL Haido TPV_${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}_arm64.deb"
sudo apt-get install -f
\`\`\`

---

*Auto-generated on ${date}*
`;

        const readmePath = join(releaseDir, 'README.md');
        writeFileSync(readmePath, readme, 'utf8');
        log.success('Basic README generated');
    }

    /**
     * Commit and push release changes.
     * @param releaseInfo - Parsed release info
     */
    private async commitAndPushReleaseAI(releaseInfo: IAutoReleaseInfo): Promise<void> {
        log.info('Committing release...');

        try {
            const releaseDir = join(this.releaseDir, releaseInfo.prefix, `${releaseInfo.major}.${releaseInfo.minor}.${releaseInfo.patch}`);

            try {
                await this.runCommand('git', ['config', 'user.name']);
            } catch {
                await this.runCommand('git', ['config', 'user.email', 'auto-release@build.local']);
                await this.runCommand('git', ['config', 'user.name', 'Auto-Release System']);
            }

            await this.runCommand('git', ['add', releaseDir]);

            const cargoPath = join(this.projectRoot, 'src-tauri/Cargo.toml');
            const cargoLockPath = join(this.projectRoot, 'src-tauri/Cargo.lock');
            if (existsSync(cargoPath)) await this.runCommand('git', ['add', cargoPath]);
            if (existsSync(cargoLockPath)) await this.runCommand('git', ['add', cargoLockPath]);

            const statusResult = await this.runCommand('git', ['status', '--porcelain']);
            if (!statusResult.stdout.trim()) {
                log.warn('No changes to commit');
                return;
            }

            const commitMessage = this.generateCommitMessage(releaseInfo);
            await this.runCommand('git', ['commit', '-m', commitMessage]);
            await this.runCommand('git', ['push', 'origin', 'master']);
            log.success('Push complete');
        } catch (error) {
            throw new Error(`Commit/push failed: ${error}`);
        }
    }

    /**
     * Generate a commit message for the release.
     * @param releaseInfo - Parsed release info
     * @returns Formatted commit message
     */
    private generateCommitMessage(releaseInfo: IAutoReleaseInfo): string {
        const changelog: IChangelogData = JSON.parse(readFileSync(this.changelogPath, 'utf8'));
        const versionInfo = changelog.versions.find(v => v.version === releaseInfo.version);

        const features = versionInfo?.changes
            .filter(c => c.type === 'feature')
            .slice(0, 3)
            .map(c => c.title)
            .join(', ') || '';

        return `release(${releaseInfo.version}): auto-release ARM64

- Binary executable
- Debian package (.deb)
- RPM package (.rpm)
- README ${this.useAI ? 'generated with AI' : 'auto-generated'}
${features ? `\nFeatures: ${features}` : ''}

Compiled natively on ARM64 for RPi3+.`;
    }

    /**
     * Create GitHub Release via gh CLI.
     * @param releaseInfo - Parsed release info
     */
    private async createGitHubRelease(releaseInfo: IAutoReleaseInfo): Promise<void> {
        if (this.noGitHub) {
            log.info('GitHub Release disabled by --no-github');
            return;
        }

        log.info('Creating GitHub Release...');

        try {
            await this.runCommand('gh', ['--version']);
            const ghArgs = this.forceMode ? ['--force'] : [];
            await this.runCommand('bun', ['run', 'src/github-release-manager.ts', ...ghArgs]);
            log.success('GitHub Release created');
        } catch {
            log.warn('Could not create GitHub Release. Check gh CLI installation.');
        }
    }

    /**
     * Run a shell command and return stdout/stderr.
     * @param command - Command to execute
     * @param args - Command arguments
     * @param options - Spawn options overrides
     * @returns Command output
     */
    private async runCommand(command: string, args: string[] = [], options: any = {}): Promise<{ stdout: string; stderr: string }> {
        const proc = spawn({
            cmd: [command, ...args],
            cwd: options.cwd || this.projectRoot,
            env: options.env || process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            throw new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`);
        }

        const stdout = await new Response(proc.stdout).text();
        return { stdout, stderr: '' };
    }
}

// ─── CLI Entry Point ─────────────────────────────────────────
if (import.meta.main) {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        log.header('Auto-Release Manager', 'Help');
        log.info('Usage: bun src/auto-release-gemini.ts [options]');
        log.blank();
        log.info('Options:');
        log.info('  --ai            Enable AI documentation (default)');
        log.info('  --no-ai         Disable AI, use basic docs');
        log.info('  --force         Force rebuild even if release exists');
        log.info('  --no-github     Skip GitHub release creation');
        log.info('  --help, -h      Show this help');
        process.exit(0);
    }

    const manager = new AutoReleaseManagerAI({
        force: args.includes('--force'),
        useAI: !args.includes('--no-ai'),
        noGitHub: args.includes('--no-github'),
    });

    const result = await manager.run();
    if (isErr(result)) {
        log.error(`Auto-release failed: ${result.error.message}`);
        process.exit(1);
    }
}

export { AutoReleaseManagerAI };
