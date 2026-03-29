/**
 * Smart output formatting based on terminal capabilities.
 * Provides subtle, professional CLI output that adapts to environment.
 * @module utils/output-formatter
 */

import { Logger, stylePresets } from '@mks2508/better-logger';
import type { ITerminalCapabilities } from './environment.js';

const log = new Logger();

/**
 * Badge type for semantic styling.
 */
export type BadgeType = 'success' | 'warn' | 'info' | 'error' | 'dim';

/**
 * ANSI color codes for subtle badge styling.
 */
const ANSI_COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    gray: '\x1b[90m',
};

/**
 * Format a badge - subtle in CI, styled in TTY.
 *
 * @param text - Badge text content
 * @param type - Semantic badge type
 * @param caps - Terminal capabilities
 * @returns Formatted badge string
 *
 * @example
 * ```typescript
 * const caps = detectTerminalCapabilities();
 * const badge = formatBadge('GEMINI', 'info', caps);
 * log.info(`${badge} Generating commit message...`);
 * ```
 */
export function formatBadge(text: string, type: BadgeType, caps: ITerminalCapabilities): string {
    // CI/plain mode: simple bracket format
    if (!caps.supportsColor || caps.environment === 'ci') {
        return `[${text}]`;
    }

    // TTY with color: subtle badges with dim colors
    const colorMap: Record<BadgeType, string> = {
        success: ANSI_COLORS.green,
        warn: ANSI_COLORS.yellow,
        info: ANSI_COLORS.blue,
        error: ANSI_COLORS.red,
        dim: ANSI_COLORS.gray,
    };

    const color = colorMap[type] || ANSI_COLORS.blue;
    return `${ANSI_COLORS.dim}${color}[${text}]${ANSI_COLORS.reset}`;
}

/**
 * Format a compact box - respects terminal width and environment.
 *
 * @param content - Box content text
 * @param title - Optional box title
 * @param caps - Terminal capabilities
 * @returns Formatted box string
 *
 * @example
 * ```typescript
 * const caps = detectTerminalCapabilities();
 * const output = formatCompactBox('Changes staged', 'Status');
 * log.info(output);
 * ```
 */
export function formatCompactBox(content: string, title?: string, caps?: ITerminalCapabilities): string {
    const detectedCaps = caps || detectTerminalCapabilities();

    // Non-TTY or CI: simple separator
    if (!detectedCaps.isTTY || detectedCaps.environment === 'ci') {
        const separator = title ? `--- ${title} ---` : '---';
        return `${separator}\n${content}`;
    }

    // TTY: use subtle box with single border
    return log.box(content, {
        title,
        borderStyle: 'single',
        padding: 1,
    });
}

/**
 * Format a section header - subtle in non-TTY.
 *
 * @param title - Header text
 * @param caps - Terminal capabilities
 * @returns Formatted header string
 */
export function formatHeader(title: string, caps?: ITerminalCapabilities): string {
    const detectedCaps = caps || detectTerminalCapabilities();

    if (!detectedCaps.isTTY || detectedCaps.environment === 'ci') {
        return `::: ${title} :::`;
    }

    return title;
}

/**
 * Format a provider badge with appropriate styling.
 *
 * @param providerName - AI provider name
 * @param caps - Terminal capabilities
 * @returns Formatted provider badge
 */
export function formatProviderBadge(providerName: string, caps: ITerminalCapabilities): string {
    const providerUpper = providerName.toUpperCase().replace(/[^A-Z]/g, '');
    return formatBadge(providerUpper, 'info', caps);
}

/**
 * Determine if we should show fancy output based on capabilities.
 *
 * @param caps - Terminal capabilities
 * @returns True if fancy output is appropriate
 */
export function shouldUseFancyOutput(caps: ITerminalCapabilities): boolean {
    return caps.isTTY && caps.supportsColor && caps.environment !== 'ci';
}

/**
 * Get appropriate spinner style for environment.
 *
 * @param caps - Terminal capabilities
 * @returns Ora-style spinner frame name
 */
export function getSpinnerStyle(caps: ITerminalCapabilities): 'dots' | 'line' | 'simple' {
    if (!caps.isTTY || caps.environment === 'ci') {
        return 'simple';
    }
    return 'dots'; // Ora-style dots for professional feel
}

/**
 * Truncate text to fit terminal width.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (defaults to terminal width - padding)
 * @param caps - Terminal capabilities
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(text: string, maxLength?: number, caps?: ITerminalCapabilities): string {
    const detectedCaps = caps || detectTerminalCapabilities();
    const maxLen = maxLength || detectedCaps.width - 10;

    if (text.length <= maxLen) {
        return text;
    }

    return text.substring(0, maxLen - 3) + '...';
}

/**
 * Import environment detection at the top level for convenience.
 */
export { detectTerminalCapabilities } from './environment.js';
export type { ITerminalCapabilities } from './environment.js';
