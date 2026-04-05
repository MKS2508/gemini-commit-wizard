# Fix Plan: gemini-commit-wizard v1.2.2

## Problem Summary

TypeScript type errors in `version-manager.ts`, `commit-generator.ts`, and `github-release-manager.ts` due to **missing error code type definitions**.

### Root Cause

Three error code types are imported but never defined:
- `VersionErrorCode` — imported in `version-manager.ts` line 19
- `CommitErrorCode` — imported in `commit-generator.ts` (needs verification)
- `ReleaseErrorCode` — imported in `github-release-manager.ts` line 13

### Error Details

| File | Line | Missing Type | Usage |
|------|------|--------------|-------|
| `version-manager.ts` | 19 | `VersionErrorCode` | Used in `ResultError<VersionErrorCode>` |
| `commit-generator.ts` | - | `CommitErrorCode` | Used in `ResultError<CommitErrorCode>` |
| `github-release-manager.ts` | 13 | `ReleaseErrorCode` | Used in `ResultError<ReleaseErrorCode>` |

### Error Codes Used in Code

| File | Error Code | Location |
|------|------------|----------|
| `version-manager.ts` | `'VERSION_ERROR'` | Lines 432, 545, 633 |
| `version-manager.ts` | `'NO_CHANGES'` | Line 538 (via err() call) |
| `github-release-manager.ts` | `'RELEASE_ERROR'` | Line 323 |
| `commit-generator.ts` | Various | Need to analyze |

## Solution

### 1. Add `VersionErrorCode` to `src/types/version.types.ts`

```typescript
/**
 * Error codes for version management operations.
 */
export type VersionErrorCode =
    | 'VERSION_ERROR'        // General version operation error
    | 'NO_CHANGES'           // No new commits to version
    | 'GIT_ERROR'            // Git command failure
    | 'FILE_WRITE_ERROR'     // Failed to write changelog/config
    | 'INVALID_VERSION';     // Invalid version string
```

### 2. Add `CommitErrorCode` to `src/types/commit.types.ts`

```typescript
/**
 * Error codes for commit generation operations.
 */
export type CommitErrorCode =
    | 'NO_CHANGES'           // No staged changes
    | 'GIT_ERROR'            // Git command failure
    | 'PROVIDER_ERROR'       // AI provider failure
    | 'STAGING_ERROR'        // Failed to stage changes
    | 'COMMIT_EXEC_ERROR';   // Failed to execute commit
```

### 3. Add `ReleaseErrorCode` to `src/types/release.types.ts`

```typescript
/**
 * Error codes for GitHub release operations.
 */
export type ReleaseErrorCode =
    | 'RELEASE_ERROR'        // General release operation error
    | 'GIT_ERROR'            // Git command failure
    | 'GITHUB_CLI_ERROR'     // GitHub CLI not available or failed
    | 'FILE_READ_ERROR';     // Failed to read changelog
```

## Implementation Steps

1. [ ] Edit `src/types/version.types.ts` — Add `VersionErrorCode` type
2. [ ] Edit `src/types/commit.types.ts` — Add `CommitErrorCode` type
3. [ ] Edit `src/types/release.types.ts` — Add `ReleaseErrorCode` type
4. [ ] Verify typecheck passes: `cd /path/to/mks-mission-control && bun run typecheck`
5. [ ] Update package.json version to `1.2.2`
6. [ ] Commit with structured commit message
7. [ ] Push to GitHub
8. [ ] Verify npm registry update (or manual publish if needed)

## Testing

After fix, verify:
```bash
cd /Volumes/KODAK1TB/REPOS\ y\ PROYECTOS/nodejs-bun/mks-mission-control
bun run typecheck
```

Should show 0 errors related to `gemini-commit-wizard`.

## Version Bump

- Current: `1.2.1`
- Next: `1.2.2` (patch — bug fix)

## Files to Modify

1. `src/types/version.types.ts`
2. `src/types/commit.types.ts`
3. `src/types/release.types.ts`
4. `package.json` (version bump)
