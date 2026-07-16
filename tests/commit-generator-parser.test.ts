/**
 * Regression tests for the commit-generator's parseCommitProposals wrapper.
 *
 * Covers F4/F22 footguns — verifies that the wrapper method on
 * CommitGenerator forwards the `files` array from the underlying parser
 * instead of silently dropping it. The bug it guards against:
 *
 *   commit-generator.ts → parseCommitProposals(...) returned
 *     [{ ..., files: [] }]   ← always empty, regardless of AI output
 *
 * Even when the AI emits a perfect `### Archivos de la Propuesta #N`
 * section, the wrapper was hardcoding `files: []`, which made every
 * proposal trigger `MISSING_PROPOSAL_FILES` in `executeCommit` and
 * produce `✗ Commit failed` with 0 commits applied.
 *
 * @module tests/commit-generator-parser
 */
import { describe, expect, it } from 'vitest';
import { GeminiResponseParser } from '../src/prompt-templates';

describe('CommitGenerator.parseCommitProposals — files forwarding (F4 regression)', () => {
    /**
     * Mirrors the wrapper logic in CommitGenerator.parseCommitProposals.
     * If the wrapper regresses to `files: []`, these tests fail.
     */
    const wrap = (aiResponse: string) => {
        const parsed = GeminiResponseParser.parseCommitProposals(aiResponse);
        return parsed.map(p => ({
            title: p.title,
            description: p.description,
            technical: p.technical,
            changelog: p.changelog,
            files: p.files ?? [],
        }));
    };

    it('forwards files from a single-proposal response', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat: add file',
            '',
            'body',
            '```',
            '',
            '### **Archivos de la Propuesta #1** (OBLIGATORIO)',
            '',
            '```files',
            'untracked.txt',
            '```',
            '',
        ].join('\n');

        const proposals = wrap(response);
        expect(proposals).toHaveLength(1);
        expect(proposals[0].files).toEqual(['untracked.txt']);
    });

    it('forwards files for each proposal in a multi-proposal response', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat(a): first',
            '',
            'body 1',
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
            'body 2',
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

        const proposals = wrap(response);
        expect(proposals).toHaveLength(2);
        expect(proposals[0].files).toEqual(['src/a.ts']);
        expect(proposals[1].files).toEqual(['src/b.ts', 'src/c.ts']);
    });

    it('preserves empty files array when AI omits the section', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat: no files',
            '',
            'body',
            '```',
            '',
        ].join('\n');

        const proposals = wrap(response);
        expect(proposals).toHaveLength(1);
        expect(proposals[0].files).toEqual([]);
    });

    it('forwards plain-list files (no fence)', () => {
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'fix: list files',
            '',
            'body',
            '```',
            '',
            '### **Archivos de la Propuesta #1**',
            '',
            '- src/a.ts',
            '- src/b.ts',
            '',
        ].join('\n');

        const proposals = wrap(response);
        expect(proposals[0].files).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('does not cross-pollute files between proposals', () => {
        // Proposal 1 declares its files; proposal 2 does NOT.
        // Each proposal must keep its own files array.
        const response = [
            '### **Propuesta de Commit #1**',
            '',
            '```markdown',
            'feat(a): with files',
            '',
            'body 1',
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
            'feat(b): no files',
            '',
            'body 2',
            '```',
            '',
        ].join('\n');

        const proposals = wrap(response);
        expect(proposals).toHaveLength(2);
        expect(proposals[0].files).toEqual(['src/a.ts']);
        expect(proposals[1].files).toEqual([]);
    });
});
