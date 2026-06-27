import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../DiffPanel';
import { diffFileToPatch } from './diffJsonToPatch';

describe('diffFileToPatch', () => {
  it('renders persisted source-backed added lines as a valid unified patch', () => {
    const file: DiffFile = {
      path: 'packages/deploy-helpers/src/deploy/helpers/check-workflow-conflicts.ts',
      status: 'modified',
      additions: 2,
      deletions: 0,
      hunks: [
        {
          header: '@@ source-backed packages/deploy-helpers/src/deploy/helpers/check-workflow-conflicts.ts:85-85 @@',
          lines: [
            { type: 'added', content: 'const message =', lineNumber: 85 },
            { type: 'added', content: 'return { hasConflicts: true, conflicts, message };', lineNumber: 86 },
          ],
        },
      ],
    };

    expect(diffFileToPatch(file)).toContain('@@ -84,0 +85,2 @@');
    expect(diffFileToPatch(file)).toContain('+const message =');
    expect(diffFileToPatch(file)).toContain('+return { hasConflicts: true, conflicts, message };');
  });

  it('does not leak source-backed labels into Pierre patch hunks', () => {
    const file: DiffFile = {
      path: '.changeset/explain-workflow-name-conflict.md',
      status: 'modified',
      additions: 7,
      deletions: 0,
      hunks: [
        {
          header: '@@ source-backed .changeset/explain-workflow-name-conflict.md:1-7 @@',
          lines: [
            { type: 'added', content: '---', lineNumber: 1 },
            { type: 'added', content: '"wrangler": patch', lineNumber: 2 },
            { type: 'added', content: '---', lineNumber: 3 },
            { type: 'added', content: '', lineNumber: 4 },
            { type: 'added', content: 'Improve the deploy warning shown when a Workflow name already belongs to another Worker', lineNumber: 5 },
            { type: 'added', content: '', lineNumber: 6 },
            { type: 'added', content: 'The warning still notes that deploying reassigns the workflow to the current Worker.', lineNumber: 7 },
          ],
        },
      ],
    };

    const patch = diffFileToPatch(file);

    expect(patch).not.toContain('@@ source-backed');
    expect(patch).toContain('@@ -0,0 +1,7 @@');
  });
});
