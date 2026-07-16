/**
 * Tests for the AI response parser — verifies that the
 * `### Archivos de la Propuesta #N` section is correctly extracted
 * into `proposal.files`. This is the v2.0 hardening that prevents
 * the AI from making commits without an explicit file declaration.
 *
 * @module tests/parser-files
 */
import { describe, expect, it } from 'vitest';
import { GeminiResponseParser } from '../src/prompt-templates';

describe('GeminiResponseParser — files extraction', () => {
    it('extracts files from fenced ```files``` block', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat(core): add files extraction',
            '',
            'Body text',
            '',
            '```',
            '',
            '### **Archivos de la Propuesta #1**',
            '',
            '```files',
            'src/prompt-templates.ts',
            'tests/parser-files.test.ts',
            '```',
            '',
        ].join('\n');

        const proposals = GeminiResponseParser.parseCommitProposals(response);

        expect(proposals).toHaveLength(1);
        expect(proposals[0].title).toBe('feat(core): add files extraction');
        expect(proposals[0].files).toEqual([
            'src/prompt-templates.ts',
            'tests/parser-files.test.ts',
        ]);
    });

    it('extracts files from plain list (no fence)', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'fix(api): handle empty input',
            '',
            'Body',
            '',
            '```',
            '',
            '### **Archivos de la Propuesta #1**',
            '',
            '- src/api/handler.ts',
            '- src/api/validator.ts',
            '',
        ].join('\n');

        const proposals = GeminiResponseParser.parseCommitProposals(response);

        expect(proposals).toHaveLength(1);
        expect(proposals[0].files).toEqual([
            'src/api/handler.ts',
            'src/api/validator.ts',
        ]);
    });

    it('returns empty files when the section is missing', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat(core): no files declared',
            '',
            'Body',
            '',
            '```',
            '',
        ].join('\n');

        const proposals = GeminiResponseParser.parseCommitProposals(response);

        expect(proposals).toHaveLength(1);
        expect(proposals[0].files).toEqual([]);
    });

    it('pairs multiple proposals with their respective file lists', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat(a): first',
            '',
            'Body 1',
            '',
            '```',
            '',
            '### **Archivos de la Propuesta #1**',
            '',
            '```files',
            'src/a.ts',
            '```',
            '',
            '### **Propuesta de Commit #2**',
            '',
            '```markdown',
            'feat(b): second',
            '',
            'Body 2',
            '',
            '```',
            '',
            '### **Archivos de la Propuesta #2**',
            '',
            '```files',
            'src/b.ts',
            'src/c.ts',
            '```',
            '',
        ].join('\n');

        const proposals = GeminiResponseParser.parseCommitProposals(response);

        expect(proposals).toHaveLength(2);
        expect(proposals[0].files).toEqual(['src/a.ts']);
        expect(proposals[1].files).toEqual(['src/b.ts', 'src/c.ts']);
    });

    it('strips list markers and dedupes paths', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat: dedup',
            '',
            'Body',
            '',
            '```',
            '',
            '### **Archivos de la Propuesta #1**',
            '',
            '```files',
            '- src/a.ts',
            '* src/a.ts',
            'src/b.ts',
            '',
            '# this is a comment',
            '',
            '```',
            '',
        ].join('\n');

        const proposals = GeminiResponseParser.parseCommitProposals(response);

        expect(proposals[0].files).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('does not crash on a malformed section header', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat: weird',
            '',
            'Body',
            '',
            '```',
            '',
            '### **Archivos de la Propuesta #999**',
            '',
            'src/x.ts',
            '',
        ].join('\n');

        const proposals = GeminiResponseParser.parseCommitProposals(response);

        // The malformed index points past the proposals array, so
        // proposal 1 keeps its empty `files: []`.
        expect(proposals).toHaveLength(1);
        expect(proposals[0].files).toEqual([]);
    });
});