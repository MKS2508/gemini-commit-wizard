/**
 * Groq provider — ultra-fast inference via groq-sdk.
 * @module providers/groq
 */

import { tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type { IAIProvider, ProviderName } from '../types/index.js';

/**
 * Provider using the Groq SDK for ultra-fast LLM inference.
 * Requires the `GROQ_API_KEY` environment variable.
 *
 * @example
 * ```typescript
 * const provider = new GroqProvider('llama-3.3-70b-versatile');
 * if (provider.isAvailable()) {
 *   const text = await provider.generate(prompt);
 * }
 * ```
 */
export class GroqProvider implements IAIProvider {
    /** @inheritdoc */
    name = 'Groq';
    /** @inheritdoc */
    id: ProviderName = 'groq';
    /** @inheritdoc */
    model: string;

    /**
     * @param model - Model to use (defaults to llama-3.3-70b-versatile)
     */
    constructor(model?: string) {
        this.model = model || 'llama-3.3-70b-versatile';
    }

    /**
     * Check if GROQ_API_KEY is set.
     * @returns Whether the API key is available
     */
    isAvailable(): boolean {
        return !!process.env.GROQ_API_KEY;
    }

    /**
     * Generate a response using the Groq SDK.
     * @param prompt - The prompt text to send
     * @returns The model's text response
     */
    async generate(prompt: string): Promise<string> {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error('GROQ_API_KEY environment variable is not set');
        }

        const Groq = (await import('groq-sdk')).default;
        const client = new Groq({ apiKey });

        const completion = await client.chat.completions.create({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 4096,
        });

        return completion.choices[0]?.message?.content || '';
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
