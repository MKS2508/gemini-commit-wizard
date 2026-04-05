/**
 * OpenRouter provider — access to 300+ models via @openrouter/sdk.
 * @module providers/openrouter
 */

import { tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type { IAIProvider, ProviderName } from '../types/index.js';

/**
 * Provider using OpenRouter for access to 300+ models (Claude, GPT, Llama, etc.).
 * Requires the `OPENROUTER_API_KEY` environment variable.
 *
 * @example
 * ```typescript
 * const provider = new OpenRouterProvider('anthropic/claude-sonnet-4');
 * if (provider.isAvailable()) {
 *   const text = await provider.generate(prompt);
 * }
 * ```
 */
export class OpenRouterProvider implements IAIProvider {
    /** @inheritdoc */
    name = 'OpenRouter';
    /** @inheritdoc */
    id: ProviderName = 'openrouter';
    /** @inheritdoc */
    model: string;

    /**
     * @param model - Model to use (defaults to anthropic/claude-sonnet-4)
     */
    constructor(model?: string) {
        this.model = model || 'anthropic/claude-sonnet-4';
    }

    /**
     * Check if OPENROUTER_API_KEY is set.
     * @returns Whether the API key is available
     */
    isAvailable(): boolean {
        return !!process.env.OPENROUTER_API_KEY;
    }

    /**
     * Generate a response using the OpenRouter SDK.
     * @param prompt - The prompt text to send
     * @returns The model's text response
     */
    async generate(prompt: string): Promise<string> {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY environment variable is not set');
        }

        const { OpenRouter } = await import('@openrouter/sdk');
        const client = new OpenRouter({ apiKey });

        const result = await client.chat.send({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
        } as any);

        return (result as any).choices?.[0]?.message?.content || '';
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
