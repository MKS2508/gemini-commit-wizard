#!/usr/bin/env bun

/**
 * Multi-provider AI abstraction layer for gemini-commit-wizard.
 *
 * Supports 4 providers:
 * - Gemini CLI (original, requires `gemini` binary)
 * - Gemini SDK (@google/genai, requires GEMINI_API_KEY)
 * - Groq (groq-sdk, requires GROQ_API_KEY)
 * - OpenRouter (@openrouter/sdk, requires OPENROUTER_API_KEY)
 *
 * @module providers
 */

/** Provider name union type */
export type ProviderName = 'gemini-cli' | 'gemini-sdk' | 'groq' | 'openrouter';

/**
 * Common interface all AI providers must implement.
 */
export interface IAIProvider {
  /** Human-readable provider name */
  name: string;
  /** Provider identifier */
  id: ProviderName;
  /** Model being used */
  model: string;
  /** Send a prompt and return the text response */
  generate(prompt: string): Promise<string>;
  /** Check if this provider is available (API key set, binary exists, etc.) */
  isAvailable(): boolean;
}

// ============================================================================
// GEMINI CLI PROVIDER (original - uses `gemini` binary via stdin)
// ============================================================================

/**
 * Provider that calls the Gemini CLI binary via stdin.
 * This is the original provider from gemini-commit-wizard v1.0.
 */
export class GeminiCliProvider implements IAIProvider {
  name = 'Gemini CLI';
  id: ProviderName = 'gemini-cli';
  model = 'cli-default';

  isAvailable(): boolean {
    try {
      const result = Bun.spawnSync(['which', 'gemini'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async generate(prompt: string): Promise<string> {
    const result = Bun.spawnSync(['gemini'], {
      cwd: process.cwd(),
      stdin: Buffer.from(prompt) as any,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      const error = result.stderr?.toString() || 'Gemini CLI failed';
      throw new Error(`Gemini CLI error: ${error}`);
    }

    return result.stdout?.toString() || '';
  }
}

// ============================================================================
// GEMINI SDK PROVIDER (@google/genai)
// ============================================================================

/**
 * Provider using the official Google GenAI SDK.
 * Requires GEMINI_API_KEY environment variable.
 */
export class GeminiSdkProvider implements IAIProvider {
  name = 'Gemini SDK';
  id: ProviderName = 'gemini-sdk';
  model: string;

  constructor(model?: string) {
    this.model = model || 'gemini-2.5-flash';
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

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
}

// ============================================================================
// GROQ PROVIDER (groq-sdk)
// ============================================================================

/**
 * Provider using the Groq SDK for ultra-fast inference.
 * Requires GROQ_API_KEY environment variable.
 */
export class GroqProvider implements IAIProvider {
  name = 'Groq';
  id: ProviderName = 'groq';
  model: string;

  constructor(model?: string) {
    this.model = model || 'llama-3.3-70b-versatile';
  }

  isAvailable(): boolean {
    return !!process.env.GROQ_API_KEY;
  }

  async generate(prompt: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }

    const Groq = (await import('groq-sdk')).default;
    const client = new Groq({ apiKey });

    const completion = await client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });

    return completion.choices[0]?.message?.content || '';
  }
}

// ============================================================================
// OPENROUTER PROVIDER (@openrouter/sdk)
// ============================================================================

/**
 * Provider using OpenRouter for access to 300+ models.
 * Requires OPENROUTER_API_KEY environment variable.
 */
export class OpenRouterProvider implements IAIProvider {
  name = 'OpenRouter';
  id: ProviderName = 'openrouter';
  model: string;

  constructor(model?: string) {
    this.model = model || 'anthropic/claude-sonnet-4';
  }

  isAvailable(): boolean {
    return !!process.env.OPENROUTER_API_KEY;
  }

  async generate(prompt: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is not set');
    }

    const { OpenRouter } = await import('@openrouter/sdk');
    const client = new OpenRouter({ apiKey });

    const result = await client.chat.send({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: false,
    });

    return (result as any).choices?.[0]?.message?.content || '';
  }
}

// ============================================================================
// PROVIDER FACTORY
// ============================================================================

/** All available provider constructors mapped by name */
const PROVIDER_MAP: Record<ProviderName, (model?: string) => IAIProvider> = {
  'gemini-cli': () => new GeminiCliProvider(),
  'gemini-sdk': (model) => new GeminiSdkProvider(model),
  'groq': (model) => new GroqProvider(model),
  'openrouter': (model) => new OpenRouterProvider(model),
};

/**
 * Auto-detection order when no --provider is specified.
 *
 * 1. GEMINI_API_KEY → Gemini SDK (default, most versatile)
 * 2. GROQ_API_KEY → Groq (fastest inference)
 * 3. OPENROUTER_API_KEY → OpenRouter (most models)
 * 4. `gemini` binary → Gemini CLI (fallback, no API key needed)
 */
const AUTO_DETECT_ORDER: ProviderName[] = [
  'gemini-sdk',
  'groq',
  'openrouter',
  'gemini-cli',
];

/**
 * Create a provider instance by name, or auto-detect the best available one.
 *
 * @param name - Provider name, or undefined for auto-detection
 * @param model - Optional model override for the provider
 * @returns Configured IAIProvider instance
 * @throws Error if no provider is available
 */
export function createProvider(name?: string, model?: string): IAIProvider {
  // Explicit provider requested
  if (name) {
    const providerName = name as ProviderName;
    const factory = PROVIDER_MAP[providerName];
    if (!factory) {
      const available = Object.keys(PROVIDER_MAP).join(', ');
      throw new Error(
        `Unknown provider "${name}". Available providers: ${available}`
      );
    }

    const provider = factory(model);
    if (!provider.isAvailable()) {
      throw new Error(
        `Provider "${name}" is not available. ${getProviderRequirement(providerName)}`
      );
    }

    return provider;
  }

  // Auto-detect: try each provider in order
  for (const providerName of AUTO_DETECT_ORDER) {
    const factory = PROVIDER_MAP[providerName];
    const provider = factory(model);
    if (provider.isAvailable()) {
      return provider;
    }
  }

  // Nothing available
  throw new Error(
    `No AI provider available. Set one of these environment variables:\n` +
    `  - GEMINI_API_KEY  → Gemini SDK (recommended)\n` +
    `  - GROQ_API_KEY    → Groq (fastest)\n` +
    `  - OPENROUTER_API_KEY → OpenRouter (300+ models)\n` +
    `  Or install the Gemini CLI: https://ai.google.dev/gemini-api/docs/gemini-cli`
  );
}

/**
 * Get a human-readable requirement string for a provider.
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
 * List all providers with their availability status.
 */
export function listProviders(): Array<{ name: string; id: ProviderName; available: boolean; requirement: string }> {
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
