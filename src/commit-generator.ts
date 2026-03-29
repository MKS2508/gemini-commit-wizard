#!/usr/bin/env bun

/**
 * Core commit generation engine.
 * Analyzes git changes and generates AI-powered commit proposals.
 *
 * SDK-first: accepts programmatic options. CLI entry point at bottom.
 * @module commit-generator
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Logger } from '@mks2508/better-logger';
import { ok, err, isErr, tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import { createCommitPrompt, GeminiResponseParser, type GeminiPromptConfig } from './prompt-templates';
import { createProvider, listProviders } from './providers/index.js';
import { loadProjectConfig } from './project-config';
import { detectTerminalCapabilities, formatProviderBadge, shouldUseFancyOutput, type ITerminalCapabilities } from './utils/index.js';
import type {
    IAIProvider,
    IProjectConfig,
    IFileChange,
    IGitStats,
    ICommitAnalysis,
    ICommitProposal,
    ICommitGeneratorOptions,
    ICommitResult,
    CommitErrorCode,
} from './types/index.js';

const log = new Logger();

/**
 * Parses CLI arguments into ICommitGeneratorOptions.
 * @param argv - Raw process.argv (including first two entries)
 * @returns Parsed options object
 */
function parseCliArgs(argv: string[]): ICommitGeneratorOptions {
    const args = argv.slice(2);
    const get = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx > -1 && args[idx + 1] ? args[idx + 1] : undefined;
    };

    return {
        provider: (get('--provider') || process.env.COMMIT_WIZARD_PROVIDER) as any,
        model: get('--model'),
        autoApprove: args.includes('--auto-approve'),
        noPush: args.includes('--no-push'),
        exhaustive: args.includes('--exhaustive') || args.includes('-exhaustive'),
        context: get('--context'),
        workType: get('--work-type'),
        affectedComponents: get('--affected-components'),
        dryRun: args.includes('--dry-run'),
        json: args.includes('--json'),
        verbose: args.includes('--verbose') || args.includes('-v'),
        quiet: args.includes('--quiet') || args.includes('-q'),
        silent: args.includes('--silent'),
        listProviders: args.includes('--list-providers'),
        quick: args.includes('--quick'),
    };
}

/**
 * Generates AI-powered commit messages by analyzing git changes.
 *
 * @example
 * ```typescript
 * const generator = new CommitGenerator({ provider: 'groq', autoApprove: true });
 * const result = await generator.generate();
 * if (isOk(result)) {
 *   console.log(`Applied ${result.value.commitCount} commits`);
 * }
 * ```
 */
export class CommitGenerator {
    private projectRoot: string;
    private tempDir: string;
    private options: ICommitGeneratorOptions;
    private provider: IAIProvider;
    private projectConfig: IProjectConfig;
    private caps: ITerminalCapabilities;

    /**
     * @param options - Programmatic configuration options
     */
    constructor(options: ICommitGeneratorOptions = {}) {
        this.options = options;
        this.projectRoot = options.projectRoot || process.cwd();
        this.tempDir = join(this.projectRoot, '.temp');
        this.caps = detectTerminalCapabilities();

        // Configure logger level based on options (v5 setCLILevel)
        if (options.silent) {
            log.setCLILevel('silent');
        } else if (options.quiet) {
            log.setCLILevel('quiet');
        } else if (options.verbose) {
            log.setCLILevel('debug');
        }

        this.projectConfig = loadProjectConfig(this.projectRoot);

        const resolvedProvider = options.provider || this.projectConfig.provider;
        const resolvedModel = options.model || this.projectConfig.model;
        this.provider = createProvider(resolvedProvider, resolvedModel);

        // Subtle provider badge instead of loud message
        if (!options.quiet && !options.silent) {
            const providerBadge = formatProviderBadge(this.provider.name, this.caps);
            log.info(`${providerBadge} ${this.provider.model}`);
        }
        this.ensureTempDir();
    }

    /**
     * Get the AI provider being used.
     * @returns Current IAIProvider instance
     */
    getProvider(): IAIProvider {
        return this.provider;
    }

    /**
     * Get the loaded project configuration.
     * @returns Current IProjectConfig
     */
    getConfig(): IProjectConfig {
        return this.projectConfig;
    }

    private ensureTempDir(): void {
        if (!existsSync(this.tempDir)) {
            Bun.spawnSync(['mkdir', '-p', this.tempDir]);
        }
    }

    /**
     * Run a git command and return stdout.
     * @param args - Git subcommand and arguments
     * @returns Result with stdout text or GIT_ERROR
     */
    private async gitCommand(args: string[]): Promise<Result<string, ResultError<'GIT_ERROR'>>> {
        return tryCatchAsync(async () => {
            const result = Bun.spawnSync(['git', ...args], {
                cwd: this.projectRoot,
                stdout: 'pipe',
                stderr: 'pipe',
            });
            if (result.exitCode !== 0) {
                const stderr = result.stderr?.toString() || 'Git command failed';
                throw new Error(`Git error: ${stderr}`);
            }
            return result.stdout?.toString().trim() || '';
        }, 'GIT_ERROR');
    }

    /**
     * Stage all changes.
     * @returns Result indicating success or STAGING_ERROR
     */
    private async stageAllChanges(): Promise<Result<void, ResultError<'STAGING_ERROR'>>> {
        const result = await this.gitCommand(['add', '-A']);
        if (isErr(result)) return err({ type: 'STAGING_ERROR', message: result.error.message } as any);
        return ok(undefined);
    }

    /**
     * Get the current repository status as a list of file changes.
     * @returns Result with file changes or GIT_ERROR
     */
    private async getRepositoryStatus(): Promise<Result<IFileChange[], ResultError<'GIT_ERROR'>>> {
        const result = await this.gitCommand(['status', '--porcelain']);
        if (isErr(result)) return result as any;

        const files: IFileChange[] = [];
        for (const line of result.value.split('\n').filter(l => l.trim())) {
            const status = line.substring(0, 2);
            const filePath = line.substring(3);

            let fileStatus: IFileChange['status'];
            if (status.includes('A')) fileStatus = 'added';
            else if (status.includes('M')) fileStatus = 'modified';
            else if (status.includes('D')) fileStatus = 'deleted';
            else if (status.includes('R')) fileStatus = 'renamed';
            else fileStatus = 'untracked';

            files.push({ path: filePath, status: fileStatus });
        }

        return ok(files);
    }

    /**
     * Get the diff for a specific file.
     * @param filePath - File to diff
     * @param isStaged - Whether to diff staged changes
     * @returns Diff text (never fails — returns fallback text on error)
     */
    private async getFileDiff(filePath: string, isStaged: boolean = true): Promise<string> {
        const diffArgs = isStaged
            ? ['diff', '--cached', '--', filePath]
            : ['diff', '--', filePath];

        const result = await this.gitCommand(diffArgs);
        if (isErr(result)) return `Binary or new file: ${filePath}`;
        return result.value;
    }

    /**
     * Calculate aggregate diff statistics.
     * @returns Git stats (returns empty stats on error)
     */
    private async getGitStats(): Promise<IGitStats> {
        const result = await this.gitCommand(['diff', '--cached', '--stat']);
        if (isErr(result)) {
            return { total_files: 0, total_additions: 0, total_deletions: 0, files_by_extension: {}, directories_affected: [] };
        }

        const lines = result.value.split('\n').filter(l => l.trim());
        let totalFiles = 0;
        let totalAdditions = 0;
        let totalDeletions = 0;
        const filesByExtension: Record<string, number> = {};
        const directoriesAffected = new Set<string>();

        for (const line of lines) {
            if (line.includes('|')) {
                totalFiles++;
                const filePath = line.split('|')[0].trim();
                const ext = filePath.split('.').pop() || 'no-ext';
                filesByExtension[ext] = (filesByExtension[ext] || 0) + 1;
                const dir = filePath.split('/')[0];
                directoriesAffected.add(dir);
                const stats = line.split('|')[1];
                totalAdditions += (stats.match(/\+/g) || []).length;
                totalDeletions += (stats.match(/\-/g) || []).length;
            }
        }

        return { total_files: totalFiles, total_additions: totalAdditions, total_deletions: totalDeletions, files_by_extension: filesByExtension, directories_affected: Array.from(directoriesAffected) };
    }

    /**
     * Build the full analysis context for the AI prompt.
     * @returns Result with commit analysis or error
     */
    private async generateAnalysisContext(): Promise<Result<ICommitAnalysis, ResultError<CommitErrorCode>>> {
        const stageResult = await this.stageAllChanges();
        if (isErr(stageResult)) return stageResult as any;

        const filesResult = await this.getRepositoryStatus();
        if (isErr(filesResult)) return filesResult as any;
        const files = filesResult.value;

        const stats = await this.getGitStats();

        for (const file of files) {
            if (file.status !== 'deleted') {
                file.diff = await this.getFileDiff(file.path);
                if (file.diff) {
                    file.lines_added = (file.diff.match(/^\+[^+]/gm) || []).length;
                    file.lines_removed = (file.diff.match(/^-[^-]/gm) || []).length;
                    file.is_binary = file.diff.includes('Binary files differ');
                }
            }
        }

        const patternsPath = join(this.projectRoot, 'commit-templates/commit-patterns.md');
        const commitPatterns = existsSync(patternsPath)
            ? readFileSync(patternsPath, 'utf-8')
            : 'No commit patterns found';

        return ok({
            files,
            stats,
            project_context: {
                name: this.projectConfig.name,
                description: this.projectConfig.description,
                tech_stack: this.projectConfig.techStack,
                target_platform: this.projectConfig.targetPlatform,
            },
            commit_patterns: commitPatterns,
        });
    }

    private createPrompt(analysis: ICommitAnalysis, exhaustive: boolean, extraContext: string): string {
        const config: GeminiPromptConfig = {
            projectContext: {
                name: this.projectConfig.name,
                description: this.projectConfig.description,
                version: this.projectConfig.version,
                techStack: [...this.projectConfig.techStack],
                targetPlatform: this.projectConfig.targetPlatform,
            },
            analysisType: 'commit',
            specificContext: exhaustive ? `MODO EXHAUSTIVO: Análisis profundo requerido.\n${extraContext}` : extraContext,
            components: this.projectConfig.components,
            commitFormat: this.projectConfig.commitFormat,
            data: {
                ...(exhaustive && { mode: 'exhaustive' }),
                stats: analysis.stats,
                files: analysis.files.map(file => ({
                    path: file.path,
                    status: file.status,
                    lines_added: file.lines_added,
                    lines_removed: file.lines_removed,
                    is_binary: file.is_binary,
                    diff_preview: file.diff?.substring(0, exhaustive ? 2000 : 1500) || 'No diff available',
                })),
                patterns: analysis.commit_patterns,
            },
        };
        return createCommitPrompt(config);
    }

    /**
     * Build enhanced context from structured user input.
     * @returns Combined context string
     */
    private buildEnhancedContext(): string {
        const parts: string[] = [];
        const o = this.options;

        if (o.context) parts.push(`**Descripcion del trabajo**: ${o.context}`);

        if (o.workType) {
            const desc: Record<string, string> = {
                feature: 'Nueva funcionalidad o capacidad',
                bugfix: 'Correccion de error o fallo',
                refactor: 'Mejora del codigo sin cambios de funcionalidad',
                docs: 'Actualizacion de documentacion',
                performance: 'Optimizacion de rendimiento',
                ui: 'Cambios en interfaz de usuario',
                api: 'Modificaciones en API o endpoints',
                security: 'Mejoras de seguridad',
                test: 'Adicion o modificacion de tests',
            };
            parts.push(`**Tipo de trabajo**: ${o.workType} - ${desc[o.workType] || o.workType}`);
        }

        if (o.affectedComponents) parts.push(`**Componentes afectados**: ${o.affectedComponents}`);

        if (parts.length === 0) return '';
        return `## Contexto Estructurado\n\n${parts.join('\n')}`;
    }

    /**
     * Invoke the AI provider with the analysis context.
     * @param analysis - Commit analysis data
     * @param exhaustive - Whether to use exhaustive analysis
     * @param extraContext - Additional context string
     * @returns Result with the AI response text or PROVIDER_ERROR
     */
    private async analyzeWithAI(
        analysis: ICommitAnalysis,
        exhaustive: boolean,
        extraContext: string,
    ): Promise<Result<string, ResultError<'PROVIDER_ERROR'>>> {
        const prompt = this.createPrompt(analysis, exhaustive, extraContext);

        const contextPath = join(this.tempDir, 'analysis-context.json');
        writeFileSync(contextPath, JSON.stringify(analysis, null, 2));
        const promptPath = join(this.tempDir, 'prompt.txt');
        writeFileSync(promptPath, prompt);

        const result = await tryCatchAsync(async () => {
            const response = await this.provider.generate(prompt);
            const responsePath = join(this.tempDir, 'response.md');
            writeFileSync(responsePath, response);
            return response;
        }, 'PROVIDER_ERROR');

        if (isErr(result)) {
            log.error(`Error with ${this.provider.name}: ${result.error.message}`);
            log.info(`Context saved: ${contextPath}`);
            log.info(`Prompt saved: ${promptPath}`);
        }

        return result;
    }

    /**
     * Parse AI response into commit proposals.
     * @param aiResponse - Raw AI response text
     * @returns Array of parsed commit proposals
     */
    private parseCommitProposals(aiResponse: string): ICommitProposal[] {
        const parsed = GeminiResponseParser.parseCommitProposals(aiResponse);
        return parsed.map(p => ({
            title: p.title,
            description: p.description,
            technical: p.technical,
            changelog: p.changelog,
            files: [],
        }));
    }

    /**
     * Execute a single commit.
     * @param proposal - The commit proposal to execute
     * @param allFiles - All changed files (used when proposal has no specific files)
     * @returns Result indicating success or COMMIT_EXEC_ERROR
     */
    private async executeCommit(
        proposal: ICommitProposal,
        allFiles: IFileChange[],
    ): Promise<Result<boolean, ResultError<'COMMIT_EXEC_ERROR'>>> {
        return tryCatchAsync(async () => {
            const targetFiles = proposal.files && proposal.files.length > 0
                ? proposal.files
                : allFiles
                    .map(f => f.path)
                    .filter(p => !p.includes('.temp/') && !p.startsWith('.release-notes-'));

            for (const file of targetFiles) {
                const addResult = await this.gitCommand(['add', file]);
                if (isErr(addResult)) {
                    log.warn(`Could not stage ${file}: ${addResult.error.message}`);
                }
            }

            const statusResult = await this.gitCommand(['diff', '--cached', '--name-only']);
            if (isErr(statusResult) || !statusResult.value.trim()) {
                log.warn('No staged changes for this commit');
                return false;
            }

            let commitMessage = proposal.title;
            if (proposal.description) commitMessage += `\n\n${proposal.description}`;
            if (proposal.technical) commitMessage += `\n\n<technical>\n${proposal.technical}\n</technical>`;
            if (proposal.changelog) commitMessage += `\n\n<changelog>\n${proposal.changelog}\n</changelog>`;

            const commitResult = await this.gitCommand(['commit', '-m', commitMessage]);
            if (isErr(commitResult)) throw new Error(commitResult.error.message);
            return true;
        }, 'COMMIT_EXEC_ERROR');
    }

    /**
     * Push commits to remote.
     * @returns Result indicating success or GIT_ERROR
     */
    private async pushCommits(): Promise<Result<boolean, ResultError<'GIT_ERROR'>>> {
        if (this.options.noPush) {
            return ok(false);
        }

        const sp = log.spinner('Pushing...');
        sp.start();
        const result = await this.gitCommand(['push', 'origin', 'master']);
        if (isErr(result)) {
            sp.fail('Push failed');
            log.warn('Commits are in your local repository');
            return result;
        }
        sp.succeed('Pushed');
        return ok(true);
    }

    /**
     * Validate that auto-approve is safe to execute.
     * @returns Whether it's safe to proceed
     */
    private async validateAutoApprove(): Promise<boolean> {
        const branchResult = await this.gitCommand(['branch', '--show-current']);
        if (isErr(branchResult)) return false;
        if (branchResult.value !== 'master') {
            log.warn(`Not on master branch (current: ${branchResult.value})`);
            return false;
        }

        const statusResult = await this.gitCommand(['status', '--porcelain']);
        if (isErr(statusResult)) return false;
        const conflicts = statusResult.value.split('\n').filter(l => l.startsWith('UU'));
        if (conflicts.length > 0) {
            log.error('Unresolved merge conflicts');
            return false;
        }

        return true;
    }

    /**
     * Analyze changes and return proposals without executing commits.
     * @returns Result with an array of commit proposals or an error
     */
    async analyze(): Promise<Result<ICommitProposal[], ResultError<CommitErrorCode>>> {
        const analysisResult = await this.generateAnalysisContext();
        if (isErr(analysisResult)) return analysisResult as any;
        const analysis = analysisResult.value;

        if (analysis.files.length === 0) return ok([]);

        const exhaustive = this.options.exhaustive || analysis.files.length > 50;
        const extraContext = this.buildEnhancedContext();

        const aiResult = await this.analyzeWithAI(analysis, exhaustive, extraContext);
        if (isErr(aiResult)) return aiResult as any;

        return ok(this.parseCommitProposals(aiResult.value));
    }

    /**
     * Full commit generation flow: analyze, propose, execute, push.
     * @returns Result with commit outcome or an error
     */
    async generate(): Promise<Result<ICommitResult, ResultError<CommitErrorCode>>> {
        const startTime = Date.now();
        const useFancy = shouldUseFancyOutput(this.caps);

        // Only show header in TTY with color
        if (useFancy && !this.options.quiet && !this.options.silent) {
            log.header('Commit Wizard', `v${this.projectConfig.version}`);
            log.divider();
        }

        // Step 1: Analyze repository
        const stageSpinner = log.spinner('Staging...');
        stageSpinner.start();
        const stageResult = await this.stageAllChanges();
        if (isErr(stageResult)) {
            stageSpinner.fail('Failed to stage changes');
            return stageResult as any;
        }

        const repoSpinner = log.spinner('Analyzing repository...');
        repoSpinner.start();
        const filesResult = await this.getRepositoryStatus();
        if (isErr(filesResult)) {
            repoSpinner.fail('Failed to read repository');
            return filesResult as any;
        }
        const files = filesResult.value;

        if (files.length === 0) {
            repoSpinner.succeed('No changes to process');
            return err({ type: 'NO_CHANGES', message: 'No changes to process' } as any);
        }
        repoSpinner.succeed(`${files.length} file${files.length !== 1 ? 's' : ''} changed`);

        // Step 2: Calculate statistics
        const statsSpinner = log.spinner('Calculating statistics...');
        statsSpinner.start();
        const stats = await this.getGitStats();

        for (const file of files) {
            if (file.status !== 'deleted') {
                file.diff = await this.getFileDiff(file.path);
                if (file.diff) {
                    file.lines_added = (file.diff.match(/^\+[^+]/gm) || []).length;
                    file.lines_removed = (file.diff.match(/^-[^-]/gm) || []).length;
                    file.is_binary = file.diff.includes('Binary files differ');
                }
            }
        }
        statsSpinner.succeed(`+${stats.total_additions} -${stats.total_deletions} lines`);

        // Build analysis context
        const patternsPath = join(this.projectRoot, 'commit-templates/commit-patterns.md');
        const commitPatterns = existsSync(patternsPath)
            ? readFileSync(patternsPath, 'utf-8')
            : 'No commit patterns found';

        const analysis: ICommitAnalysis = {
            files,
            stats,
            project_context: {
                name: this.projectConfig.name,
                description: this.projectConfig.description,
                tech_stack: this.projectConfig.techStack,
                target_platform: this.projectConfig.targetPlatform,
            },
            commit_patterns: commitPatterns,
        };

        const exhaustive = this.options.exhaustive || files.length > 50;
        const extraContext = this.buildEnhancedContext();

        // Step 3: AI generation
        const providerBadge = formatProviderBadge(this.provider.name, this.caps);
        const aiSpinner = log.spinner(`${providerBadge} Generating...`);
        aiSpinner.start();
        const aiResult = await this.analyzeWithAI(analysis, exhaustive, extraContext);
        if (isErr(aiResult)) {
            aiSpinner.fail('Generation failed');
            return aiResult as any;
        }
        aiSpinner.succeed('Commit message generated');

        // Parse proposals
        const proposals = this.parseCommitProposals(aiResult.value);
        if (proposals.length === 0) {
            log.warn('No valid commit proposals found');
            if (this.options.verbose) {
                log.divider();
                log.info(aiResult.value);
                log.divider();
            }
            return err({ type: 'PARSE_ERROR', message: 'No valid commit proposals parsed' } as any);
        }

        // Show proposals - use simple format in CI, fancy in TTY
        if (useFancy) {
            log.cliTable(proposals.map((p, i) => ({
                '#': i + 1,
                title: p.title.substring(0, 60),
                files: p.files?.length || 'all',
            })));
        } else {
            for (let i = 0; i < proposals.length; i++) {
                log.info(`${i + 1}. ${proposals[i].title}`);
            }
        }

        // Show full proposals - use boxes only in TTY
        if (useFancy) {
            for (const p of proposals) {
                log.box(
                    [p.title, '', p.description, p.technical ? `\n<technical>\n${p.technical}\n</technical>` : '', p.changelog ? `\n<changelog>\n${p.changelog}\n</changelog>` : ''].filter(Boolean).join('\n'),
                    { title: `Commit #${proposals.indexOf(p) + 1}`, borderStyle: 'single', padding: 1 },
                );
            }
        }

        // Step 4: Execute commits (if auto-approve)
        let commitCount = 0;
        let pushed = false;

        if (this.options.autoApprove) {
            const isValid = await this.validateAutoApprove();
            if (!isValid) {
                return err({ type: 'GIT_ERROR', message: 'Auto-approve validation failed' } as any);
            }

            for (let i = 0; i < proposals.length; i++) {
                const commitSpinner = log.spinner(`Commit ${i + 1}/${proposals.length}...`);
                commitSpinner.start();
                const commitResult = await this.executeCommit(proposals[i], files);
                if (isErr(commitResult) || !commitResult.value) {
                    commitSpinner.fail('Commit failed');
                } else {
                    commitSpinner.succeed(proposals[i].title.split('\n')[0].substring(0, 50));
                    commitCount++;
                }
            }

            // Step 5: Push
            if (commitCount > 0) {
                const pushResult = await this.pushCommits();
                pushed = !isErr(pushResult) && pushResult.value;
            }
        } else {
            log.info('Use --auto-approve to execute commits');
        }

        const elapsed = Date.now() - startTime;

        // Summary - subtle format
        if (!this.options.quiet && !this.options.silent) {
            if (useFancy) {
                log.divider();
            }
            log.info(
                `${commitCount} commit${commitCount !== 1 ? 's' : ''} ${this.options.autoApprove ? 'applied' : 'proposed'} · ${this.provider.name} · ${(elapsed / 1000).toFixed(1)}s${pushed ? ' · pushed' : ''}`
            );
        }

        return ok({
            proposals,
            commitCount,
            pushed,
            providerName: this.provider.name,
            modelName: this.provider.model,
            elapsedMs: elapsed,
        });
    }
}

// ─── CLI Entry Point ─────────────────────────────────────────
if (import.meta.main) {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        log.header('Commit Wizard', 'AI-powered commit generation');
        log.blank();
        log.info('Usage: bun src/commit-generator.ts [options]');
        log.blank();
        log.info('Options:');
        log.info('  --provider <name>            Provider: gemini-cli|gemini-sdk|groq|openrouter');
        log.info('  --model <model-id>           Model override');
        log.info('  --auto-approve               Execute commits automatically');
        log.info('  --no-push                    Skip git push');
        log.info('  --context <description>      Describe your changes');
        log.info('  --work-type <type>           feature|bugfix|refactor|docs|test');
        log.info('  --affected-components <list>  Components changed');
        log.info('  --exhaustive                 Deep analysis mode');
        log.info('  --dry-run                    Show proposals without executing');
        log.info('  --json                       Output as JSON (implies dry-run)');
        log.info('  --verbose, -v                Show debug output');
        log.info('  --quiet, -q                  Only show errors and results');
        log.info('  --silent                     No output (SDK mode)');
        log.info('  --list-providers             Show available providers');
        log.info('  --help, -h                   Show this help');
        log.blank();
        process.exit(0);
    }

    if (args.includes('--list-providers')) {
        const caps = detectTerminalCapabilities();
        const providers = listProviders();

        if (shouldUseFancyOutput(caps)) {
            log.header('Available Providers');
            log.blank();
            log.cliTable(
                providers.map(p => ({
                    status: p.available ? 'ready' : 'missing',
                    provider: p.name,
                    id: p.id,
                    requirement: p.available ? '-' : p.requirement,
                })),
            );
        } else {
            for (const p of providers) {
                log.info(`${p.available ? '✓' : '✗'} ${p.id.padEnd(12)} ${p.name}`);
            }
        }
        log.blank();
        process.exit(0);
    }

    const options = parseCliArgs(process.argv);
    const generator = new CommitGenerator(options);
    const result = await generator.generate();

    if (isErr(result)) {
        log.error(result.error.message);
        process.exit(1);
    }
}
