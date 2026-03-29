/**
 * Unified Git SDK client combining Git operations + GitHub API + AI capabilities.
 *
 * @example
 * ```typescript
 * import { GitClient } from 'gemini-commit-wizard';
 *
 * const client = new GitClient({
 *   repoPath: '/path/to/repo',
 *   githubToken: process.env.GITHUB_TOKEN,
 * });
 *
 * const status = await client.status();
 * const issues = await client.listIssues('owner', 'repo');
 * ```
 *
 * @module git-client
 */

import { simpleGit, SimpleGit, StatusResult, LogResult } from 'simple-git';
import { Octokit } from 'octokit';
import { ok, err, type Result } from '@mks2508/no-throw';

/**
 * Options for creating a GitClient instance.
 */
export interface IGitClientOptions {
    /** Repository root path (defaults to cwd) */
    repoPath?: string;
    /** GitHub auth token (for Octokit) */
    githubToken?: string;
    /** GitHub Enterprise URL (if using GitHub Enterprise) */
    githubUrl?: string;
}

/**
 * Unified Git SDK client combining Git operations + GitHub API.
 */
export class GitClient {
    private git: SimpleGit;
    private octokit: Octokit | null = null;

    constructor(options: IGitClientOptions = {}) {
        this.git = simpleGit(options.repoPath || process.cwd());

        if (options.githubToken) {
            this.octokit = new Octokit({
                auth: options.githubToken,
                baseUrl: options.githubUrl ? `${options.githubUrl}/api/v3` : undefined,
            });
        }
    }

    // ─── Git Operations (simple-git wrapper) ─────────────

    /**
     * Get repository status.
     * @returns Result with StatusResult or Error
     */
    async status(): Promise<Result<StatusResult, Error>> {
        try {
            const status = await this.git.status();
            return ok(status);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Get diff between refs or working directory.
     * @param from - From ref (optional)
     * @param to - To ref (optional)
     * @returns Result with diff output or Error
     */
    async diff(from?: string, to?: string): Promise<Result<string, Error>> {
        try {
            const diff = from && to ? await this.git.diff([from, to]) : await this.git.diff();
            return ok(diff);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Get commit log.
     * @param options - Log options
     * @returns Result with LogResult or Error
     */
    async log(options?: { from?: string; to?: string; maxCount?: number; file?: string }): Promise<Result<LogResult, Error>> {
        try {
            const log = await this.git.log(options);
            return ok(log);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Stage files for commit.
     * @param files - File paths or array of file paths
     * @returns Result with command output or Error
     */
    async add(files: string | string[]): Promise<Result<string, Error>> {
        try {
            const result = await this.git.add(Array.isArray(files) ? files : [files]);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Commit staged changes.
     * @param message - Commit message
     * @param options - Optional commit options
     * @returns Result with commit result or Error
     */
    async commit(message: string, options?: { author?: string }): Promise<Result<string, Error>> {
        try {
            const result = await this.git.commit(message, [], options);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Unstage files.
     * @param files - File paths or array of file paths
     * @returns Result with command output or Error
     */
    async reset(files: string | string[]): Promise<Result<string, Error>> {
        try {
            const result = await this.git.reset(Array.isArray(files) ? ['--', ...files] : ['--', files]);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Discard changes to files.
     * @param files - File paths or array of file paths
     * @returns Result with command output or Error
     */
    async checkout(files: string | string[]): Promise<Result<string, Error>> {
        try {
            const result = await this.git.checkout(Array.isArray(files) ? ['--', ...files] : ['--', files]);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * List all branches.
     * @returns Result with array of branch names or Error
     */
    async branch(): Promise<Result<string[], Error>> {
        try {
            const branches = await this.git.branch();
            return ok(branches.all);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Create and checkout new branch.
     * @param branchName - Name of the new branch
     * @param startPoint - Starting point for the new branch (optional)
     * @returns Result with command output or Error
     */
    async checkoutBranch(branchName: string, startPoint?: string): Promise<Result<string, Error>> {
        try {
            if (startPoint) {
                const result = await this.git.checkoutBranch(branchName, startPoint);
                return ok(result);
            }
            const result = await this.git.checkoutLocalBranch(branchName);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Delete a branch.
     * @param branchName - Name of the branch to delete
     * @param force - Force delete even if not merged
     * @returns Result with command output or Error
     */
    async deleteBranch(branchName: string, force = false): Promise<Result<string, Error>> {
        try {
            const result = await this.git.deleteLocalBranch(branchName, force);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Merge branch into current.
     * @param branch - Branch name to merge
     * @returns Result with merge result or Error
     */
    async merge(branch: string): Promise<Result<string, Error>> {
        try {
            const result = await this.git.merge([branch]);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Push to remote.
     * @param remote - Remote name (optional, defaults to 'origin')
     * @param branch - Branch name (optional)
     * @returns Result with push result or Error
     */
    async push(remote?: string, branch?: string): Promise<Result<string, Error>> {
        try {
            const result = await this.git.push(remote, branch);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Pull from remote.
     * @param remote - Remote name (optional, defaults to 'origin')
     * @param branch - Branch name (optional)
     * @returns Result with pull result or Error
     */
    async pull(remote?: string, branch?: string): Promise<Result<string, Error>> {
        try {
            const result = await this.git.pull(remote, branch);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Fetch from remote.
     * @param remote - Remote name (optional)
     * @param branch - Branch name (optional)
     * @returns Result with fetch result or Error
     */
    async fetch(remote?: string, branch?: string): Promise<Result<string, Error>> {
        try {
            if (remote && branch) {
                const result = await this.git.fetch(remote, branch);
                return ok(result);
            }
            const result = await this.git.fetch();
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Stash changes.
     * @param message - Optional stash message
     * @returns Result with stash result or Error
     */
    async stash(message?: string): Promise<Result<string, Error>> {
        try {
            const result = message ? await this.git.stash(['push', '-m', message]) : await this.git.stash();
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Unstash changes.
     * @param index - Stash index to pop (optional)
     * @returns Result with stash pop result or Error
     */
    async stashPop(index?: number): Promise<Result<string, Error>> {
        try {
            const result = index !== undefined ? await this.git.stash(['pop', `stash@{${index}}`]) : await this.git.stash(['pop']);
            return ok(result);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * List stash entries.
     * @returns Result with stash list or Error
     */
    async stashList(): Promise<Result<string, Error>> {
        try {
            const result = await this.git.stashList();
            return ok(result.all.map(s => `${s.hash} - ${s.message}`).join('\n'));
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Get current branch name.
     * @returns Result with branch name or Error
     */
    async getCurrentBranch(): Promise<Result<string, Error>> {
        try {
            const branches = await this.git.branch();
            return ok(branches.current);
        } catch (e) {
            return err(e as Error);
        }
    }

    // ─── GitHub API Operations (Octokit wrapper) ─────────

    /**
     * Check if GitHub client is available.
     */
    get hasGitHub(): boolean {
        return this.octokit !== null;
    }

    /**
     * Get Octokit instance (throws if not configured).
     */
    private requireGitHub(): Octokit {
        if (!this.octokit) {
            throw new Error('GitHub client not configured. Provide githubToken in options.');
        }
        return this.octokit;
    }

    /**
     * Get repository info.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @returns Result with repository data or Error
     */
    async getRepo(owner: string, repo: string) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.repos.get({ owner, repo });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * List issues.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @param options - Optional list options
     * @returns Result with issues array or Error
     */
    async listIssues(owner: string, repo: string, options?: { state?: 'open' | 'closed' | 'all'; per_page?: number }) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.issues.listForRepo({ owner, repo, ...options });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Create issue.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @param title - Issue title
     * @param body - Issue body (optional)
     * @param labels - Issue labels (optional)
     * @returns Result with created issue or Error
     */
    async createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[]) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.issues.create({ owner, repo, title, body, labels });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * List pull requests.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @param options - Optional list options
     * @returns Result with PRs array or Error
     */
    async listPullRequests(owner: string, repo: string, options?: { state?: 'open' | 'closed' | 'all'; per_page?: number }) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.pulls.list({ owner, repo, ...options });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Create pull request.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @param title - PR title
     * @param head - Head branch
     * @param base - Base branch
     * @param body - PR body (optional)
     * @returns Result with created PR or Error
     */
    async createPullRequest(owner: string, repo: string, title: string, head: string, base: string, body?: string) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.pulls.create({ owner, repo, title, head, base, body });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Create release.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @param tagName - Tag name for the release
     * @param name - Release name
     * @param body - Release notes (optional)
     * @param draft - Whether this is a draft release
     * @returns Result with created release or Error
     */
    async createRelease(owner: string, repo: string, tagName: string, name: string, body?: string, draft = false) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.repos.createRelease({ owner, repo, tag_name: tagName, name, body, draft });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Get latest release.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @returns Result with latest release or Error
     */
    async getLatestRelease(owner: string, repo: string) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.repos.getLatestRelease({ owner, repo });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * List releases.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @returns Result with releases array or Error
     */
    async listReleases(owner: string, repo: string) {
        const octokit = this.requireGitHub();
        try {
            const { data } = await octokit.rest.repos.listReleases({ owner, repo });
            return ok(data);
        } catch (e) {
            return err(e as Error);
        }
    }

    /**
     * Delete release.
     * @param owner - Repository owner
     * @param repo - Repository name
     * @param releaseId - Release ID
     * @returns Result with deletion status or Error
     */
    async deleteRelease(owner: string, repo: string, releaseId: number) {
        const octokit = this.requireGitHub();
        try {
            await octokit.rest.repos.deleteRelease({ owner, repo, release_id: releaseId });
            return ok(undefined);
        } catch (e) {
            return err(e as Error);
        }
    }
}
