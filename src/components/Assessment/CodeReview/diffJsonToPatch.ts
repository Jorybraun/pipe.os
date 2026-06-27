import type { DiffJson, DiffFile } from '../DiffPanel';

type NormalizedLineType = 'addition' | 'deletion' | 'context';

function normalizeLineType(type: string): NormalizedLineType {
  if (type === 'added') return 'addition';
  if (type === 'deleted') return 'deletion';
  if (type === 'addition' || type === 'deletion' || type === 'context') return type;
  return 'context';
}

function lineNumberFor(line: DiffFile['hunks'][number]['lines'][number], fallback: number): number {
  return line.lineNumber ?? line.num ?? fallback;
}

function isUnifiedHunkHeader(header: string): boolean {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(header);
}

function synthesizeUnifiedHunkHeader(hunk: DiffFile['hunks'][number]): string {
  let oldStart: number | null = null;
  let newStart: number | null = null;
  let oldCount = 0;
  let newCount = 0;

  hunk.lines.forEach((line, index) => {
    const type = normalizeLineType(line.type);
    const fallback = index + 1;
    const lineNumber = lineNumberFor(line, fallback);

    if (type !== 'addition') {
      oldStart ??= lineNumber;
      oldCount += 1;
    }

    if (type !== 'deletion') {
      newStart ??= lineNumber;
      newCount += 1;
    }
  });

  if (oldStart === null && newStart !== null) oldStart = Math.max(0, newStart - 1);
  if (newStart === null && oldStart !== null) newStart = Math.max(0, oldStart - 1);

  return `@@ -${oldStart ?? 0},${oldCount} +${newStart ?? 0},${newCount} @@`;
}

/**
 * Convert a single DiffFile to a unified diff patch string.
 */
export function diffFileToPatch(file: DiffFile): string {
  const lines: string[] = [];

  // Git diff header
  if (file.status === 'added') {
    lines.push(`diff --git a/${file.path} b/${file.path}`);
    lines.push('new file mode 100644');
    lines.push('--- /dev/null');
    lines.push(`+++ b/${file.path}`);
  } else if (file.status === 'deleted') {
    lines.push(`diff --git a/${file.path} b/${file.path}`);
    lines.push('deleted file mode 100644');
    lines.push(`--- a/${file.path}`);
    lines.push('+++ /dev/null');
  } else {
    lines.push(`diff --git a/${file.path} b/${file.path}`);
    lines.push(`--- a/${file.path}`);
    lines.push(`+++ b/${file.path}`);
  }

  // Hunks
  for (const hunk of file.hunks) {
    lines.push(isUnifiedHunkHeader(hunk.header) ? hunk.header : synthesizeUnifiedHunkHeader(hunk));
    for (const line of hunk.lines) {
      switch (normalizeLineType(line.type)) {
        case 'addition':
          lines.push(`+${line.content}`);
          break;
        case 'deletion':
          lines.push(`-${line.content}`);
          break;
        case 'context':
          lines.push(` ${line.content}`);
          break;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Convert DiffJson to a full multi-file unified diff patch string.
 */
export function diffJsonToPatch(diff: DiffJson): string {
  return diff.files.map(diffFileToPatch).join('\n');
}
