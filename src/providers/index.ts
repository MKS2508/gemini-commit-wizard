/**
 * Provider barrel export — factory, listing, and all provider classes.
 * @module providers
 */

import type { IAIProvider, ProviderName } from '../types/index.js';
import { GeminiCliProvider } from './gemini-cli.js';
import { GeminiSdkProvider } from './gemini-sdk.js';
import { GroqProvider } from './groq.js';
import { OpenRouterProvider } from './openrouter.js';

export { GeminiCliProvider } from './gemini-cli.js';
export { GeminiSdkProvider } from './gemini-sdk.js';
export { GroqProvider } from './groq.js';
export { OpenRouterProvider } from './openrouter.js';

/** Provider factory map */
const PROVIDER_MAP: Record<ProviderName, (model?: string) => IAIProvider> = {
    'gemini-cli': () => new GeminiCliProvider(),
    'gemini-sdk': (model) => new GeminiSdkProvider(model),
    'groq': (model) => new GroqProvider(model),
    'openrouter': (model) => new OpenRouterProvider(model),
};

/**
 * Auto-detection priority when no provider is specified.
 *
 * 1. GEMINI_API_KEY -> Gemini SDK (default, most versatile)
 * 2. GROQ_API_KEY -> Groq (fastest inference)
 * 3. OPENROUTER_API_KEY -> OpenRouter (most models)
 * 4. `gemini` binary -> Gemini CLI (fallback, no API key needed)
 */
const AUTO_DETECT_ORDER: ProviderName[] = [
    'gemini-sdk',
    'groq',
    'openrouter',
    'gemini-cli',
];

/**
 * Get a human-readable requirement string for a provider.
 * @param name - Provider identifier
 * @returns Requirement description
 */
function getProviderRequirement(name: ProviderName): string {
    switch (name) {
        case 'gemini-cli':
            return 'Install the Gemini CLI: https://ai.google.dev/gemini-api/docs/gemini-cli';
        case 'gemini-sdk':
            return 'Set the GEMINI_API_KEY environment variable.';
        case 'groq':
            return 'Set the GROQ_API_KEY environment variable.';
        case 'openrouter':
            return 'Set the OPENROUTER_API_KEY environment variable.';
    }
}

/**
 * Create a provider instance by name, or auto-detect the best available one.
 *
 * @param name - Provider name, or undefined for auto-detection
 * @param model - Optional model override
 * @returns Configured IAIProvider instance
 * @throws Error if no provider is available or the requested one is unavailable
 *
 * @example
 * ```typescript
 * // Auto-detect best available provider
 * const provider = createProvider();
 *
 * // Explicit provider with custom model
 * const groq = createProvider('groq', 'llama-3.3-70b-versatile');
 * ```
 */
export function createProvider(name?: string, model?: string): IAIProvider {
    if (name) {
        const providerName = name as ProviderName;
        const factory = PROVIDER_MAP[providerName];
        if (!factory) {
            const available = Object.keys(PROVIDER_MAP).join(', ');
            throw new Error(
                `Unknown provider "${name}". Available providers: ${available}`,
            );
        }

        const provider = factory(model);
        if (!provider.isAvailable()) {
            throw new Error(
                `Provider "${name}" is not available. ${getProviderRequirement(providerName)}`,
            );
        }

        return provider;
    }

    for (const providerName of AUTO_DETECT_ORDER) {
        const factory = PROVIDER_MAP[providerName];
        const provider = factory(model);
        if (provider.isAvailable()) {
            return provider;
        }
    }

    throw new Error(
        `No AI provider available. Set one of these environment variables:\n` +
        `  - GEMINI_API_KEY  -> Gemini SDK (recommended)\n` +
        `  - GROQ_API_KEY    -> Groq (fastest)\n` +
        `  - OPENROUTER_API_KEY -> OpenRouter (300+ models)\n` +
        `  Or install the Gemini CLI: https://ai.google.dev/gemini-api/docs/gemini-cli`,
    );
}

/**
 * List all providers with their availability status.
 *
 * @returns Array of provider info objects
 *
 * @example
 * ```typescript
 * const providers = listProviders();
 * for (const p of providers) {
 *   console.log(`${p.name}: ${p.available ? 'ready' : 'missing'}`);
 * }
 * ```
 */
export function listProviders(): Array<{
    name: string;
    id: ProviderName;
    available: boolean;
    requirement: string;
}> {
    return (Object.keys(PROVIDER_MAP) as ProviderName[]).map((id) => {
        const provider = PROVIDER_MAP[id]();
        return {
            name: provider.name,
            id,
            available: provider.isAvailable(),
            requirement: getProviderRequirement(id),
        };
    });
}
