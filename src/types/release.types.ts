/**
 * GitHub release management type definitions.
 * @module types/release
 */

import type { IChangelogEntry } from './version.types.js';

/**
 * Information needed to create a GitHub release.
 */
export interface IReleaseInfo {
    /** Version string */
    version: string;
    /** Pre-release prefix */
    prefix?: string;
    /** Base version without prefix */
    baseVersion: string;
    /** Package path */
    path: string;
    /** Files included in the release */
    files: string[];
    /** README content */
    readme: string;
    /** Whether this is a pre-release */
    isPrerelease: boolean;
}

/**
 * Version data for a GitHub release.
 */
export interface IVersionData {
    /** Version string */
    version: string;
    /** Release date */
    date: string;
    /** Release type */
    type: 'initial' | 'major' | 'minor' | 'patch';
    /** Release title */
    title: string;
    /** List of changes */
    changes: IChangelogEntry[];
    /** Technical notes */
    technical_notes: string;
    /** Breaking changes */
    breaking_changes: string[];
}

/**
 * Auto-release parsed version info.
 */
export interface IAutoReleaseInfo {
    /** Full version string */
    version: string;
    /** Pre-release prefix */
    prefix: string;
    /** Major version number */
    major: number;
    /** Minor version number */
    minor: number;
    /** Patch version number */
    patch: number;
}

/**
 * Error codes for GitHub release operations.
 */
export type ReleaseErrorCode =
    | 'RELEASE_ERROR' // General release operation error
    | 'GIT_ERROR' // Git command failure
    | 'GITHUB_CLI_ERROR' // GitHub CLI not available or failed
    | 'FILE_READ_ERROR'; // Failed to read changelog
