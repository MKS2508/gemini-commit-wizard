/**
 * Gemini CLI provider — calls the `gemini` binary via stdin.
 * @module providers/gemini-cli
 */

import { tryCatchAsync, type Result, type ResultError } from '@mks2508/no-throw';
import type { IAIProvider, ProviderName } from '../types/index.js';

/**
 * Provider that pipes prompts to the local `gemini` CLI binary.
 * This is the original provider from gemini-commit-wizard v1.0.
 * No API key required — just needs the `gemini` binary in PATH.
 *
 * @example
 * ```typescript
 * const provider = new GeminiCliProvider();
 * if (provider.isAvailable()) {
 *   const result = await provider.generate(prompt);
 * }
 * ```
 */
export class GeminiCliProvider implements IAIProvider {
    /** @inheritdoc */
    name = 'Gemini CLI';
    /** @inheritdoc */
    id: ProviderName = 'gemini-cli';
    /** @inheritdoc */
    model = 'cli-default';

    /**
     * Check if the `gemini` binary is available in PATH.
     * @returns Whether the gemini CLI binary was found
     */
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

    /**
     * Generate a response by piping the prompt to the gemini CLI via stdin.
     * @param prompt - The prompt text to send
     * @returns The CLI output text
     */
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

    /**
     * Generate with Result pattern wrapping.
     * @param prompt - The prompt text to send
     * @returns Result with the generated text or a PROVIDER_ERROR
     */
    async safeGenerate(prompt: string): Promise<Result<string, ResultError<'PROVIDER_ERROR'>>> {
        return tryCatchAsync(async () => this.generate(prompt), 'PROVIDER_ERROR');
    }
}
