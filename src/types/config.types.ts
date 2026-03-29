/**
 * Project configuration type definitions.
 * @module types/config
 */

import type { ProviderName } from './provider.types.js';

/**
 * A project component used as a commit scope area.
 */
export interface IProjectComponent {
    /** Unique component identifier */
    id: string;
    /** Filesystem path to the component */
    path: string;
    /** Human-readable component name */
    name: string;
}

/**
 * Commit message format configuration.
 */
export interface ICommitFormat {
    /** Language for commit title (e.g., 'en', 'es') */
    titleLanguage?: string;
    /** Language for commit body */
    bodyLanguage?: string;
    /** Whether to include technical details section */
    includeTechnical?: boolean;
    /** Whether to include changelog section */
    includeChangelog?: boolean;
}

/**
 * Project configuration loaded from .commit-wizard.json or package.json.
 */
export interface IProjectConfig {
    /** Project name */
    name: string;
    /** Project description */
    description: string;
    /** Current version string */
    version: string;
    /** Technology stack (e.g., ['TypeScript', 'Bun', 'React']) */
    techStack: string[];
    /** Target platform (e.g., 'Node.js', 'Browser', 'CLI') */
    targetPlatform: string;
    /** Project components for commit scoping */
    components?: IProjectComponent[];
    /** Commit format preferences */
    commitFormat?: ICommitFormat;
    /** Preferred AI provider */
    provider?: ProviderName;
    /** Preferred AI model */
    model?: string;
}
