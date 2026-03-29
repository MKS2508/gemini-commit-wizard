/**
 * gemini-commit-wizard — AI-powered Git commit generation with multi-provider support.
 *
 * @example
 * ```typescript
 * import { CommitGenerator, createProvider, loadProjectConfig } from 'gemini-commit-wizard';
 *
 * const generator = new CommitGenerator({
 *   provider: 'groq',
 *   autoApprove: true,
 *   noPush: true,
 * });
 *
 * const result = await generator.generate();
 * ```
 *
 * @module gemini-commit-wizard
 */

// ─── Core Classes ────────────────────────────────────────────
export { CommitGenerator } from './commit-generator.js';
export { CommitUI } from './commit-ui.js';
export { VersionManager } from './version-manager.js';
export { GitHubReleaseManager } from './github-release-manager.js';
export { AutoReleaseManagerAI } from './auto-release-gemini.js';

// ─── Git SDK ─────────────────────────────────────────────────
export { GitClient } from './git-client.js';
export type { IGitClientOptions } from './git-client.js';

// ─── Provider System ─────────────────────────────────────────
export { createProvider, listProviders } from './providers/index.js';
export { GeminiSdkProvider } from './providers/gemini-sdk.js';
export { GeminiCliProvider } from './providers/gemini-cli.js';
export { GroqProvider } from './providers/groq.js';
export { OpenRouterProvider } from './providers/openrouter.js';

// ─── Configuration ───────────────────────────────────────────
export { loadProjectConfig } from './project-config.js';

// ─── Prompt Templates & Parsing ──────────────────────────────
export {
    createCommitPrompt,
    createWorkflowPrompt,
    createReleasePrompt,
    GeminiResponseParser,
} from './prompt-templates.js';

// ─── Git Utilities (now with simple-git) ─────────────────────
export {
    parseGitStatus,
    getFileArea,
    areFilesRelated,
    suggestCommitType,
    analyzeDiff,
    generateTechnicalSummary,
    getGitStatus,
    getGitDiff,
    getGitLog,
    gitAdd,
    gitCommit,
    gitPush,
    gitPull,
    gitFetch,
    gitGetCurrentBranch,
} from './git-utils.js';

// ─── Types (re-exported from src/types/) ─────────────────────
export type {
    // Provider
    ProviderName,
    IAIProvider,
    // Config
    IProjectConfig,
    IProjectComponent,
    ICommitFormat,
    // Commit
    IFileChange,
    IGitStats,
    ICommitAnalysis,
    ICommitProposal,
    ICommitOptions,
    // Prompt
    IGeminiPromptConfig,
    IStandardResponseFormat,
    // Git
    IGitFileStatus,
    IGitCommitInfo,
    // Version
    IChangelogEntry,
    IVersion,
    IChangelogData,
    IVersionCommitInfo,
    // Release
    IReleaseInfo,
    IVersionData,
    IAutoReleaseInfo,
    // SDK
    ICommitGeneratorOptions,
    ICommitResult,
    CommitErrorCode,
    VersionErrorCode,
    ReleaseErrorCode,
} from './types/index.js';
