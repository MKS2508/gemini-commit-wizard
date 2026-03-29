/**
 * Version management type definitions.
 * @module types/version
 */

/**
 * A single entry in the changelog.
 */
export interface IChangelogEntry {
    /** Type of change */
    type: 'feature' | 'fix' | 'improvement' | 'breaking';
    /** Short title */
    title: string;
    /** Detailed description */
    description: string;
}

/**
 * A version entry with its associated changes.
 */
export interface IVersion {
    /** Semantic version string */
    version: string;
    /** Release date (ISO format) */
    date: string;
    /** Release type */
    type: 'initial' | 'major' | 'minor' | 'patch';
    /** Release title */
    title: string;
    /** List of changes in this version */
    changes: IChangelogEntry[];
    /** Technical notes */
    technical_notes: string;
    /** List of breaking changes */
    breaking_changes: string[];
    /** Git commit hash for this version */
    commit_hash: string;
    /** Pre-release prefix (e.g., 'alpha', 'beta') */
    prefix?: string;
}

/**
 * Full changelog data structure.
 */
export interface IChangelogData {
    /** Current version string */
    current_version: string;
    /** All version entries */
    versions: IVersion[];
}

/**
 * Information about a commit for version analysis.
 */
export interface IVersionCommitInfo {
    /** Commit hash */
    hash: string;
    /** Commit date */
    date: string;
    /** Commit title (first line of message) */
    title: string;
    /** Full commit description */
    description: string;
    /** Extracted technical section */
    technical_section?: string;
    /** Extracted changelog section */
    changelog_section?: string;
}
