/**
 * Gemini SDK provider — uses the official @google/genai package.
 * @module providers/gemini-sdk
 */

import { tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type { IAIProvider, ProviderName } from '../types/index.js';

/**
 * Provider using the official Google GenAI SDK.
 * Requires the `GEMINI_API_KEY` environment variable.
 *
 * @example
 * ```typescript
 * const provider = new GeminiSdkProvider('gemini-2.5-flash');
 * if (provider.isAvailable()) {
 *   const text = await provider.generate(prompt);
 * }
 * ```
 */
export class GeminiSdkProvider implements IAIProvider {
    /** @inheritdoc */
    name = 'Gemini SDK';
    /** @inheritdoc */
    id: ProviderName = 'gemini-sdk';
    /** @inheritdoc */
    model: string;

    /**
     * @param model - Model to use (defaults to gemini-2.5-flash)
     */
    constructor(model?: string) {
        this.model = model || 'gemini-2.5-flash';
    }

    /**
     * Check if GEMINI_API_KEY is set.
     * @returns Whether the API key is available
     */
    isAvailable(): boolean {
        return !!process.env.GEMINI_API_KEY;
    }

    /**
     * Generate a response using the Google GenAI SDK.
     * @param prompt - The prompt text to send
     * @returns The model's text response
     */
    async generate(prompt: string): Promise<string> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }

        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
            model: this.model,
            contents: prompt,
        });

        return response.text || '';
    }

    /**
     * Generate with Result pattern wrapping.
     * @param prompt - The prompt text to send
     * @returns Result with the generated text or a PROVIDER_ERROR
     */
    async safeGenerate(prompt: string): Promise<Result<string, ResultError<'PROVIDER_ERROR'>>> {
        return tryCatchAsync(async () => this.generate(prompt), 'PROVIDER_ERROR');
    }
}
