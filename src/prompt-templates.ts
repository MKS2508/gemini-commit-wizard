/**
 * Standardized prompt templates for AI commit analysis.
 * Ensures consistent, parseable responses across all scripts.
 * Supports dynamic project configuration.
 *
 * @module prompt-templates
 */

import type { IGeminiPromptConfig, IStandardResponseFormat } from './types/index.js';

// Re-export types for backward compatibility
export type { IGeminiPromptConfig as GeminiPromptConfig } from './types/index.js';
export type { IStandardResponseFormat as StandardResponseFormat } from './types/index.js';

/**
 * Default project config used as fallback when no config is loaded.
 * @deprecated Use loadProjectConfig() from project-config.ts instead.
 */
export const TPV_PROJECT_CONFIG = {
    name: 'Unknown Project',
    description: 'Software project',
    version: '0.0.0',
    techStack: ['TypeScript'] as const,
    targetPlatform: 'Cross-platform',
} as const;

/**
 * Generate the standard prompt prefix with dynamic project context.
 * @param ctx - Project context for the prompt
 * @returns Formatted prompt prefix string
 */
function createPromptPrefix(ctx: IGeminiPromptConfig['projectContext']): string {
    return `# Sistema de Análisis Inteligente - ${ctx.name}

Eres un asistente especializado en análisis de código y automatización para el proyecto ${ctx.name}. Tu función es proporcionar respuestas estructuradas, precisas y consistentes que puedan ser parseadas automáticamente.

## REGLAS CRÍTICAS DE FORMATO

1. **FORMATO DE RESPUESTA OBLIGATORIO**: Todas tus respuestas deben seguir exactamente el formato especificado más abajo.
2. **CONSISTENCIA**: Mantén la misma estructura sin importar la complejidad del análisis.
3. **PARSEABLE**: El formato debe ser fácil de procesar automáticamente con expresiones regulares.
4. **BLOQUES MARKDOWN**: Usa \`\`\`markdown para bloques de código cuando se especifique.
5. **SECCIONES TÉCNICAS**: Siempre incluye las secciones <technical> y <changelog> cuando sea aplicable.

## Contexto del Proyecto
**Nombre**: ${ctx.name}
**Descripción**: ${ctx.description}
**Versión Actual**: ${ctx.version}
**Stack Tecnológico**: ${ctx.techStack.join(', ')}
**Plataforma Objetivo**: ${ctx.targetPlatform}

---
`;
}

/** Standard suffix with formatting instructions */
const STANDARD_PROMPT_SUFFIX = `

---

## INSTRUCCIONES FINALES

1. **Lee cuidadosamente** toda la información proporcionada
2. **Analiza el contexto** y los datos específicos
3. **Genera una respuesta** siguiendo EXACTAMENTE el formato especificado
4. **Mantén consistencia** en la estructura y sintaxis
5. **No desvíes** del formato requerido bajo ninguna circunstancia

**IMPORTANTE**: La respuesta debe ser parseada automáticamente. Cualquier desviación del formato especificado causará errores en el sistema.`;

/**
 * Generate prompt for commit analysis.
 * @param config - Prompt configuration with project context and data
 * @returns Formatted commit analysis prompt
 */
export function createCommitPrompt(config: IGeminiPromptConfig): string {
    const { data, specificContext, projectContext, components, commitFormat } = config;
    const prefix = createPromptPrefix(projectContext);

    const componentsSection = components && components.length > 0
        ? `\n## Componentes del Proyecto (Monorepo)\n${components.map(c => `- **${c.id}** → \`${c.path}\` — ${c.name}`).join('\n')}\n\nUsa el ID del componente como "área" en el prefijo del commit (ej: \`feat(web):\`, \`fix(agent-backend):\`).\n`
        : '';

    const titleLang = commitFormat?.titleLanguage || 'english';
    const bodyLang = commitFormat?.bodyLanguage || 'spanish';
    const includeTech = commitFormat?.includeTechnical !== false;
    const includeChangelog = commitFormat?.includeChangelog !== false;

    const formatInstructions = `
## REGLAS DE IDIOMA Y FORMATO
- **Título del commit**: en **${titleLang}**
- **Descripción/body del commit**: en **${bodyLang}**
- **Sección <technical>**: ${includeTech ? 'OBLIGATORIA — incluir siempre' : 'OMITIR'}
- **Sección <changelog>**: ${includeChangelog ? 'OBLIGATORIA — incluir siempre' : 'OMITIR'}
`;

    return `${prefix}
${componentsSection}
# ANÁLISIS DE COMMITS
${formatInstructions}
## Datos del Análisis
${JSON.stringify(data, null, 2)}

## Contexto Adicional
${specificContext || 'Ninguno proporcionado'}

---

## FORMATO DE RESPUESTA REQUERIDO

Tu respuesta debe seguir EXACTAMENTE esta estructura:

### **ANÁLISIS PRINCIPAL**

[Descripción general de los cambios detectados]

---

### **Propuesta de Commit #1**

\`\`\`markdown
[prefijo](área - descripción breve en ${titleLang})

[Descripción completa en ${bodyLang} de QUÉ se logró y POR QUÉ]
${includeTech ? `
<technical>
[Detalles técnicos específicos: archivos modificados, funciones añadidas, refactorizaciones, etc.]
</technical>` : ''}
${includeChangelog ? `
<changelog>
## [Tipo] [Emoji]
[Entrada para changelog de la app, optimizada para mostrar al usuario]
</changelog>` : ''}
\`\`\`

### **Propuesta de Commit #2** (solo si es necesario)

[Repetir formato anterior]

---

**DECISIÓN**: [Explicación breve de por qué uno o múltiples commits]

${STANDARD_PROMPT_SUFFIX}`;
}

/**
 * Generate prompt for workflow assistant.
 * @param config - Prompt configuration with project context and data
 * @returns Formatted workflow prompt
 */
export function createWorkflowPrompt(config: IGeminiPromptConfig): string {
    const { data, specificContext, projectContext } = config;
    const prefix = createPromptPrefix(projectContext);

    return `${prefix}

# ASISTENTE DE WORKFLOW

## Solicitud del Usuario
"${specificContext}"

## Contexto del Proyecto Actual
${JSON.stringify(data, null, 2)}

---

## FORMATO DE RESPUESTA REQUERIDO

\`\`\`markdown
🎯 **ANÁLISIS**: [Descripción del tipo de trabajo detectado]
📊 **IMPACTO**: [Áreas afectadas y alcance del cambio]
🚀 **RECOMENDACIÓN**: [Tipo de versión y estrategia recomendada]

## 🖥️ COMANDOS PARA macOS
\`\`\`bash
# [Descripción del primer comando]
[comando exacto con parámetros]

# [Descripción del segundo comando]
[segundo comando exacto]
\`\`\`

## 🐧 COMANDOS PARA LINUX ARM (después de macOS)
\`\`\`bash
# SSH y preparación
ssh user@raspberry-pi
git pull origin master && bun install

# [Descripción del build ARM]
[comandos específicos de ARM]
\`\`\`

## ✅ VERIFICACIONES AUTOMÁTICAS
- [Lista de verificaciones que se ejecutarán]
\`\`\`

${STANDARD_PROMPT_SUFFIX}`;
}

/**
 * Generate prompt for automatic releases.
 * @param config - Prompt configuration with project context and data
 * @returns Formatted release analysis prompt
 */
export function createReleasePrompt(config: IGeminiPromptConfig): string {
    const { data, specificContext, projectContext } = config;
    const prefix = createPromptPrefix(projectContext);

    return `${prefix}

# ANÁLISIS DE RELEASE

## Información de la Release
${JSON.stringify(data, null, 2)}

## Contexto Específico
${specificContext || 'Release automática'}

---

## FORMATO DE RESPUESTA REQUERIDO

\`\`\`markdown
# 📦 ANÁLISIS DE RELEASE

## 🎯 RESUMEN
[Descripción de los cambios principales incluidos en esta release]

## 📋 CHANGELOG GENERADO

### ✨ Features
[Lista de nuevas funcionalidades]

### 🐛 Fixes
[Lista de correcciones de bugs]

### 🚀 Improvements
[Lista de mejoras]

### 🔧 Technical
[Cambios técnicos internos]

## 🏷️ INFORMACIÓN DE VERSIÓN
- **Versión**: [versión calculada]
- **Prefijo**: [alpha/beta/rc/stable]
- **Canal OTA**: [dev/beta/stable]
- **Tipo de cambio**: [major/minor/patch]

## 📝 NOTAS DE RELEASE
[Texto descriptivo para usuarios finales]
\`\`\`

${STANDARD_PROMPT_SUFFIX}`;
}

/**
 * Generic parser for Gemini AI responses.
 * Extracts structured data from formatted markdown responses.
 */
export class GeminiResponseParser {
    /**
     * Extract multiple commit proposals from standard format.
     * @param response - Raw AI response text
     * @returns Array of parsed commit proposals
     */
    static parseCommitProposals(response: string): Array<{
        title: string;
        description: string;
        technical: string;
        changelog: string;
    }> {
        const proposals: Array<{
            title: string;
            description: string;
            technical: string;
            changelog: string;
        }> = [];

        const proposalPattern = /###\s*\*\*Propuesta de Commit #\d+\*\*/g;
        const proposalMatches = Array.from(response.matchAll(proposalPattern));

        if (proposalMatches.length === 0) {
            const codeBlock = this.extractCodeBlock(response);
            if (codeBlock) {
                const parsed = this.parseCommitContent(codeBlock);
                if (parsed) proposals.push(parsed);
            }
        } else {
            for (let i = 0; i < proposalMatches.length; i++) {
                const startIndex = proposalMatches[i].index!;
                const endIndex = proposalMatches[i + 1]?.index || response.length;
                const proposalSection = response.substring(startIndex, endIndex);

                const codeBlock = this.extractCodeBlock(proposalSection);
                if (codeBlock) {
                    const parsed = this.parseCommitContent(codeBlock);
                    if (parsed) proposals.push(parsed);
                }
            }
        }

        return proposals;
    }

    /**
     * Extract a markdown code block from text.
     * @param text - Text containing a code block
     * @returns Extracted code block content, or null
     */
    private static extractCodeBlock(text: string): string | null {
        const patterns = [
            /```markdown\s*\n([\s\S]*?)\n```/,
            /```\s*\n([\s\S]*?)\n```/,
            /```([\s\S]*?)```/,
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1].trim();
        }

        return null;
    }

    /**
     * Parse the content of an individual commit proposal.
     * @param content - Raw commit content string
     * @returns Parsed commit object, or null if unparseable
     */
    private static parseCommitContent(content: string): {
        title: string;
        description: string;
        technical: string;
        changelog: string;
    } | null {
        const lines = content.split('\n');

        let title = '';
        let titleIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim()) {
                title = lines[i].trim();
                titleIndex = i;
                break;
            }
        }

        if (!title) return null;

        let description = '';
        let technical = '';
        let changelog = '';
        let currentSection = 'description';

        for (let i = titleIndex + 1; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes('<technical>')) {
                currentSection = 'technical';
                continue;
            } else if (line.includes('</technical>')) {
                currentSection = 'none';
                continue;
            } else if (line.includes('<changelog>')) {
                currentSection = 'changelog';
                continue;
            } else if (line.includes('</changelog>')) {
                currentSection = 'none';
                continue;
            }

            if (currentSection === 'description' && line.trim()) {
                description += line + '\n';
            } else if (currentSection === 'technical') {
                technical += line + '\n';
            } else if (currentSection === 'changelog') {
                changelog += line + '\n';
            }
        }

        return {
            title,
            description: description.trim(),
            technical: technical.trim(),
            changelog: changelog.trim(),
        };
    }

    /**
     * Parse workflow response into standard format.
     * @param response - Raw AI workflow response
     * @returns Parsed workflow data
     */
    static parseWorkflowResponse(response: string): {
        analysis: string;
        impact: string;
        recommendation: string;
        macosCommands: string[];
        linuxCommands: string[];
        verifications: string[];
    } {
        const analysisMatch = response.match(/🎯\s*\*\*ANÁLISIS\*\*:\s*(.+)/);
        const impactMatch = response.match(/📊\s*\*\*IMPACTO\*\*:\s*(.+)/);
        const recommendationMatch = response.match(/🚀\s*\*\*RECOMENDACIÓN\*\*:\s*(.+)/);

        const macosSection = response.match(/##\s*🖥️\s*COMANDOS PARA macOS\s*```bash\s*([\s\S]*?)\s*```/);
        const macosCommands = macosSection ? macosSection[1].split('\n').filter(line =>
            line.trim() && !line.startsWith('#'),
        ) : [];

        const linuxSection = response.match(/##\s*🐧\s*COMANDOS PARA LINUX ARM[\s\S]*?```bash\s*([\s\S]*?)\s*```/);
        const linuxCommands = linuxSection ? linuxSection[1].split('\n').filter(line =>
            line.trim() && !line.startsWith('#'),
        ) : [];

        const verificationsSection = response.match(/##\s*✅\s*VERIFICACIONES AUTOMÁTICAS\s*([\s\S]*?)```/);
        const verifications = verificationsSection ? verificationsSection[1].split('\n').filter(line =>
            line.trim().startsWith('-'),
        ).map(line => line.replace(/^-\s*/, '')) : [];

        return {
            analysis: analysisMatch?.[1] || 'No disponible',
            impact: impactMatch?.[1] || 'No disponible',
            recommendation: recommendationMatch?.[1] || 'No disponible',
            macosCommands,
            linuxCommands,
            verifications,
        };
    }
}
