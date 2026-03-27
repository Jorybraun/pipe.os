// ---------------------------------------------------------------------------
// VirtualFS — multi-file system for CODE_IMPLEMENTATION challenges
// ---------------------------------------------------------------------------

/** A single file in the virtual filesystem */
export interface VirtualFile {
  content: string;
  language: string; // 'javascript' | 'typescript' | 'html' | 'css' | 'json'
  readOnly?: boolean;
  hidden?: boolean;
}

/** Complete file tree keyed by path: '/solution.js', '/index.html', etc. */
export type VirtualFS = Record<string, VirtualFile>;

/** Per-test result from the runner */
export interface TestCaseResult {
  name: string;
  status: 'pass' | 'fail' | 'error';
  error?: string;
  durationMs?: number;
}

/** Structured run result with per-test granularity */
export interface EnhancedRunResult {
  status: 'success' | 'partial' | 'error';
  tests: TestCaseResult[];
  logs: string[];
  error?: string;
  durationMs: number;
  passed: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXT_LANGUAGE_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.html': 'html',
  '.css': 'css',
  '.json': 'json',
};

export function languageFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  return EXT_LANGUAGE_MAP[ext] ?? 'javascript';
}

// ---------------------------------------------------------------------------
// Default file sets
// ---------------------------------------------------------------------------

export function createDefaultFS(mode: 'backend' | 'frontend'): VirtualFS {
  if (mode === 'frontend') {
    return {
      '/index.html': {
        content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Challenge</title>\n  <link rel="stylesheet" href="./styles.css" />\n</head>\n<body>\n  <div id="app"></div>\n  <script src="./script.js"></script>\n</body>\n</html>\n',
        language: 'html',
      },
      '/styles.css': {
        content: '/* Write your styles here */\n\nbody {\n  margin: 0;\n  font-family: sans-serif;\n}\n',
        language: 'css',
      },
      '/script.js': {
        content: '// Write your JavaScript here\n',
        language: 'javascript',
      },
    };
  }

  return {
    '/solution.js': {
      content: 'export function solve() {\n  return null;\n}\n',
      language: 'javascript',
    },
  };
}

export function createDefaultTestFS(mode: 'backend' | 'frontend'): VirtualFS {
  if (mode === 'frontend') {
    return {
      '/tests.js': {
        content: "// DOM assertion tests\ntest('app container exists', () => {\n  const app = document.getElementById('app');\n  assert.ok(app, 'Expected #app element to exist');\n});\n",
        language: 'javascript',
      },
    };
  }

  return {
    '/solution.test.js': {
      content: "import { solve } from './solution';\n\ntest('returns null by default', () => {\n  assert.equal(solve(), null);\n});\n",
      language: 'javascript',
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy conversion
// ---------------------------------------------------------------------------

/** Convert legacy { starterCode, language } config to VirtualFS */
export function legacyToVFS(config: Record<string, unknown>): VirtualFS {
  if (config.files && typeof config.files === 'object') {
    return config.files as VirtualFS;
  }

  const code = typeof config.starterCode === 'string' ? config.starterCode : '';
  const lang = typeof config.language === 'string' ? config.language : 'javascript';
  const ext = lang === 'typescript' ? '.ts' : '.js';

  return {
    [`/solution${ext}`]: { content: code, language: lang },
  };
}

/** Convert legacy serverConfig { testCode, testLanguage } to VirtualFS */
export function legacyTestsToVFS(serverConfig: Record<string, unknown>): VirtualFS {
  if (serverConfig.hiddenTestFiles && typeof serverConfig.hiddenTestFiles === 'object') {
    return serverConfig.hiddenTestFiles as VirtualFS;
  }

  const code = typeof serverConfig.testCode === 'string' ? serverConfig.testCode : '';
  const lang = typeof serverConfig.testLanguage === 'string' ? serverConfig.testLanguage : 'javascript';
  const ext = lang === 'typescript' ? '.ts' : '.js';

  return {
    [`/solution.test${ext}`]: { content: code, language: lang },
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Extract only editable (non-readOnly) files — used for initial submission shape */
export function extractEditableFiles(fs: VirtualFS): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, file] of Object.entries(fs)) {
    if (!file.readOnly) {
      out[path] = file.content;
    }
  }
  return out;
}

/** Convert VirtualFS to Sandpack's file format */
export function fsToSandpackFiles(fs: VirtualFS): Record<string, { code: string; readOnly?: boolean }> {
  const out: Record<string, { code: string; readOnly?: boolean }> = {};
  for (const [path, file] of Object.entries(fs)) {
    const entry: { code: string; readOnly?: boolean } = { code: file.content };
    if (file.readOnly) entry.readOnly = true;
    out[path] = entry;
  }
  return out;
}

/** Merge candidate submission files back into VirtualFS (preserving metadata) */
export function mergeSubmissionIntoFS(
  baseFS: VirtualFS,
  submittedFiles: Record<string, string>,
): VirtualFS {
  const merged: VirtualFS = {};
  for (const [path, file] of Object.entries(baseFS)) {
    const submitted = submittedFiles[path];
    merged[path] = {
      ...file,
      content: submitted !== undefined ? submitted : file.content,
    };
  }
  return merged;
}
