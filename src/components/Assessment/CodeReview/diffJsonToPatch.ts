import type { DiffJson, DiffFile } from '../DiffPanel';

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
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      switch (line.type) {
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
