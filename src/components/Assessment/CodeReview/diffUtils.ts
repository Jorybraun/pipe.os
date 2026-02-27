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
  const header = [
    `diff --git a/"${safeName}" b/"${safeName}"`,
    `new file mode 100644`,
    `index 0000000..0000000`,
    `--- /dev/null`,
    `+++ b/"${safeName}"`,
    `@@ -0,0 +1,${lineCount} @@`
  ];

  // Prefix every line with '+' to indicate addition
  const diffLines = lines.map(line => `+${line}`);
  
  return [...header, ...diffLines].join('\n');
}
