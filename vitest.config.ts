/**
 * Vitest configuration for gemini-commit-wizard.
 *
 * Runs tests against the TS source files directly (no bundling step).
 * Path aliases mirror the layout in src/ so tests can import cleanly.
 *
 * @module vitest-config
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['**/node_modules/**', 'dist/**'],
        testTimeout: 15000,
        hookTimeout: 15000,
    },
    resolve: {
        alias: {
            '@': new URL('./src/', import.meta.url).pathname,
        },
    },
});