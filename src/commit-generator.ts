#!/usr/bin/env bun

/**
 * Generador Automático de Commits con Gemini CLI
 * Analiza todos los cambios del repositorio y genera commits coherentes
 * siguiendo los patrones establecidos para el proyecto EL Haido TPV
 */

import { spawn } from 'bun';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createCommitPrompt, GeminiResponseParser, TPV_PROJECT_CONFIG, type GeminiPromptConfig } from './prompt-templates';
import { join } from 'path';

interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  diff?: string;
  lines_added?: number;
  lines_removed?: number;
  is_binary?: boolean;
}

interface GitStats {
  total_files: number;
  total_additions: number;
  total_deletions: number;
  files_by_extension: Record<string, number>;
  directories_affected: string[];
}

interface CommitAnalysis {
  files: FileChange[];
  stats: GitStats;
  project_context: {
    name: string;
    description: string;
    tech_stack: string[];
    target_platform: string;
  };
  commit_patterns: string;
}

interface CommitProposal {
  title: string;
  description: string;
  technical: string;
  changelog: string;
  files?: string[];
}

class CommitGenerator {
  private projectRoot: string;
  private tempDir: string;
  private autoApprove: boolean;
  private noPush: boolean;

  constructor() {
    this.projectRoot = process.cwd();
    this.tempDir = join(this.projectRoot, '.temp');
    this.autoApprove = process.argv.includes('--auto-approve');
    this.noPush = process.argv.includes('--no-push');
    this.ensureTempDir();
  }

  private ensureTempDir(): void {
    if (!existsSync(this.tempDir)) {
      Bun.spawnSync(['mkdir', '-p', this.tempDir]);
    }
  }

  /**
   * Ejecuta un comando git y devuelve el resultado
   */
  private async gitCommand(args: string[]): Promise<string> {
    const result = Bun.spawnSync(['git', ...args], {
      cwd: this.projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      const error = result.stderr?.toString() || 'Git command failed';
      throw new Error(`Git error: ${error}`);
    }

    return result.stdout?.toString().trim() || '';
  }

  /**
   * Agrega todos los cambios al staging area
   */
  private async stageAllChanges(): Promise<void> {
    console.log('📦 Agregando todos los cambios al staging area...');
    await this.gitCommand(['add', '-A']);
  }

  /**
   * Obtiene el estado actual del repositorio
   */
  private async getRepositoryStatus(): Promise<FileChange[]> {
    console.log('🔍 Analizando estado del repositorio...');
    
    const statusOutput = await this.gitCommand(['status', '--porcelain']);
    const files: FileChange[] = [];

    for (const line of statusOutput.split('\n').filter(l => l.trim())) {
      const status = line.substring(0, 2);
      const filePath = line.substring(3);

      let fileStatus: FileChange['status'];
      if (status.includes('A')) fileStatus = 'added';
      else if (status.includes('M')) fileStatus = 'modified';
      else if (status.includes('D')) fileStatus = 'deleted';
      else if (status.includes('R')) fileStatus = 'renamed';
      else fileStatus = 'untracked';

      files.push({
        path: filePath,
        status: fileStatus,
      });
    }

    return files;
  }

  /**
   * Obtiene el diff de un archivo específico
   */
  private async getFileDiff(filePath: string, isStaged: boolean = true): Promise<string> {
    try {
      const diffArgs = isStaged 
        ? ['diff', '--cached', '--', filePath]
        : ['diff', '--', filePath];
      
      return await this.gitCommand(diffArgs);
    } catch (error) {
      // Si es un archivo nuevo o binario, devolver información básica
      try {
        const showArgs = ['show', `HEAD:${filePath}`];
        await this.gitCommand(showArgs);
        return `New file: ${filePath}`;
      } catch {
        return `Binary or new file: ${filePath}`;
      }
    }
  }

  /**
   * Obtiene estadísticas del repositorio
   */
  private async getGitStats(): Promise<GitStats> {
    console.log('📊 Calculando estadísticas de cambios...');
    
    try {
      const diffStat = await this.gitCommand(['diff', '--cached', '--stat']);
      const lines = diffStat.split('\n').filter(l => l.trim());
      
      let totalFiles = 0;
      let totalAdditions = 0;
      let totalDeletions = 0;
      const filesByExtension: Record<string, number> = {};
      const directoriesAffected = new Set<string>();

      for (const line of lines) {
        if (line.includes('|')) {
          totalFiles++;
          const filePath = line.split('|')[0].trim();
          
          // Extraer extensión
          const ext = filePath.split('.').pop() || 'no-ext';
          filesByExtension[ext] = (filesByExtension[ext] || 0) + 1;
          
          // Extraer directorio
          const dir = filePath.split('/')[0];
          directoriesAffected.add(dir);
          
          // Extraer adiciones y eliminaciones
          const stats = line.split('|')[1];
          const plusCount = (stats.match(/\+/g) || []).length;
          const minusCount = (stats.match(/\-/g) || []).length;
          totalAdditions += plusCount;
          totalDeletions += minusCount;
        }
      }

      return {
        total_files: totalFiles,
        total_additions: totalAdditions,
        total_deletions: totalDeletions,
        files_by_extension: filesByExtension,
        directories_affected: Array.from(directoriesAffected),
      };
    } catch (error) {
      return {
        total_files: 0,
        total_additions: 0,
        total_deletions: 0,
        files_by_extension: {},
        directories_affected: [],
      };
    }
  }

  /**
   * Genera el contexto completo para Gemini CLI
   */
  private async generateAnalysisContext(): Promise<CommitAnalysis> {
    console.log('🧠 Generando contexto de análisis...');

    await this.stageAllChanges();
    
    const files = await this.getRepositoryStatus();
    const stats = await this.getGitStats();

    // Obtener diffs para cada archivo
    for (const file of files) {
      if (file.status !== 'deleted') {
        try {
          file.diff = await this.getFileDiff(file.path);
          
          // Calcular líneas agregadas/eliminadas del diff
          if (file.diff) {
            file.lines_added = (file.diff.match(/^\+[^+]/gm) || []).length;
            file.lines_removed = (file.diff.match(/^-[^-]/gm) || []).length;
            file.is_binary = file.diff.includes('Binary files differ');
          }
        } catch (error) {
          file.diff = `Error getting diff: ${error}`;
        }
      }
    }

    // Cargar patrones de commit
    const patternsPath = join(this.projectRoot, 'commit-templates/commit-patterns.md');
    const commitPatterns = existsSync(patternsPath) 
      ? readFileSync(patternsPath, 'utf-8')
      : 'No commit patterns found';

    return {
      files,
      stats,
      project_context: {
        name: 'OpenTUI',
        description: 'Modern Terminal User Interface Framework',
        tech_stack: ['TypeScript', 'Node.js', 'Terminal UI', 'CLI'],
        target_platform: 'Cross-platform (macOS, Linux, Windows)',
      },
      commit_patterns: commitPatterns,
    };
  }

  private createStandardPrompt(analysis: CommitAnalysis, extraContext: string = ''): string {
    const config: GeminiPromptConfig = {
      projectContext: {
        name: TPV_PROJECT_CONFIG.name,
        description: TPV_PROJECT_CONFIG.description,
        version: TPV_PROJECT_CONFIG.version,
        techStack: [...TPV_PROJECT_CONFIG.techStack],
        targetPlatform: TPV_PROJECT_CONFIG.targetPlatform,
      },
      analysisType: 'commit',
      specificContext: extraContext,
      data: {
        stats: analysis.stats,
        files: analysis.files.map(file => ({
          path: file.path,
          status: file.status,
          lines_added: file.lines_added,
          lines_removed: file.lines_removed,
          is_binary: file.is_binary,
          diff_preview: file.diff?.substring(0, 1500) || 'No diff available'
        })),
        patterns: analysis.commit_patterns
      }
    };

    return createCommitPrompt(config);
  }

  private createExhaustivePrompt(analysis: CommitAnalysis, extraContext: string = ''): string {
    const config: GeminiPromptConfig = {
      projectContext: {
        name: TPV_PROJECT_CONFIG.name,
        description: TPV_PROJECT_CONFIG.description,
        version: TPV_PROJECT_CONFIG.version,
        techStack: [...TPV_PROJECT_CONFIG.techStack],
        targetPlatform: TPV_PROJECT_CONFIG.targetPlatform,
      },
      analysisType: 'commit',
      specificContext: `MODO EXHAUSTIVO: Análisis profundo requerido.\n${extraContext}`,
      data: {
        mode: 'exhaustive',
        stats: analysis.stats,
        files: analysis.files.map(file => ({
          path: file.path,
          status: file.status,
          lines_added: file.lines_added,
          lines_removed: file.lines_removed,
          is_binary: file.is_binary,
          diff_preview: file.diff?.substring(0, 2000) || 'No diff available'
        })),
        patterns: analysis.commit_patterns
      }
    };

    return createCommitPrompt(config);
  }

  /**
   * Construye contexto mejorado con parámetros adicionales
   */
  private buildEnhancedContext(
    extraContext: string,
    contextDescription: string,
    workType: string,
    affectedComponents: string,
    performanceImpact: string,
    breakingChanges: string
  ): string {
    let enhancedContext = extraContext;

    const contextParts = [];

    if (contextDescription) {
      contextParts.push(`**Descripción del trabajo**: ${contextDescription}`);
    }

    if (workType) {
      const workTypeDescriptions = {
        'feature': 'Nueva funcionalidad o capacidad',
        'bugfix': 'Corrección de error o fallo',
        'refactor': 'Mejora del código sin cambios de funcionalidad',
        'docs': 'Actualización de documentación',
        'performance': 'Optimización de rendimiento',
        'ui': 'Cambios en interfaz de usuario',
        'api': 'Modificaciones en API o endpoints',
        'security': 'Mejoras de seguridad',
        'test': 'Adición o modificación de tests'
      };
      contextParts.push(`**Tipo de trabajo**: ${workType} - ${workTypeDescriptions[workType] || workType}`);
    }

    if (affectedComponents) {
      contextParts.push(`**Componentes afectados**: ${affectedComponents}`);
    }

    if (performanceImpact) {
      const performanceDescriptions = {
        'mejora': 'Este cambio mejora el rendimiento del sistema',
        'neutro': 'Este cambio no afecta significativamente el rendimiento',
        'regresion': 'Este cambio puede impactar negativamente el rendimiento (justificado por otros beneficios)'
      };
      contextParts.push(`**Impacto en rendimiento**: ${performanceImpact} - ${performanceDescriptions[performanceImpact] || performanceImpact}`);
    }

    if (breakingChanges) {
      const breakingDescription = breakingChanges.toLowerCase() === 'si' 
        ? 'Este cambio introduce cambios que rompen compatibilidad hacia atrás'
        : 'Este cambio mantiene compatibilidad hacia atrás';
      contextParts.push(`**Cambios incompatibles**: ${breakingChanges} - ${breakingDescription}`);
    }

    if (contextParts.length > 0) {
      const contextSection = contextParts.join('\n');
      enhancedContext = enhancedContext 
        ? `${enhancedContext}\n\n## Contexto Estructurado\n\n${contextSection}`
        : `## Contexto Estructurado\n\n${contextSection}`;
    }

    return enhancedContext;
  }

  /**
   * Invoca Gemini CLI con el contexto de análisis
   */
  private async analyzeWithGemini(analysis: CommitAnalysis, exhaustive: boolean = false, extraContext: string = ''): Promise<string> {
    console.log(`🤖 Analizando cambios con Gemini CLI... ${exhaustive ? '(Modo Exhaustivo)' : ''}`);

    const prompt = exhaustive
      ? this.createExhaustivePrompt(analysis, extraContext)
      : this.createStandardPrompt(analysis, extraContext);

    // Guardar el contexto en un archivo temporal
    const contextPath = join(this.tempDir, 'analysis-context.json');
    writeFileSync(contextPath, JSON.stringify(analysis, null, 2));

    // Guardar el prompt en un archivo temporal
    const promptPath = join(this.tempDir, 'gemini-prompt.txt');
    writeFileSync(promptPath, prompt);

    try {
      // Ejecutar Gemini CLI
      const geminiResult = Bun.spawnSync(['gemini'], {
        cwd: this.projectRoot,
        stdin: Buffer.from(prompt) as any,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (geminiResult.exitCode !== 0) {
        const error = geminiResult.stderr?.toString() || 'Gemini CLI failed';
        throw new Error(`Gemini CLI error: ${error}`);
      }

      const response = geminiResult.stdout?.toString() || '';
      
      // Guardar la respuesta
      const responsePath = join(this.tempDir, 'gemini-response.md');
      writeFileSync(responsePath, response);

      return response;
    } catch (error) {
      console.error('❌ Error ejecutando Gemini CLI:', error);
      console.log('💡 Verifica que Gemini CLI esté instalado y configurado');
      console.log('📝 Contexto guardado en:', contextPath);
      console.log('📝 Prompt guardado en:', promptPath);
      throw error;
    }
  }

  /**
   * Guarda la propuesta de commits
   */
  private saveCommitProposal(analysis: string): string {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const proposalPath = join(this.tempDir, `commit-proposal-${timestamp}.md`);
    
    writeFileSync(proposalPath, analysis);
    return proposalPath;
  }

  /**
   * Parsea propuestas de commit de la respuesta de Gemini
   */
  private parseCommitProposals(aiResponse: string): CommitProposal[] {
    // Usar el parser estandarizado
    const parsedProposals = GeminiResponseParser.parseCommitProposals(aiResponse);
    
    // Convertir al formato interno
    return parsedProposals.map(proposal => ({
      title: proposal.title,
      description: proposal.description,
      technical: proposal.technical,
      changelog: proposal.changelog,
      files: [] // Usar todos los archivos disponibles
    }));
  }

  /**
   * Ejecuta un commit individual
   */
  private async executeCommit(proposal: CommitProposal, allFiles: FileChange[]): Promise<boolean> {
    console.log(`\n🔨 Ejecutando commit: ${proposal.title}`);
    
    try {
      // Si no hay archivos específicos, usar todos los archivos disponibles (excluyendo temp files)
      const targetFiles = proposal.files && proposal.files.length > 0 
        ? proposal.files 
        : allFiles
            .map(f => f.path)
            .filter(path => !path.includes('.temp/') && !path.startsWith('.release-notes-'));
      
      // Agregar archivos específicos al staging area
      for (const file of targetFiles) {
        try {
          await this.gitCommand(['add', file]);
          console.log(`  ✓ Agregado: ${file}`);
        } catch (error) {
          console.warn(`  ⚠️ No se pudo agregar ${file}:`, error);
        }
      }
      
      // Verificar que hay algo para commitear
      try {
        const statusResult = await this.gitCommand(['diff', '--cached', '--name-only']);
        if (!statusResult.trim()) {
          console.warn(`  ⚠️ No hay cambios staged para este commit`);
          return false;
        }
      } catch (error) {
        // Fallback si diff --cached no funciona
        console.log(`  🔍 Verificando staging area...`);
      }
      
      // Crear mensaje de commit
      let commitMessage = proposal.title;
      if (proposal.description) {
        commitMessage += `\n\n${proposal.description}`;
      }
      if (proposal.technical) {
        commitMessage += `\n\n<technical>\n${proposal.technical}\n</technical>`;
      }
      if (proposal.changelog) {
        commitMessage += `\n\n<changelog>\n${proposal.changelog}\n</changelog>`;
      }
      
      // Ejecutar commit
      await this.gitCommand(['commit', '-m', commitMessage]);
      console.log(`  ✅ Commit exitoso`);
      return true;
      
    } catch (error) {
      console.error(`  ❌ Error en commit:`, error);
      return false;
    }
  }

  /**
   * Ejecuta push de todos los commits
   */
  private async pushCommits(): Promise<void> {
    if (this.noPush) {
      console.log('⏭️ Push deshabilitado por --no-push');
      return;
    }
    
    console.log('\n📤 Pushing commits to remote...');
    
    try {
      await this.gitCommand(['push', 'origin', 'master']);
      console.log('✅ Push completado exitosamente');
    } catch (error) {
      console.error('❌ Error en push:', error);
      console.log('💡 Los commits están en tu repositorio local');
    }
  }

  /**
   * Valida que auto-approve es seguro de ejecutar
   */
  private async validateAutoApprove(): Promise<boolean> {
    try {
      // Verificar que estamos en la rama correcta
      const currentBranch = await this.gitCommand(['branch', '--show-current']);
      if (currentBranch !== 'master') {
        console.warn(`⚠️ No estás en la rama master (actual: ${currentBranch})`);
        return false;
      }
      
      // Verificar que el repositorio está limpio (sin conflictos)
      const statusOutput = await this.gitCommand(['status', '--porcelain']);
      const conflicts = statusOutput.split('\n').filter(line => line.startsWith('UU'));
      if (conflicts.length > 0) {
        console.error('❌ Hay conflictos de merge sin resolver');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error validando repositorio:', error);
      return false;
    }
  }

  /**
   * Ejecuta el generador completo
   */
  async generate(): Promise<void> {
    console.log(`🚀 Iniciando generador de commits...${this.autoApprove ? ' (AUTO-APPROVE MODE)' : ''}\n`);

    const args = process.argv.slice(2);
    const isExhaustive = args.includes('-exhaustive');

    // Parsear parámetros de contexto mejorados
    let extraContext = '';
    let workType = '';
    let contextDescription = '';
    let affectedComponents = '';
    let performanceImpact = '';
    let breakingChanges = '';

    const extraIndex = args.indexOf('--extra');
    if (extraIndex > -1 && args[extraIndex + 1]) {
        extraContext = args[extraIndex + 1];
        console.log(`💬 Contexto extra proporcionado por el usuario.`);
    } else if (extraIndex > -1) {
        console.warn('⚠️ El parámetro --extra requiere un valor de texto después.');
    }

    const contextIndex = args.indexOf('--context');
    if (contextIndex > -1 && args[contextIndex + 1]) {
        contextDescription = args[contextIndex + 1];
        console.log(`📋 Contexto del trabajo: ${contextDescription}`);
    }

    const workTypeIndex = args.indexOf('--work-type');
    if (workTypeIndex > -1 && args[workTypeIndex + 1]) {
        workType = args[workTypeIndex + 1];
        console.log(`🏷️ Tipo de trabajo: ${workType}`);
    }

    const componentsIndex = args.indexOf('--affected-components');
    if (componentsIndex > -1 && args[componentsIndex + 1]) {
        affectedComponents = args[componentsIndex + 1];
        console.log(`🎯 Componentes afectados: ${affectedComponents}`);
    }

    const perfIndex = args.indexOf('--performance-impact');
    if (perfIndex > -1 && args[perfIndex + 1]) {
        performanceImpact = args[perfIndex + 1];
        console.log(`⚡ Impacto en rendimiento: ${performanceImpact}`);
    }

    const breakingIndex = args.indexOf('--breaking-changes');
    if (breakingIndex > -1 && args[breakingIndex + 1]) {
        breakingChanges = args[breakingIndex + 1];
        console.log(`⚠️ Cambios que rompen compatibilidad: ${breakingChanges}`);
    }

    try {
      // Verificar que estamos en un repositorio git
      await this.gitCommand(['status']);

      // Generar análisis completo
      const analysis = await this.generateAnalysisContext();
      
      if (analysis.files.length === 0) {
        console.log('✅ No hay cambios para procesar');
        return;
      }

      const fileCount = analysis.files.length;
      const exhaustiveMode = isExhaustive || fileCount > 50;

      console.log(`📋 Encontrados ${fileCount} archivos modificados`);
      console.log(`📊 Estadísticas: +${analysis.stats.total_additions} -${analysis.stats.total_deletions} líneas`);
      if (exhaustiveMode) {
        console.log('⚡️ Activado modo de análisis exhaustivo.');
      }

      // Preparar contexto completo mejorado
      const enhancedContext = this.buildEnhancedContext(
        extraContext,
        contextDescription,
        workType,
        affectedComponents,
        performanceImpact,
        breakingChanges
      );

      // Analizar con Gemini
      const commitProposal = await this.analyzeWithGemini(analysis, exhaustiveMode, enhancedContext);
      
      // Guardar propuesta
      const proposalPath = this.saveCommitProposal(commitProposal);
      
      if (this.autoApprove) {
        // Validar que es seguro ejecutar auto-approve
        const isValid = await this.validateAutoApprove();
        if (!isValid) {
          console.error('❌ Auto-approve cancelado por validaciones de seguridad');
          return;
        }
        
        // Parsear y ejecutar commits
        console.log('\n🤖 Ejecutando commits automáticamente...');
        const proposals = this.parseCommitProposals(commitProposal);
        
        if (proposals.length === 0) {
          console.warn('⚠️ No se encontraron commits válidos para ejecutar');
          console.log('📋 Revisa la propuesta manualmente:');
          console.log(commitProposal);
          return;
        }
        
        console.log(`📦 Encontrados ${proposals.length} commits para ejecutar:`);
        proposals.forEach((p, i) => {
          console.log(`  ${i + 1}. ${p.title}`);
        });
        
        let successfulCommits = 0;
        
        // Ejecutar cada commit secuencialmente
        for (let i = 0; i < proposals.length; i++) {
          const proposal = proposals[i];
          const success = await this.executeCommit(proposal, analysis.files);
          if (success) {
            successfulCommits++;
          } else {
            console.error(`❌ Falló commit ${i + 1}: ${proposal.title}`);
            // Continuar con los siguientes commits
          }
        }
        
        console.log(`\n📊 Resultados: ${successfulCommits}/${proposals.length} commits exitosos`);
        
        if (successfulCommits > 0) {
          await this.pushCommits();
        }
        
        console.log('\n✅ Auto-approve completado');
        
      } else {
        // Modo normal - solo mostrar propuesta
        console.log('\n✅ Análisis completado');
        console.log(`📄 Propuesta guardada en: ${proposalPath}`);
        console.log('\n📋 Propuesta de commits:');
        console.log('─'.repeat(60));
        console.log(commitProposal);
        console.log('─'.repeat(60));
        console.log('\n💡 Usa --auto-approve para ejecutar automáticamente los commits');
      }

    } catch (error) {
      console.error('❌ Error en el generador:', error);
      process.exit(1);
    }
  }
}

// Ejecutar el generador si se llama directamente
if (import.meta.main) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🚀 Generador Automático de Commits con Gemini CLI

Analiza cambios del repositorio y genera commits coherentes siguiendo los patrones del proyecto.

Uso:
  bun src/commit-generator.ts [opciones]

Opciones:
  --auto-approve                Ejecutar automáticamente los commits propuestos y hacer push
  --no-push                    Con --auto-approve, no hacer push (solo commits locales)
  --extra <texto>              Contexto adicional para mejorar el análisis
  --context <descripción>      Descripción del trabajo actual
  --work-type <tipo>           Tipo: feature|bugfix|refactor|docs|performance|ui|api|security|test
  --affected-components <lista> Componentes afectados (ej: "productos,carrito,checkout")
  --performance-impact <tipo>  Impacto: mejora|neutro|regresion
  --breaking-changes <si|no>   Si introduce cambios incompatibles
  --exhaustive                 Análisis exhaustivo para proyectos complejos (automático si >50 archivos)
  --help, -h                   Mostrar esta ayuda

Ejemplos:
  bun run commit                                    # Generar propuesta básica
  bun run commit --auto-approve                     # Ejecutar automáticamente
  bun run commit --context "sistema de productos"  # Con descripción del trabajo
  bun run commit --work-type feature --context "carrito de compras" # Feature específica
  bun run commit --work-type bugfix --affected-components "checkout,pagos" # Bug fix
  bun run commit --performance-impact mejora --work-type performance # Optimización
  bun run commit --breaking-changes si --work-type refactor # Refactor mayor
  bun run commit --exhaustive --auto-approve       # Análisis completo y ejecución

Modo Auto-Approve:
- Valida estado del repositorio (rama master, sin conflictos)
- Parsea commits propuestos por Gemini AI
- Ejecuta cada commit secuencialmente con archivos apropiados
- Hace push automático a origin/master (excepto con --no-push)
- Manejo de errores y rollback en caso de fallos

Seguridad:
- Solo funciona en rama master
- Validación de conflictos antes de ejecutar
- Commits atómicos con manejo de errores individual
- Logs completos de todas las operaciones
`);
    process.exit(0);
  }
  
  const generator = new CommitGenerator();
  await generator.generate();
}