#!/usr/bin/env bun

/**
 * GitHub Release Manager para EL Haido TPV
 * Detecta nuevas versiones en /releases y crea releases automáticamente en GitHub
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

interface ReleaseInfo {
  version: string;
  prefix?: string;
  baseVersion: string;
  path: string;
  files: string[];
  readme: string;
  isPrerelease: boolean;
}

interface ChangelogEntry {
  type: 'feature' | 'fix' | 'improvement' | 'breaking';
  title: string;
  description: string;
}

interface VersionData {
  version: string;
  date: string;
  type: 'initial' | 'major' | 'minor' | 'patch';
  title: string;
  changes: ChangelogEntry[];
  technical_notes: string;
  breaking_changes: string[];
}

class GitHubReleaseManager {
  private projectRoot: string;
  private releasesDir: string;
  private changelogPath: string;

  constructor() {
    this.projectRoot = process.cwd();
    this.releasesDir = join(this.projectRoot, 'releases');
    this.changelogPath = join(this.projectRoot, 'public/data/changelog.json');
  }

  /**
   * Ejecuta comando gh CLI
   */
  private async ghCommand(args: string[]): Promise<string> {
    const result = Bun.spawnSync(['gh', ...args], {
      cwd: this.projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      const error = result.stderr?.toString() || 'gh command failed';
      throw new Error(`GitHub CLI error: ${error}`);
    }

    return result.stdout?.toString().trim() || '';
  }

  /**
   * Verifica si gh CLI está instalado y autenticado
   */
  private async checkGitHubCLI(): Promise<void> {
    try {
      await this.ghCommand(['auth', 'status']);
      console.log('✅ GitHub CLI autenticado correctamente');
    } catch (error) {
      console.error('❌ GitHub CLI no está instalado o no estás autenticado');
      console.log('💡 Instala gh CLI: https://cli.github.com/');
      console.log('💡 Autentica con: gh auth login');
      throw error;
    }
  }

  /**
   * Obtiene todas las releases existentes en GitHub
   */
  private async getExistingReleases(): Promise<Set<string>> {
    try {
      const output = await this.ghCommand(['release', 'list', '--json', 'tagName']);
      const releases = JSON.parse(output);
      return new Set(releases.map((r: any) => r.tagName));
    } catch (error) {
      console.warn('⚠️ No se pudieron obtener releases existentes:', error);
      return new Set();
    }
  }

  /**
   * Escanea el directorio releases para encontrar versiones disponibles
   */
  private scanReleases(): ReleaseInfo[] {
    const releases: ReleaseInfo[] = [];

    if (!existsSync(this.releasesDir)) {
      console.warn('⚠️ Directorio releases no existe');
      return releases;
    }

    // Escanear por prefijos (alpha, beta, rc)
    const prefixes = readdirSync(this.releasesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const prefix of prefixes) {
      const prefixDir = join(this.releasesDir, prefix);
      
      // Escanear versiones dentro del prefijo
      const versions = readdirSync(prefixDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const version of versions) {
        const versionDir = join(prefixDir, version);
        const readmePath = join(versionDir, 'README.md');
        
        if (existsSync(readmePath)) {
          // Obtener archivos de la release
          const files = readdirSync(versionDir)
            .filter(file => file !== 'README.md')
            .map(file => join(versionDir, file));

          const fullVersion = prefix === 'stable' ? version : `${prefix}-${version}`;
          
          releases.push({
            version: fullVersion,
            prefix: prefix === 'stable' ? undefined : prefix,
            baseVersion: version,
            path: versionDir,
            files,
            readme: readFileSync(readmePath, 'utf-8'),
            isPrerelease: prefix !== 'stable'
          });
        }
      }
    }

    return releases.sort((a, b) => b.version.localeCompare(a.version));
  }

  /**
   * Carga información del changelog para una versión específica
   */
  private getChangelogForVersion(version: string): VersionData | null {
    try {
      const changelogData = JSON.parse(readFileSync(this.changelogPath, 'utf-8'));
      return changelogData.versions.find((v: VersionData) => v.version === version) || null;
    } catch (error) {
      console.warn(`⚠️ No se pudo cargar changelog para ${version}`);
      return null;
    }
  }

  /**
   * Genera las release notes basadas en changelog y README
   */
  private generateReleaseNotes(release: ReleaseInfo): string {
    const changelog = this.getChangelogForVersion(release.version);
    
    let notes = `# EL Haido TPV - ${release.version}\n\n`;
    
    if (changelog) {
      notes += `## 📋 Resumen\n${changelog.title}\n\n`;
      
      // Agrupar cambios por tipo
      const features = changelog.changes.filter(c => c.type === 'feature');
      const fixes = changelog.changes.filter(c => c.type === 'fix');
      const improvements = changelog.changes.filter(c => c.type === 'improvement');
      const breaking = changelog.changes.filter(c => c.type === 'breaking');
      
      if (features.length > 0) {
        notes += `## ✨ Nuevas Funcionalidades\n`;
        features.forEach(f => notes += `- ${f.title}\n`);
        notes += '\n';
      }
      
      if (fixes.length > 0) {
        notes += `## 🐛 Correcciones\n`;
        fixes.forEach(f => notes += `- ${f.title}\n`);
        notes += '\n';
      }
      
      if (improvements.length > 0) {
        notes += `## 🚀 Mejoras\n`;
        improvements.forEach(i => notes += `- ${i.title}\n`);
        notes += '\n';
      }
      
      if (breaking.length > 0) {
        notes += `## 💥 Cambios Importantes\n`;
        breaking.forEach(b => notes += `- ${b.title}\n`);
        notes += '\n';
      }
    }
    
    // Agregar información de instalación del README
    const readmeLines = release.readme.split('\n');
    const installIndex = readmeLines.findIndex(line => line.includes('## Instalación'));
    const compatIndex = readmeLines.findIndex(line => line.includes('## Compatibilidad'));
    
    if (installIndex !== -1) {
      notes += `## 📦 Instalación\n\n`;
      const endIndex = compatIndex !== -1 ? compatIndex : readmeLines.length;
      const installSection = readmeLines.slice(installIndex + 1, endIndex);
      notes += installSection.join('\n') + '\n\n';
    }
    
    // Información de archivos
    notes += `## 📁 Archivos de la Release\n\n`;
    release.files.forEach(file => {
      const fileName = basename(file);
      const stats = statSync(file);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
      notes += `- **${fileName}** (${sizeMB} MB)\n`;
    });
    
    notes += `\n---\n\n`;
    notes += `🏗️ **Plataforma objetivo**: Raspberry Pi 3B+ (ARM64)\n`;
    notes += `🗓️ **Fecha**: ${changelog?.date || new Date().toISOString().split('T')[0]}\n`;
    
    if (release.isPrerelease) {
      notes += `\n⚠️ **Nota**: Esta es una versión ${release.prefix} en desarrollo. No recomendada para producción.\n`;
    }

    return notes;
  }

  /**
   * Crea una release en GitHub
   */
  private async createGitHubRelease(release: ReleaseInfo): Promise<void> {
    console.log(`🚀 Creando release ${release.version}...`);
    
    const tagName = `v${release.version}`;
    const title = `EL Haido TPV v${release.version}`;
    const notes = this.generateReleaseNotes(release);
    
    // Crear archivo temporal con las release notes
    const notesFile = join(this.projectRoot, `.release-notes-${release.version}.md`);
    Bun.write(notesFile, notes);
    
    try {
      // Crear la release
      const args = [
        'release', 'create', tagName,
        '--title', title,
        '--notes-file', notesFile,
        ...release.files
      ];
      
      if (release.isPrerelease) {
        args.push('--prerelease');
      }
      
      await this.ghCommand(args);
      console.log(`✅ Release ${release.version} creada exitosamente`);
      
      // Limpiar archivo temporal
      await Bun.file(notesFile).write('');
      
    } catch (error) {
      console.error(`❌ Error creando release ${release.version}:`, error);
      throw error;
    }
  }

  /**
   * Procesa todas las releases
   */
  async processReleases(force = false): Promise<void> {
    console.log('🔍 GitHub Release Manager iniciado\n');
    
    try {
      await this.checkGitHubCLI();
      
      const localReleases = this.scanReleases();
      console.log(`📦 Encontradas ${localReleases.length} releases locales`);
      
      if (localReleases.length === 0) {
        console.log('✅ No hay releases para procesar');
        return;
      }
      
      const existingReleases = await getExistingReleases();
      console.log(`📋 ${existingReleases.size} releases ya existen en GitHub`);
      
      let created = 0;
      let skipped = 0;
      
      for (const release of localReleases) {
        const tagName = `v${release.version}`;
        
        if (existingReleases.has(tagName) && !force) {
          console.log(`⏭️ Release ${release.version} ya existe, omitiendo`);
          skipped++;
          continue;
        }
        
        if (force && existingReleases.has(tagName)) {
          console.log(`🔄 Eliminando release existente ${release.version}...`);
          try {
            await this.ghCommand(['release', 'delete', tagName, '--yes']);
          } catch (error) {
            console.warn(`⚠️ No se pudo eliminar release ${tagName}:`, error);
          }
        }
        
        await this.createGitHubRelease(release);
        created++;
        
        // Pequeña pausa entre releases
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log(`\n✅ Procesamiento completado:`);
      console.log(`   📦 Creadas: ${created}`);
      console.log(`   ⏭️ Omitidas: ${skipped}`);
      
    } catch (error) {
      console.error('❌ Error en el procesamiento:', error);
      throw error;
    }
  }

  /**
   * Monitorea el directorio releases para cambios
   */
  async watchForNewReleases(): Promise<void> {
    console.log('👀 Monitoreando directorio releases para nuevas versiones...');
    // Implementación futura con file watchers
    console.log('💡 Funcionalidad de monitoreo en desarrollo');
  }
}

// Función helper para obtener releases existentes (fix de scope)
async function getExistingReleases(): Promise<Set<string>> {
  try {
    const result = Bun.spawnSync(['gh', 'release', 'list', '--json', 'tagName'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (result.exitCode !== 0) {
      return new Set();
    }

    const releases = JSON.parse(result.stdout?.toString() || '[]');
    return new Set(releases.map((r: any) => r.tagName));
  } catch (error) {
    return new Set();
  }
}

// Ejecutar script
if (import.meta.main) {
  const manager = new GitHubReleaseManager();
  
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  const watch = args.includes('--watch') || args.includes('-w');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🚀 GitHub Release Manager para EL Haido TPV

Uso:
  bun run project-utils/github-release-manager.ts [opciones]

Opciones:
  --force, -f     Recrear releases existentes
  --watch, -w     Monitorear cambios (en desarrollo)
  --help, -h      Mostrar esta ayuda

Ejemplos:
  bun run project-utils/github-release-manager.ts
  bun run project-utils/github-release-manager.ts --force
`);
    process.exit(0);
  }
  
  try {
    if (watch) {
      await manager.watchForNewReleases();
    } else {
      await manager.processReleases(force);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}