/**
 * Structured output for agent/CI consumption.
 *
 * Two responsibilities:
 * 1. Map domain errors to numeric exit codes (so agents can branch on
 *    "no changes" vs "AI failed" vs "push cancelled" etc.).
 * 2. Write a stable JSON envelope to stdout when `--json` is set,
 *    suppressing all human output (logger) so the agent gets a clean
 *    parseable stream.
 *
 * The JSON shape is documented on `ICommitGeneratorOptions.json` and is
 * additive — new fields may be added in minor versions, but existing
 * fields will not be removed or renamed.
 *
 * @module reporter
 */

import type { Result, ResultError } from '@mks2508/no-throw';
import { isErr } from '@mks2508/no-throw';
import type { CommitErrorCode, ICommitProposal, ICommitResult } from './types/index.js';

/**
 * Numeric exit codes for the CLI entry point.
 *
 * Agents should match on these codes (NOT on stdout messages) to
 * branch on outcome. The mapping from `CommitErrorCode` → `ExitCode`
 * lives in `mapErrorToExitCode` below.
 */
export const ExitCode = {
    /** All operations succeeded. JSON envelope has `ok: true`. */
    SUCCESS: 0,
    /** Unspecified / unclassified error. */
    ERROR: 1,
    /** Repository has no changes to process. Not an error per se. */
    NO_CHANGES: 2,
    /** AI provider call failed (network, auth, rate limit, etc.). */
    PROVIDER_ERROR: 3,
    /** AI response could not be parsed into valid proposals. */
    PARSE_ERROR: 4,
    /** A commit execution step failed (missing files, git error, etc.). */
    COMMIT_ERROR: 5,
    /** Push was cancelled by user or rejected by remote. */
    PUSH_CANCELLED: 6,
    /** Pre-flight validation refused the run (auto-approve on detached HEAD, etc.). */
    VALIDATION_FAILED: 7,
    /** Staging decision or staging application failed. */
    STAGING_ERROR: 8,
} as const;

export type ExitCodeValue = typeof ExitCode[keyof typeof ExitCode];

/**
 * Stable JSON envelope written to stdout when `--json` is set.
 *
 * On success, `proposals`, `commitCount`, `pushed` and metadata are
 * always present. On failure, `error` is always present and the
 * success-only fields are absent.
 */
export type JsonEnvelope =
    | {
        ok: true;
        dryRun: boolean;
        commitCount: number;
        pushed: boolean;
        proposals: Array<{
            title: string;
            description: string;
            technical: string;
            changelog: string;
            files: string[];
        }>;
        providerName: string;
        modelName: string;
        elapsedMs: number;
    }
    | {
        ok: false;
        dryRun: boolean;
        error: {
            type: CommitErrorCode | 'UNKNOWN_ERROR';
            message: string;
        };
    };

/**
 * Map a domain error to its numeric exit code.
 *
 * Reads BOTH `error.code` (set by `resultError` from
 * `@mks2508/no-throw`) AND `error.type` (used by older wizard code
 * that returned plain `{ type, message }` objects). Unknown codes
 * fall back to `ERROR` (1). Callers should treat any new code added
 * in future minor versions as a generic error unless they update
 * this mapping.
 *
 * @param error - The error from the Result
 * @returns Numeric exit code
 */
export function mapErrorToExitCode(error: ResultError<CommitErrorCode>): ExitCodeValue {
    const code = (error as any).code ?? (error as any).type;
    switch (code) {
        case 'NO_CHANGES':
            return ExitCode.NO_CHANGES;
        case 'PROVIDER_ERROR':
            return ExitCode.PROVIDER_ERROR;
        case 'PARSE_ERROR':
            return ExitCode.PARSE_ERROR;
        case 'COMMIT_EXEC_ERROR':
            return ExitCode.COMMIT_ERROR;
        case 'PUSH_CANCELLED':
        case 'GIT_ERROR':
            return ExitCode.PUSH_CANCELLED;
        case 'STAGING_ERROR':
            return ExitCode.STAGING_ERROR;
        default:
            return ExitCode.ERROR;
    }
}

/**
 * Slim down a proposal to the agent-relevant fields only.
 *
 * Drops internal fields like `id` if any are added later — agents
 * only need what they can present or post-process.
 *
 * @param p - Internal proposal
 * @returns JSON-safe proposal shape
 */
function slimProposal(p: ICommitProposal): JsonEnvelope & { ok: true } extends infer _ ? never : never;
function slimProposal(p: ICommitProposal): {
    title: string;
    description: string;
    technical: string;
    changelog: string;
    files: string[];
} {
    return {
        title: p.title,
        description: p.description,
        technical: p.technical,
        changelog: p.changelog,
        files: p.files ?? [],
    };
}

/**
 * Build the JSON envelope for a `generate()` result.
 *
 * Pure function — does not write to stdout. The CLI entry point
 * decides when (and whether) to call `writeJson()`.
 *
 * @param result - The Result from CommitGenerator.generate()
 * @param dryRun - Whether `--dry-run` was set
 * @returns The JSON envelope
 */
export function buildJsonEnvelope(
    result: Result<ICommitResult, ResultError<CommitErrorCode>>,
    dryRun: boolean,
): JsonEnvelope {
    if (isErr(result)) {
        const errAny = result.error as any;
        return {
            ok: false,
            dryRun,
            error: {
                type: (errAny.code ?? errAny.type ?? 'UNKNOWN_ERROR') as CommitErrorCode,
                message: result.error.message,
            },
        };
    }

    return {
        ok: true,
        dryRun,
        commitCount: result.value.commitCount,
        pushed: result.value.pushed,
        proposals: result.value.proposals.map(slimProposal),
        providerName: result.value.providerName,
        modelName: result.value.modelName,
        elapsedMs: result.value.elapsedMs,
    };
}

/**
 * Write the JSON envelope to stdout followed by a single newline.
 *
 * Use ONLY when `--json` is set. Writes are synchronous and
 * unbuffered; agents can rely on the full payload arriving before
 * the process exits.
 *
 * @param envelope - The envelope to serialize
 */
export function writeJson(envelope: JsonEnvelope): void {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
}