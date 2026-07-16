#!/usr/bin/env bun

/**
 * Core commit generation engine.
 * Analyzes git changes and generates AI-powered commit proposals.
 *
 * SDK-first: accepts programmatic options. CLI entry point at bottom.
 * @module commit-generator
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import logger from '@mks2508/better-logger';
// Alias so the file's existing `log.xxx(...)` call sites stay unchanged.
const log = logger;
import { ok, err, isErr, tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import { createCommitPrompt, GeminiResponseParser, type GeminiPromptConfig } from './prompt-templates';
import { createProvider, listProviders } from './providers/index.js';
import { loadProjectConfig } from './project-config';
import { detectTerminalCapabilities, formatProviderBadge, shouldUseFancyOutput, type ITerminalCapabilities } from './utils/index.js';
import {
    decideStaging,
    applyStaging,
    getGitStatusDetailed,
    type IStagingDecision,
    type StagingMode,
} from './staging.js';
import {
    buildJsonEnvelope,
    writeJson,
    mapErrorToExitCode,
    ExitCode,
    type JsonEnvelope,
} from './reporter.js';
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

/**
 * Wizard version. Bumped on every release.
 * Keep in sync with `package.json` so `--version` reports the truth.
 */
export const WIZARD_VERSION = '2.1.0';


/**
 * Parses CLI arguments into ICommitGeneratorOptions.
 *
 * Recognized flags (added in v2.0):
 *   --staged-only             stage mode: respect user's pre-existing staging
 *   --all                     stage mode: git add -A (explicit)
 *   --add <files...>          stage mode: stage specific paths (comma-separated)
 *   --agent                   skip all prompts, error on ambiguity (CI/agent-safe)
 *   --ci                      alias for --agent
 *   --no-interactive          disable prompts, same as --agent
 *   --confirm-push            opt back into push with explicit confirmation
 *
 * @param argv - Raw process.argv (including first two entries)
 * @returns Parsed options object
 */
function parseCliArgs(argv: string[]): ICommitGeneratorOptions {
    const args = argv.slice(2);
    const get = (flag: string): string | undefined => {
        const idx = args.indexOf(flag);
        return idx > -1 && args[idx + 1] ? args[idx + 1] : undefined;
    };

    // Resolve staging mode from mutually-exclusive flags
    let stagingMode: StagingMode | undefined;
    let addFiles: string[] | undefined;
    if (args.includes('--staged-only')) {
        stagingMode = 'staged-only';
    } else if (args.includes('--all')) {
        stagingMode = 'all';
    } else if (args.includes('--add')) {
        stagingMode = 'specific';
        const raw = get('--add');
        if (raw) {
            addFiles = raw.split(',').map(f => f.trim()).filter(Boolean);
        }
    }

    const isAgent = args.includes('--agent') || args.includes('--ci');
    const noInteractive = args.includes('--no-interactive');

    // Resolve context: --context-file wins, then --context, then env.
    // --context-file is preferred for agents passing large prompts
    // because it sidesteps shell-escape pain.
    const contextFile = get('--context-file');
    let contextValue = get('--context') || process.env.COMMIT_WIZARD_CONTEXT;
    if (contextFile) {
        try {
            contextValue = readFileSync(contextFile, 'utf-8');
        } catch (e) {
            // Defer the error to the constructor / main entry so we can
            // surface it through the JSON envelope instead of crashing
            // here. The flag is captured but the file read failed.
            contextValue = undefined;
        }
    }

    // --no-color or NO_COLOR env (https://no-color.org) disables ANSI.
    const noColor = args.includes('--no-color') || !!process.env.NO_COLOR;

    return {
        provider: (get('--provider') || process.env.COMMIT_WIZARD_PROVIDER) as any,
        model: get('--model'),
        // v2.0: autoApprove defaults to FALSE. --auto-approve still works but
        // is now paired with --confirm-push for actual execution.
        autoApprove: args.includes('--auto-approve') || args.includes('--yes') || args.includes('-y'),
        // v2.0: noPush defaults to TRUE (push is opt-in via --confirm-push).
        noPush: !args.includes('--confirm-push') && !args.includes('--push'),
        stagingMode,
        addFiles,
        isAgent: isAgent || noInteractive,
        exhaustive: args.includes('--exhaustive') || args.includes('-exhaustive'),
        context: contextValue,
        contextFile: contextFile || undefined,
        workType: get('--work-type'),
        affectedComponents: get('--affected-components'),
        // v2.1: --dry-run now actually does what it says (skips
        // executeCommit + push). Earlier it was a parsed-but-unused flag.
        dryRun: args.includes('--dry-run'),
        // v2.1: --json is now functional end-to-end. Suppresses human
        // output and writes a structured envelope to stdout.
        json: args.includes('--json'),
        // v2.1: --atomic validates every proposal before committing any.
        // Default behavior (commit-as-you-go, stop on first failure)
        // is preserved.
        atomic: args.includes('--atomic'),
        // v2.1: --no-color disables ANSI. Also honors NO_COLOR env.
        noColor,
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

        // Configure logger level based on options (v5→v0.18 setVerbosity).
        // MUST happen BEFORE any module that logs (loadProjectConfig,
        // provider constructor, etc.) so --json / --silent suppresses
        // everything from the very first line.
        if (options.silent || options.json) {
            log.setVerbosity('silent');
        } else if (options.quiet) {
            log.setVerbosity('quiet');
        } else if (options.verbose) {
            log.setVerbosity('debug');
        }

        // v2.1: --no-color / NO_COLOR → strip ANSI sequences from output.
        // better-logger respects this via setNoColor when available;
        // for now we use the env var which the library reads.
        if (options.noColor) {
            process.env.NO_COLOR = '1';
            // Force TERM=dumb so well-behaved libs drop color too.
            if (process.env.TERM && process.env.TERM !== 'dumb') {
                process.env.FORCE_COLOR = '0';
            }
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
            mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Run a git command and return stdout.
     * @param args - Git subcommand and arguments
     * @returns Result with stdout text or GIT_ERROR
     */
    private async gitCommand(args: string[]): Promise<Result<string, ResultError<'GIT_ERROR'>>> {
        return tryCatchAsync(async () => {
            const result = spawnSync('git', args, {
                cwd: this.projectRoot,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            if (result.status !== 0) {
                const stderr = result.stderr || 'Git command failed';
                throw new Error(`Git error: ${stderr}`);
            }
            let out = result.stdout || '';
            if (out.endsWith('\n')) out = out.slice(0, -1);
            return out;
        }, 'GIT_ERROR');
    }

    /**
     * Resolve and apply the staging decision for this run.
     *
     * Replaces the previous blanket `git add -A`. Uses the staging module to
     * honour explicit `--staged-only`, `--all`, `--add <files>`, or
     * `--agent` flags. In agent/CI mode without an explicit mode, this
     * errors out cleanly instead of guessing.
     *
     * @returns Result with the staging decision or STAGING_ERROR
     */
    private async resolveAndApplyStaging(): Promise<Result<IStagingDecision, ResultError<'STAGING_ERROR'>>> {
        return tryCatchAsync(async () => {
            const isInteractive = !this.options.isAgent && this.caps.isTTY;
            const decision = await decideStaging(this.projectRoot, {
                mode: this.options.stagingMode,
                files: this.options.addFiles,
                interactive: isInteractive,
                isAgent: this.options.isAgent,
            });

            await applyStaging(this.projectRoot, decision);

            log.info(`Staging: ${decision.reason}`);
            if (decision.toStage.length > 0) {
                log.debug(`  +${decision.toStage.length} file(s) added`);
            }
            if (decision.alreadyStaged.length > 0) {
                log.debug(`  ${decision.alreadyStaged.length} file(s) already staged`);
            }
            if (decision.excluded.length > 0) {
                log.debug(`  ${decision.excluded.length} file(s) excluded from this run`);
            }

            return decision;
        }, 'STAGING_ERROR');
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
     *
     * Does NOT stage anything — `analyze()` is a pure read-only path for
     * SDK consumers that want proposals without side effects. Staging is
     * only applied by `generate()`, the full execution flow.
     *
     * @returns Result with commit analysis or error
     */
    private async generateAnalysisContext(): Promise<Result<ICommitAnalysis, ResultError<CommitErrorCode>>> {
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
     *
     * v2.0: forwards `files` from the parser output. Earlier this method
     * dropped the parsed `files` array and re-set it to `[]`, which made
     * every proposal look file-less and triggered the
     * `MISSING_PROPOSAL_FILES` guard in `executeCommit`, even when the
     * AI response had emitted a correct `### Archivos de la Propuesta
     * #N` section. That was the bug behind `✗ Commit failed` with
     * 0 commits applied despite a perfectly parseable response.
     *
     * @param aiResponse - Raw AI response text
     * @returns Array of parsed commit proposals with files preserved
     */
    private parseCommitProposals(aiResponse: string): ICommitProposal[] {
        const parsed = GeminiResponseParser.parseCommitProposals(aiResponse);
        return parsed.map(p => ({
            title: p.title,
            description: p.description,
            technical: p.technical,
            changelog: p.changelog,
            files: p.files ?? [],
        }));
    }

    /**
     * Validate that a proposal can be committed without side effects.
     *
     * v2.1: split out of `executeCommit` so `--atomic` can validate
     * every proposal before committing any. Returns the list of files
     * that would be staged (for transparency), or throws with the same
     * `MISSING_PROPOSAL_FILES` / `FILE_NOT_IN_INDEX` semantics as
     * before.
     *
     * @param proposal - The commit proposal to validate
     * @returns Resolves with the validated file list
     */
    private async validateProposal(
        proposal: ICommitProposal,
    ): Promise<Result<string[], ResultError<'COMMIT_EXEC_ERROR'>>> {
        return tryCatchAsync(async () => {
            if (!proposal.files || proposal.files.length === 0) {
                const titlePreview = proposal.title.split('\n')[0];
                throw new Error(
                    `MISSING_PROPOSAL_FILES: proposal "${titlePreview}" did not declare target files`,
                );
            }

            for (const file of proposal.files) {
                const stagedResult = await this.gitCommand([
                    'ls-files', '--error-unmatch', '--', file,
                ]);
                if (isErr(stagedResult)) {
                    throw new Error(
                        `FILE_NOT_IN_INDEX: file '${file}' is not in the index. ` +
                        'Re-run with the correct staging mode or pass --all to include untracked files.',
                    );
                }
            }

            return proposal.files;
        }, 'COMMIT_EXEC_ERROR');
    }

    /**
     * Stage the proposal's files and create the commit.
     *
     * Runs `validateProposal` first as a safety net so the F4 guard
     * (refuse to commit proposals without a declared file list) holds
     * even when this method is called directly without prior validation
     * — which is the case in `generate()`'s default (non-atomic) loop.
     * Writes the commit message to a temp file and uses
     * `git commit -F <file>` (see F22) to dodge shell-escape bugs.
     *
     * @param proposal - The commit proposal to apply
     * @returns Result indicating success or COMMIT_EXEC_ERROR
     */
    private async applyProposal(
        proposal: ICommitProposal,
    ): Promise<Result<boolean, ResultError<'COMMIT_EXEC_ERROR'>>> {
        const validated = await this.validateProposal(proposal);
        if (isErr(validated)) return validated;

        return tryCatchAsync(async () => {
            const targetFiles = proposal.files;

            for (const file of targetFiles) {
                const addResult = await this.gitCommand(['add', '--', file]);
                if (isErr(addResult)) {
                    log.warn(`Could not stage ${file}: ${addResult.error.message}`);
                }
            }

            const statusResult = await this.gitCommand(['diff', '--cached', '--name-only']);
            if (isErr(statusResult) || !statusResult.value.trim()) {
                log.warn('No staged changes for this commit');
                return false;
            }

            // F22: build commit message and write to temp file to avoid
            // shell escaping bugs. Use `git commit -F <file>`.
            let commitMessage = proposal.title;
            if (proposal.description) commitMessage += `\n\n${proposal.description}`;
            if (proposal.technical) commitMessage += `\n\n<technical>\n${proposal.technical}\n</technical>`;
            if (proposal.changelog) commitMessage += `\n\n<changelog>\n${proposal.changelog}\n</changelog>`;

            const messagePath = join(this.projectRoot, '.temp', `commit-msg-${Date.now()}.txt`);
            writeFileSync(messagePath, commitMessage, 'utf-8');

            try {
                const commitResult = await this.gitCommand(['commit', '-F', messagePath]);
                if (isErr(commitResult)) throw new Error(commitResult.error.message);
            } finally {
                try {
                    const { unlinkSync } = await import('fs');
                    unlinkSync(messagePath);
                } catch {
                    // ignore cleanup errors
                }
            }

            return true;
        }, 'COMMIT_EXEC_ERROR');
    }

    /**
     * Backwards-compatible wrapper kept for tests + SDK consumers.
     *
     * v2.1: prefer `validateProposal` + `applyProposal` so callers can
     * decide whether to do atomic validation up front.
     *
     * @param proposal - The commit proposal to execute
     * @returns Result indicating success or COMMIT_EXEC_ERROR
     */
    private async executeCommit(
        proposal: ICommitProposal,
    ): Promise<Result<boolean, ResultError<'COMMIT_EXEC_ERROR'>>> {
        const validated = await this.validateProposal(proposal);
        if (isErr(validated)) return validated;
        return this.applyProposal(proposal);
    }

    /**
     * Push commits to remote.
     *
     * v2.0: branch is no longer hardcoded to `master`. We resolve the
     * current branch via `git branch --show-current` and push that.
     * In agent/CI mode (`isAgent`), the prompt is skipped and a warning
     * is logged before pushing. In interactive mode, a confirmation
     * prompt is always shown, with an extra confirmation when the
     * branch is `master` or `main`.
     *
     * @param commitCount - Number of commits about to be pushed (for the prompt)
     * @returns Result indicating success or GIT_ERROR
     */
    private async pushCommits(
        commitCount: number,
    ): Promise<Result<boolean, ResultError<'GIT_ERROR'>>> {
        if (this.options.noPush) {
            log.info('Push skipped (--no-push or no --confirm-push flag)');
            return ok(false);
        }

        if (commitCount === 0) {
            log.info('Push skipped (no commits to push)');
            return ok(false);
        }

        // Resolve the current branch (no longer hardcoded)
        const branchResult = await this.gitCommand(['branch', '--show-current']);
        if (isErr(branchResult)) {
            return err({
                type: 'GIT_ERROR',
                message: `Could not resolve current branch: ${branchResult.error.message}`,
            } as any);
        }
        const currentBranch = branchResult.value || 'HEAD';

        // Resolve the remote for the current branch (fall back to 'origin')
        let remote = 'origin';
        const remoteResult = await this.gitCommand([
            'config', '--get', `branch.${currentBranch}.remote`,
        ]);
        if (!isErr(remoteResult) && remoteResult.value) {
            remote = remoteResult.value;
        }

        const isProtectedBranch = currentBranch === 'master' || currentBranch === 'main';
        const isCI = this.caps.environment === 'ci' || this.options.isAgent;

        // Always prompt before push. In agent mode, prompt is replaced
        // by an explicit log warning so the decision is traceable.
        if (isCI) {
            log.warn(
                `About to push ${commitCount} commit(s) to ${remote}/${currentBranch}` +
                (isProtectedBranch ? ' [PROTECTED BRANCH]' : '') +
                (this.options.isAgent ? ' [AGENT MODE]' : ''),
            );
        } else {
            const { confirm } = await import('@inquirer/prompts');
            const ok = await confirm({
                message: `Push ${commitCount} commit(s) to ${remote}/${currentBranch}?` +
                    (isProtectedBranch ? ' [PROTECTED BRANCH]' : ''),
                default: false,
            });
            if (!ok) {
                log.info('Push cancelled by user');
                return ok(false);
            }

            if (isProtectedBranch) {
                const confirmProtected = await confirm({
                    message: `You are pushing to the protected branch "${currentBranch}". ` +
                        'Are you absolutely sure?',
                    default: false,
                });
                if (!confirmProtected) {
                    log.info('Push to protected branch cancelled');
                    return ok(false);
                }
            }
        }

        const sp = log.spinner(`Pushing to ${remote}/${currentBranch}...`);
        sp.start();
        const result = await this.gitCommand(['push', remote, currentBranch]);
        if (isErr(result)) {
            sp.fail('Push failed');
            log.warn('Commits are in your local repository');
            return result;
        }
        sp.succeed(`Pushed ${commitCount} commit(s) to ${remote}/${currentBranch}`);
        return ok(true);
    }

    /**
     * Validate that auto-approve is safe to execute.
     *
     * v2.0: now performs a basic blast-radius check before letting
     * `autoApprove` proceed. Checks:
     * 1. Current branch resolves cleanly
     * 2. No unresolved merge conflicts
     * 3. Branch is not detached HEAD
     *
     * The branch-protection warning (master/main) is logged but does
     * NOT block — that gate lives in `pushCommits()` so it can fire
     * per-push instead of per-run.
     *
     * @returns Whether it's safe to proceed with auto-approve
     */
    private async validateAutoApprove(): Promise<boolean> {
        const branchResult = await this.gitCommand(['branch', '--show-current']);
        if (isErr(branchResult)) return false;
        if (!branchResult.value) {
            log.error('Detached HEAD — auto-approve refused');
            return false;
        }
        const branch = branchResult.value;
        if (branch === 'master' || branch === 'main') {
            log.warn(`Auto-approve on protected branch "${branch}". Proceed with care.`);
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

        // Step 1: Resolve staging decision (replaces blanket `git add -A`)
        const stageSpinner = log.spinner('Resolving staging...');
        stageSpinner.start();
        const stagingResult = await this.resolveAndApplyStaging();
        if (isErr(stagingResult)) {
            stageSpinner.fail('Staging failed');
            return stagingResult as any;
        }
        const totalStaged = stagingResult.value.toStage.length + stagingResult.value.alreadyStaged.length;
        stageSpinner.succeed(
            totalStaged > 0
                ? `Staged ${totalStaged} file${totalStaged !== 1 ? 's' : ''} (${stagingResult.value.reason})`
                : 'No files staged',
        );

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

        // Step 4: Execute commits (if auto-approve AND not dry-run)
        let commitCount = 0;
        let pushed = false;

        if (this.options.dryRun) {
            // v2.1: dry-run is now a real skip. We still show the proposals
            // (already rendered above) and report them as "would apply"
            // so agents get a parseable preview without side effects.
            log.info(`Dry run: ${proposals.length} proposal(s) parsed, no commits applied.`);
        } else if (this.options.autoApprove) {
            const isValid = await this.validateAutoApprove();
            if (!isValid) {
                return err({ type: 'GIT_ERROR', message: 'Auto-approve validation failed' } as any);
            }

            // v2.1: --atomic validates every proposal up front. If any
            // would fail, abort with ZERO commits applied. Without
            // --atomic the legacy behavior is preserved: commit as you
            // go, stop on first failure.
            if (this.options.atomic && proposals.length > 1) {
                for (let i = 0; i < proposals.length; i++) {
                    const v = await this.validateProposal(proposals[i]);
                    if (isErr(v)) {
                        log.error(
                            `Atomic validation failed at proposal ${i + 1}/${proposals.length}: ` +
                            v.error.message,
                        );
                        return err({
                            type: 'COMMIT_EXEC_ERROR',
                            message: `Atomic validation failed: ${v.error.message}`,
                        } as any);
                    }
                }
                log.info(`Atomic validation: ${proposals.length} proposal(s) cleared.`);
            }

            for (let i = 0; i < proposals.length; i++) {
                const commitSpinner = log.spinner(`Commit ${i + 1}/${proposals.length}...`);
                commitSpinner.start();
                const commitResult = await this.applyProposal(proposals[i]);
                if (isErr(commitResult) || !commitResult.value) {
                    commitSpinner.fail('Commit failed');
                    // v2.1: stop on first failure (existing behavior).
                    // Atomic mode wouldn't reach here because validation
                    // already passed for every proposal.
                    break;
                } else {
                    commitSpinner.succeed(proposals[i].title.split('\n')[0].substring(0, 50));
                    commitCount++;
                }
            }

            // Step 5: Push (only if --confirm-push was passed; --noPush default)
            if (commitCount > 0) {
                const pushResult = await this.pushCommits(commitCount);
                pushed = !isErr(pushResult) && pushResult.value;
            }
        } else if (!this.options.isAgent) {
            log.info('Pass --auto-approve (or -y) to execute the proposed commits. ' +
                'Add --confirm-push to also push to the remote.');
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

    // v2.1: --version / -V early-exit. Writes to stdout (not stderr)
    // because agents that probe `--version` want to capture it cleanly.
    if (args.includes('--version') || args.includes('-V')) {
        process.stdout.write(`gemini-commit-wizard v${WIZARD_VERSION}\n`);
        process.exit(ExitCode.SUCCESS);
    }

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
        log.info('  --context-file <path>        Read context from a file');
        log.info('  --work-type <type>           feature|bugfix|refactor|docs|test');
        log.info('  --affected-components <list>  Components changed');
        log.info('  --exhaustive                 Deep analysis mode');
        log.info('  --dry-run                    Show proposals without executing commits or push');
        log.info('  --json                       Machine-readable JSON on stdout (suppresses human output)');
        log.info('  --atomic                     Validate ALL proposals before any commit');
        log.info('  --no-color                   Disable ANSI color output (honors NO_COLOR env)');
        log.info('  --verbose, -v                Show debug output');
        log.info('  --quiet, -q                  Only show errors and results');
        log.info('  --silent                     No output (SDK mode)');
        log.info('  --list-providers             Show available providers');
        log.info('  --version, -V                Print version and exit');
        log.info('  --help, -h                   Show this help');
        log.blank();
        log.info('Staging modes (mutually exclusive):');
        log.info('  --staged-only                Only use files already in the index');
        log.info('  --all                        Stage every modified + untracked file');
        log.info('  --add <files...>             Stage only the comma-separated paths');
        log.info('  --agent / --ci / --no-interactive  Non-interactive mode; requires explicit staging');
        log.blank();
        log.info('Exit codes:');
        log.info('  0  success');
        log.info('  1  unspecified error');
        log.info('  2  no changes to process');
        log.info('  3  AI provider error');
        log.info('  4  parse error (AI response malformed)');
        log.info('  5  commit execution error');
        log.info('  6  push cancelled / git error during push');
        log.info('  7  validation failed (auto-approve refused)');
        log.info('  8  staging error');
        log.blank();
        process.exit(ExitCode.SUCCESS);
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
        process.exit(ExitCode.SUCCESS);
    }

    const options = parseCliArgs(process.argv);
    const generator = new CommitGenerator(options);
    const result = await generator.generate();

    // v2.1: when --json is set, write a structured envelope to stdout.
    // All human output is already suppressed via setVerbosity('silent').
    if (options.json) {
        const envelope = buildJsonEnvelope(result, options.dryRun ?? false);
        writeJson(envelope);
    } else if (isErr(result)) {
        log.error(result.error.message);
    }

    // v2.1: map the domain error to a distinct exit code so agents
    // can branch on "no changes" vs "AI failed" vs "push cancelled".
    process.exit(isErr(result) ? mapErrorToExitCode(result.error) : ExitCode.SUCCESS);
}
