#!/usr/bin/env bun

/**
 * Interactive commit UI.
 * Uses native macOS dialogs (osascript), Linux zenity, or @inquirer/prompts as fallback.
 * Now imports CommitGenerator directly instead of shelling out.
 *
 * @module commit-ui
 */

import { execSync } from 'child_process';
import { platform } from 'os';
import { Logger } from '@mks2508/better-logger';
import { isErr } from '@mks2508/no-throw';
import { CommitGenerator } from './commit-generator';
import { loadProjectConfig } from './project-config';
import { detectTerminalCapabilities, shouldUseFancyOutput } from './utils/index.js';
import type { ICommitOptions, ICommitGeneratorOptions } from './types/index.js';

const log = new Logger();

/**
 * Interactive commit UI that collects user input via native dialogs
 * or terminal prompts, then delegates to CommitGenerator.
 *
 * @example
 * ```typescript
 * const ui = new CommitUI({ noPush: true });
 * await ui.run();
 * ```
 */
class CommitUI {
    private currentPlatform = platform();
    private baseOptions: Partial<ICommitGeneratorOptions>;

    /**
     * @param baseOptions - Base options passed through to CommitGenerator
     */
    constructor(baseOptions: Partial<ICommitGeneratorOptions> = {}) {
        this.baseOptions = baseOptions;
    }

    /**
     * Collect commit info from the user via platform-appropriate UI.
     * @returns User-provided commit options
     */
    async collectCommitInfo(): Promise<ICommitOptions> {
        const caps = detectTerminalCapabilities();
        const useFancy = shouldUseFancyOutput(caps);

        if (useFancy) {
            log.header('Commit Wizard', 'Interactive Mode');
            log.divider();
        }

        try {
            if (this.currentPlatform === 'darwin') {
                return await this.macOSDialog();
            } else if (this.currentPlatform === 'linux') {
                return await this.linuxDialog();
            } else {
                return await this.fallbackDialog();
            }
        } catch (error) {
            log.warn('GUI not available, falling back to terminal prompts');
            return await this.fallbackDialog();
        }
    }

    /**
     * macOS native dialog flow using osascript JXA.
     * @returns Commit options collected from AppleScript dialogs
     */
    private async macOSDialog(): Promise<ICommitOptions> {
        const formScript = `
      const app = Application.currentApplication()
      app.includeStandardAdditions = true

      const contextResult = app.displayDialog("Commit Generator\\n\\nDescribe what you implemented/fixed:", {
        defaultAnswer: "",
        withTitle: "Interactive Commit",
        buttons: ["Cancel", "Next"],
        defaultButton: "Next"
      })

      const context = contextResult.textReturned

      const workTypes = ["feature", "fix", "refactor", "docs", "test"]
      const workTypeResult = app.chooseFromList(workTypes, {
        withTitle: "Interactive Commit - Work Type",
        withPrompt: "Context: " + context + "\\n\\nSelect work type:",
        defaultItems: ["feature"]
      })

      if (workTypeResult === false) {
        throw new Error("Cancelled")
      }

      const workType = workTypeResult[0]

      const components = ${JSON.stringify(this.getComponentChoices())}
      const componentsResult = app.chooseFromList(components, {
        withTitle: "Interactive Commit - Components",
        withPrompt: "Context: " + context + "\\nType: " + workType + "\\n\\nSelect affected components:",
        multipleSelectionsAllowed: true,
        defaultItems: ["core"]
      })

      if (componentsResult === false) {
        throw new Error("Cancelled")
      }

      const affectedComponents = componentsResult.join(",")

      const impacts = ["none", "minor", "major"]
      const performanceResult = app.chooseFromList(impacts, {
        withTitle: "Interactive Commit - Performance",
        withPrompt: "Context: " + context + "\\nType: " + workType + "\\nComponents: " + affectedComponents + "\\n\\nPerformance impact:",
        defaultItems: ["none"]
      })

      const performanceImpact = performanceResult === false ? "none" : performanceResult[0]

      JSON.stringify({
        context: context,
        workType: workType,
        affectedComponents: affectedComponents,
        performanceImpact: performanceImpact
      })
    `;

        const result = execSync(`osascript -l JavaScript -e '${formScript}'`, { encoding: 'utf-8' }).trim();
        const parsed = JSON.parse(result);

        return {
            context: parsed.context,
            workType: parsed.workType,
            affectedComponents: parsed.affectedComponents.split(','),
            performanceImpact: parsed.performanceImpact,
        };
    }

    /**
     * Linux dialog flow using zenity.
     * @returns Commit options collected from zenity dialogs
     */
    private async linuxDialog(): Promise<ICommitOptions> {
        try {
            execSync('which zenity', { stdio: 'ignore' });
        } catch {
            throw new Error('zenity not available');
        }

        const context = execSync(
            `zenity --entry --title="Interactive Commit" --text="Describe what you implemented/fixed:" --width=400`,
            { encoding: 'utf-8' },
        ).trim();

        const workType = execSync(
            `zenity --list --title="Interactive Commit - Work Type" --text="Context: ${context}\\n\\nSelect work type:" --radiolist --column="Select" --column="Type" --column="Description" --width=450 --height=300 \\
      TRUE "feature" "New functionality" \\
      FALSE "fix" "Bug fixes" \\
      FALSE "refactor" "Code refactoring" \\
      FALSE "docs" "Documentation" \\
      FALSE "test" "Tests"`,
            { encoding: 'utf-8' },
        ).trim();

        const componentsResult = execSync(
            `zenity --list --title="Interactive Commit - Components" --text="Context: ${context}\\nType: ${workType}\\n\\nSelect affected components:" --checklist --column="Select" --column="Component" --width=450 --height=300 \\
      TRUE "core" \\
      FALSE "ui" \\
      FALSE "api" \\
      FALSE "docs" \\
      FALSE "tests"`,
            { encoding: 'utf-8' },
        ).trim();

        const affectedComponents = componentsResult.split('|').filter(Boolean);

        const performanceImpact = execSync(
            `zenity --list --title="Interactive Commit - Performance" --text="Context: ${context}\\nType: ${workType}\\nComponents: ${affectedComponents.join(', ')}\\n\\nSelect performance impact:" --radiolist --column="Select" --column="Impact" --width=450 --height=250 \\
      TRUE "none" \\
      FALSE "minor" \\
      FALSE "major"`,
            { encoding: 'utf-8' },
        ).trim();

        return {
            context,
            workType,
            affectedComponents,
            performanceImpact,
        };
    }

    /**
     * Terminal fallback using @inquirer/prompts for a rich CLI experience.
     * @returns Commit options collected from terminal prompts
     */
    private async fallbackDialog(): Promise<ICommitOptions> {
        const { input, select, checkbox } = await import('@inquirer/prompts');

        const context = await input({
            message: 'What did you implement/fix?',
            validate: (v: string) => v.length > 0 || 'Description is required',
        });

        const workType = await select({
            message: 'Work type:',
            choices: [
                { value: 'feature', name: 'Feature - New functionality' },
                { value: 'fix', name: 'Fix - Bug correction' },
                { value: 'refactor', name: 'Refactor - Code improvement' },
                { value: 'docs', name: 'Docs - Documentation update' },
                { value: 'test', name: 'Test - Tests' },
            ],
        });

        const choices = this.getComponentChoices().map(c => ({ value: c, name: c }));
        const affectedComponents = await checkbox({
            message: 'Components changed:',
            choices,
        });

        return {
            context,
            workType,
            affectedComponents: affectedComponents.length > 0 ? affectedComponents : ['core'],
        };
    }

    /**
     * Get component choices from project config or defaults.
     * @returns Array of component names
     */
    private getComponentChoices(): string[] {
        try {
            const config = loadProjectConfig(process.cwd());
            if (config.components && config.components.length > 0) {
                return config.components.map(c => c.id);
            }
        } catch {
            // ignore
        }
        return ['ui', 'api', 'core', 'docs', 'tests'];
    }

    /**
     * Run the full interactive commit flow.
     * Collects info, shows summary, then delegates to CommitGenerator.
     */
    async run(): Promise<void> {
        const options = await this.collectCommitInfo();

        // Show summary before generation - adaptive format
        const caps = detectTerminalCapabilities();
        const useFancy = shouldUseFancyOutput(caps);

        if (useFancy) {
            log.blank();
            log.box(
                [
                    `Context:    ${options.context}`,
                    `Type:       ${options.workType}`,
                    `Components: ${options.affectedComponents.join(', ')}`,
                    options.performanceImpact ? `Performance: ${options.performanceImpact}` : '',
                ].filter(Boolean).join('\n'),
                { title: 'Commit Info', borderStyle: 'single', padding: 1 },
            );
        } else {
            log.info(`Commit: ${options.workType}(${options.affectedComponents.join(',')})`);
            log.info(`  ${options.context}`);
        }

        // Pass through CLI args for provider/model
        const cliArgs = process.argv.slice(2);
        const getArg = (flag: string): string | undefined => {
            const idx = cliArgs.indexOf(flag);
            return idx > -1 && cliArgs[idx + 1] ? cliArgs[idx + 1] : undefined;
        };

        const generator = new CommitGenerator({
            ...this.baseOptions,
            provider: getArg('--provider') as any,
            model: getArg('--model'),
            context: options.context,
            workType: options.workType,
            affectedComponents: options.affectedComponents.join(','),
            autoApprove: true,
        });

        const result = await generator.generate();
        if (isErr(result)) {
            log.error(`Commit generation failed: ${result.error.message}`);
            process.exit(1);
        }

        log.success('Done');
    }
}

// ─── CLI Entry Point ─────────────────────────────────────────
async function main() {
    const ui = new CommitUI();

    if (process.argv.includes('--quick')) {
        const generator = new CommitGenerator({
            context: 'Quick commit via UI',
            workType: 'feature',
            affectedComponents: 'core',
            autoApprove: true,
        });
        const result = await generator.generate();
        if (isErr(result)) {
            log.error(result.error.message);
            process.exit(1);
        }
        return;
    }

    try {
        await ui.run();
    } catch (error) {
        if (error instanceof Error && error.message === 'Cancelled') {
            log.info('Commit cancelled by user');
            process.exit(0);
        }
        log.error(`Error: ${error}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    main();
}

export { CommitUI };
