/**
 * Git utility type definitions.
 * @module types/git
 */

/**
 * Status information for a single file in the git working tree.
 */
export interface IGitFileStatus {
    /** Relative file path */
    path: string;
    /** Whether the file has staged changes */
    staged: boolean;
    /** Whether the file has unstaged changes */
    unstaged: boolean;
    /** Whether the file is untracked */
    untracked: boolean;
    /** Whether the file is deleted */
    deleted: boolean;
    /** New path if the file was renamed */
    renamed?: string;
}

/**
 * Information about a single git commit.
 */
export interface IGitCommitInfo {
    /** Short or full commit hash */
    hash: string;
    /** Commit message (first line) */
    message: string;
    /** Commit author name */
    author: string;
    /** Commit date string */
    date: string;
}
