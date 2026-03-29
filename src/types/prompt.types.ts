/**
 * Prompt template type definitions.
 * @module types/prompt
 */

/**
 * Configuration for building AI prompts.
 */
export interface IGeminiPromptConfig {
    /** Project context passed into the prompt */
    projectContext: {
        name: string;
        description: string;
        version: string;
        techStack: string[];
        targetPlatform: string;
    };
    /** Type of analysis to perform */
    analysisType: 'commit' | 'workflow' | 'release';
    /** Additional context provided by the user */
    specificContext?: string;
    /** Extra data to include in the prompt */
    data?: any;
    /** Project components for scope hints */
    components?: Array<{ id: string; path: string; name: string }>;
    /** Commit format preferences */
    commitFormat?: {
        titleLanguage?: string;
        bodyLanguage?: string;
        includeTechnical?: boolean;
        includeChangelog?: boolean;
    };
}

/**
 * Standard structured response from the AI.
 */
export interface IStandardResponseFormat {
    /** Free-form analysis text */
    analysis: string;
    /** AI recommendations */
    recommendations: string;
    /** Structured data entries */
    structured_data: any[];
}
