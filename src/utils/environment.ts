/**
 * Environment and terminal capability detection utilities.
 * Uses @mks2508/better-logger v5 detection capabilities.
 * @module utils/environment
 */

import { getEnvironment, supportsANSI, getColorCapability, isRunningInTerminal } from '@mks2508/better-logger';

/**
 * Terminal capabilities for adaptive UI rendering.
 */
export interface ITerminalCapabilities {
    /** Whether running in a TTY (interactive terminal) */
    isTTY: boolean;
    /** Whether ANSI escape codes are supported */
    supportsColor: boolean;
    /** Color support level */
    colorLevel: 'full' | 'basic' | 'none';
    /** Detected environment type */
    environment: 'terminal' | 'ci' | 'browser' | 'unknown';
    /** Terminal width in columns */
    width: number;
}

/**
 * Color levels from better-logger mapped to our types.
 */
const LEVEL_MAP: Record<string, ITerminalCapabilities['colorLevel']> = {
    full: 'full',
    basic: 'basic',
    none: 'none',
};

/**
 * Detect terminal capabilities for adaptive UI.
 * Uses better-logger's built-in detection utilities.
 *
 * @returns Terminal capability information
 *
 * @example
 * ```typescript
 * const caps = detectTerminalCapabilities();
 * if (caps.environment === 'ci') {
 *   // Use plain text output
 * }
 * ```
 */
export function detectTerminalCapabilities(): ITerminalCapabilities {
    return {
        isTTY: isRunningInTerminal(),
        supportsColor: supportsANSI(),
        colorLevel: LEVEL_MAP[getColorCapability()] || 'basic',
        environment: normalizeEnvironment(getEnvironment()),
        width: process.stdout.columns || 80,
    };
}

/**
 * Normalize environment string to our known types.
 */
function normalizeEnvironment(env: string): ITerminalCapabilities['environment'] {
    switch (env) {
        case 'terminal':
            return 'terminal';
        case 'ci':
            return 'ci';
        case 'browser':
            return 'browser';
        default:
            return 'unknown';
    }
}

/**
 * Check if running in CI environment.
 */
export function isCI(): boolean {
    return detectTerminalCapabilities().environment === 'ci';
}

/**
 * Check if running in interactive terminal.
 */
export function isInteractive(): boolean {
    const caps = detectTerminalCapabilities();
    return caps.isTTY && caps.environment !== 'ci';
}

/**
 * Check if full color support is available.
 */
export function hasFullColor(): boolean {
    const caps = detectTerminalCapabilities();
    return caps.supportsColor && caps.colorLevel === 'full';
}
