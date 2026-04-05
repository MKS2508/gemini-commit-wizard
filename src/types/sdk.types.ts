/**
 * SDK-specific type definitions for programmatic usage.
 * @module types/sdk
 */

import type { ProviderName } from './provider.types.js';
import type { ICommitProposal } from './commit.types.js';
import type { Result } from '@mks2508/no-throw';

/**
 * Options for creating a CommitGenerator instance.
 *
 * @example
 * ```typescript
 * const generator = new CommitGenerator({
 *   provider: 'groq',
 *   autoApprove: true,
 *   noPush: true,
 * });
 * ```
 */
export interface ICommitGeneratorOptions {
    /** Project root directory (defaults to cwd) */
    projectRoot?: string;
    /** AI provider to use */
    provider?: ProviderName;
    /** Override the default model for the selected provider */
    model?: string;
    /** Auto-approve commit proposals without prompting */
    autoApprove?: boolean;
    /** Skip git push after committing */
    noPush?: boolean;
    /** Perform exhaustive analysis (include full file diffs) */
    exhaustive?: boolean;
    /** Additional context describing the changes */
    context?: string;
    /** Type of work (feature, fix, refactor, docs, test) */
    workType?: string;
    /** Comma-separated list of affected component IDs */
    affectedComponents?: string;
    /** Analyze and show proposals without executing commits */
    dryRun?: boolean;
    /** Output proposals as JSON (implies dry-run) */
    json?: boolean;
    /** Show debug-level output */
    verbose?: boolean;
    /** Only show errors and final result */
    quiet?: boolean;
    /** Suppress all output (for SDK/library usage) */
    silent?: boolean;
    /** Show list of available providers and exit */
    listProviders?: boolean;
    /** Run in quick mode (less detailed analysis) */
    quick?: boolean;
}

/**
 * Result returned after successful commit generation.
 */
export interface ICommitResult {
    /** List of applied commit proposals */
    proposals: ICommitProposal[];
    /** Number of commits that were executed */
    commitCount: number;
    /** Whether commits were pushed to remote */
    pushed: boolean;
    /** AI provider that was used */
    providerName: string;
    /** AI model that was used */
    modelName: string;
    /** Total elapsed time in milliseconds */
    elapsedMs: number;
}

/**
 * Error codes for commit generation failures.
 */
export type CommitErrorCode =
    | 'GIT_ERROR'
    | 'PROVIDER_ERROR'
    | 'PROVIDER_CHECK_ERROR'
    | 'PARSE_ERROR'
    | 'CONFIG_ERROR'
    | 'STAGING_ERROR'
    | 'COMMIT_EXEC_ERROR'
    | 'NO_CHANGES'
    | 'CANCELLED';

/**
 * Error codes for version management failures.
 */
export type VersionErrorCode =
    | 'VERSION_ERROR'
    | 'GIT_ERROR'
    | 'VERSION_PARSE_ERROR'
    | 'CHANGELOG_ERROR'
    | 'FILE_WRITE_ERROR'
    | 'NO_CHANGES'
    | 'INVALID_VERSION';

/**
 * Error codes for GitHub release failures.
 */
export type ReleaseErrorCode =
    | 'RELEASE_ERROR'
    | 'GIT_ERROR'
    | 'BUILD_ERROR'
    | 'GITHUB_ERROR'
    | 'GITHUB_CLI_ERROR'
    | 'PROVIDER_ERROR'
    | 'FILE_READ_ERROR';

/**
 * Git operation result type alias for convenience.
 */
export type GitResult<T> = Result<T, GitError>;

/**
 * Git operation error with structured error codes.
 */
export interface GitError {
    /** Error code category */
    code: 'NOT_A_REPOSITORY' | 'NO_REMOTE' | 'AUTH_FAILED' | 'MERGE_CONFLICT' | 'UNKNOWN';
    /** Human-readable error message */
    message: string;
    /** Original error from underlying operation */
    originalError?: Error;
}
