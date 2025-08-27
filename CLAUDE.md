# Gemini Commit Wizard - AI-Powered Commit Generation

## 📋 Commit Message Patterns

**OBLIGATORIO**: Siempre seguir estos patrones para commits consistentes y parseables.

### Estructura de Commits

```
[prefijo]([área] - [descripción breve])

[Descripción completa en castellano de QUÉ se logró y POR QUÉ se realizó el cambio]

<technical>
[Detalles técnicos específicos: archivos modificados, funciones añadidas, refactorizaciones realizadas, types o interfaces modificadas, etc.]
</technical>

<changelog>
## [Tipo] [Emoji]
[Entrada optimizada para changelog de la aplicación, describiendo el cambio desde la perspectiva del usuario final]
</changelog>
```

### Prefijos Válidos
- `feat(` - Nueva funcionalidad
- `fix(` - Corrección de errores  
- `refactor(` - Refactorización de código
- `docs(` - Actualización de documentación
- `test(` - Adición/modificación de tests
- `feat-phase(` - Feature incompleta (desarrollo por fases)

### Ejemplos de Commits Válidos

```bash
feat(ui): añade componente de selector de fecha

Implementa un nuevo componente DatePicker con validación automática y soporte para rangos de fechas. Permite selección individual o por rango con feedback visual.

<technical>
- Añadido DatePicker.tsx con props para single/range mode
- Implementada validación de fechas con date-fns
- Agregados estilos CSS con variables para theming
- Exportado desde components/index.ts
- Añadidos tipos DatePickerProps y DateRange
</technical>

<changelog>
## [New] ✨
Nuevo selector de fechas con validación automática y modo de rango
</changelog>
```

```bash
fix(api): corrige timeout en consultas de productos

Ajusta el timeout de las consultas a la base de datos de 5s a 30s para evitar errores en consultas complejas con muchos filtros aplicados.

<technical>
- Modificado timeout en database/config.ts de 5000ms a 30000ms
- Añadido retry logic en ProductRepository.findWithFilters()
- Mejorado error handling para TimeoutError
- Actualizada documentación de la función
</technical>

<changelog>
## [Fixed] 🐛
Solucionados timeouts en búsquedas avanzadas de productos
</changelog>
```

## 🤖 Gemini CLI Integration

### Prompt Template Structure

El sistema utiliza plantillas estructuradas para garantizar respuestas consistentes de Gemini CLI:

- **Análisis de contexto**: Información del proyecto y cambios detectados
- **Formato de respuesta**: Estructura obligatoria con secciones `<technical>` y `<changelog>`
- **Parsing automático**: Extracción de propuestas de commit parseables

### Response Format

Gemini CLI debe responder con esta estructura exacta:

```markdown
### **ANÁLISIS PRINCIPAL**
[Descripción general de los cambios detectados]

---

### **Propuesta de Commit #1**
```markdown
[prefijo](área - descripción)

[Descripción completa del cambio]

<technical>
[Detalles técnicos específicos]
</technical>

<changelog>
## [Tipo] [Emoji] 
[Entrada para changelog]
</changelog>
```

### **Propuesta de Commit #2** (si es necesario)
[Repetir formato anterior]

---

**DECISIÓN**: [Explicación de por qué uno o múltiples commits]
```

## 🚀 Usage Commands

### Interactive Commit Generation
```bash
# UI interactiva (macOS/Linux con GUI)
bun src/commit-ui.ts

# Modo rápido sin prompts
bun src/commit-ui.ts --quick

# Terminal fallback
bun src/commit-ui.ts  # automáticamente detecta si no hay GUI
```

### Manual Commit Generation
```bash
# Generación básica
bun src/commit-generator.ts

# Con contexto específico
bun src/commit-generator.ts --context "implementación de login"

# Con tipo de trabajo
bun src/commit-generator.ts --work-type feature --context "nuevo dashboard"

# Ejecución automática (sin confirmar)
bun src/commit-generator.ts --auto-approve

# Con componentes específicos
bun src/commit-generator.ts --work-type fix --affected-components "api,database" --context "problema con consultas"
```

### Version Management (opcional)
```bash
# Analizar commits y versionar
bun src/version-manager.ts

# Forzar tipo de versión
bun src/version-manager.ts --type minor

# Con prefijo de desarrollo
bun src/version-manager.ts --prefix alpha
```

## 🔧 Development Setup

### Dependencies Required
- **Bun**: Runtime y package manager
- **Gemini CLI**: Para análisis de commits con IA
- **Git**: Sistema de control de versiones

### macOS GUI Dependencies
- **osascript**: Para diálogos nativos (incluido en macOS)

### Linux GUI Dependencies  
- **zenity**: Para diálogos en Linux
```bash
# Ubuntu/Debian
sudo apt install zenity

# Arch Linux
sudo pacman -S zenity

# Fedora
sudo dnf install zenity
```

## 📁 Project Structure

```
gemini-commit-wizard/
├── src/
│   ├── commit-generator.ts    # Core commit generation with Gemini CLI
│   ├── commit-ui.ts          # Interactive UI for commit creation  
│   ├── prompt-templates.ts   # Standardized Gemini prompt templates
│   └── version-manager.ts    # Semantic versioning automation
├── .run/                     # WebStorm run configurations
│   ├── commit-ui-interactive.run.xml
│   └── commit-ui-quick.run.xml
└── .temp/                    # Temporary files (auto-generated)
```

## 🎯 Key Features

- **AI-Powered Analysis**: Gemini CLI analiza cambios y genera commits coherentes
- **Interactive UI**: Formularios nativos en macOS/Linux con fallback a terminal
- **Structured Output**: Formato consistente con parsing automático
- **Multi-commit Support**: Separación lógica de cambios en múltiples commits
- **WebStorm Integration**: Configuraciones listas para usar
- **Cross-platform**: Soporte para macOS, Linux y Windows
- **Auto-execution**: Modo automático para CI/CD pipelines

## 📜 Author Guidelines

- **Author**: MKS2508
- **No external attribution**: Never mention Claude Code or AI assistance
- **Clean commits**: No debugging comments or unnecessary explanations
- **Focused scope**: Each commit should have a single clear purpose
- **Spanish descriptions**: All commit messages in Spanish for consistency

---

**Recordatorio**: Estos patrones son fundamentales para mantener un historial de commits limpio, consistente y útil para el seguimiento de cambios y generación automática de changelogs.