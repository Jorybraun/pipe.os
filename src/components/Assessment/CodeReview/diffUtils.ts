/**
 * formatCustomDiff - Generates a fake "addition" diff for a block of code.
 * react-diff-view expects git-style diff strings.
 */
export function formatCustomDiff(code: string, filename: string): string {
  const lines = code.split('\n');
  const lineCount = lines.length;
  
  // Create a git-style diff header
  // Quoting the filename helps handle titles with spaces
  const safeName = filename.replace(/"/g, '');
  const quotedName = safeName.includes(' ') ? `"${safeName}"` : safeName;
  const header = [
    `diff --git a/${quotedName} b/${quotedName}`,
    `new file mode 100644`,
    `index 0000000..0000000`,
    `--- /dev/null`,
    `+++ b/${quotedName}`,
    `@@ -0,0 +1,${lineCount} @@`
  ];

  // Prefix every line with '+' to indicate addition
  const diffLines = lines.map(line => `+${line}`);
  
  return [...header, ...diffLines].join('\n');
}
