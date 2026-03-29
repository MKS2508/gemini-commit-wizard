/**
 * Provider type definitions for AI commit generation backends.
 * @module types/provider
 */

/**
 * Supported AI provider identifiers.
 */
export type ProviderName = 'gemini-cli' | 'gemini-sdk' | 'groq' | 'openrouter';

/**
 * Common interface for all AI providers.
 *
 * @example
 * ```typescript
 * const provider: IAIProvider = createProvider('groq');
 * if (provider.isAvailable()) {
 *   const response = await provider.generate(prompt);
 * }
 * ```
 */
export interface IAIProvider {
    /** Human-readable provider name */
    name: string;
    /** Provider identifier */
    id: ProviderName;
    /** Model being used */
    model: string;
    /**
     * Generate a response from the AI model.
     * @param prompt - The prompt to send
     * @returns The AI-generated text response
     */
    generate(prompt: string): Promise<string>;
    /**
     * Check if this provider is available (API key set, binary found, etc.).
     * @returns Whether the provider can be used
     */
    isAvailable(): boolean;
}
