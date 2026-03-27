// ---------------------------------------------------------------------------
// codeExecutor — server-side code execution for CODE_IMPLEMENTATION scoring
//
// Backend mode: node:vm (V8 sandbox in Lambda)
// Frontend mode: jsdom (DOM simulation in Lambda)
// ---------------------------------------------------------------------------

import { createContext, Script, type Context } from 'node:vm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestCaseResult {
  name: string;
  status: 'pass' | 'fail' | 'error';
  error?: string;
  durationMs?: number;
}

export interface ExecutionResult {
  tests: TestCaseResult[];
  logs: string[];
  error?: string;
  durationMs: number;
}

interface VirtualFileServer {
  content: string;
  language: string;
}

type VirtualFSServer = Record<string, VirtualFileServer>;

// ---------------------------------------------------------------------------
// Shared test framework (injected into sandbox)
// ---------------------------------------------------------------------------

const TEST_FRAMEWORK = `
  var __tests = [];
  var __describePrefix = '';
  var __logs = [];

  function safeStringify(x) {
    try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
  }

  var assert = {
    ok: function(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); },
    equal: function(a, b, msg) {
      if (a !== b) throw new Error(msg || 'Expected ' + safeStringify(a) + ' to equal ' + safeStringify(b));
    },
    notEqual: function(a, b, msg) {
      if (a === b) throw new Error(msg || 'Expected ' + safeStringify(a) + ' to NOT equal ' + safeStringify(b));
    },
    deepEqual: function(a, b, msg) {
      var aa = safeStringify(a);
      var bb = safeStringify(b);
      if (aa !== bb) throw new Error(msg || 'Expected ' + aa + ' to deepEqual ' + bb);
    },
    throws: function(fn, msg) {
      var threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (!threw) throw new Error(msg || 'Expected function to throw');
    },
  };

  function test(name, fn) {
    var fullName = __describePrefix ? __describePrefix + ' > ' + name : name;
    __tests.push({ name: fullName, fn: fn });
  }

  var it = test;

  function describe(name, fn) {
    var prev = __describePrefix;
    __describePrefix = prev ? prev + ' > ' + name : name;
    try { fn(); } finally { __describePrefix = prev; }
  }

  var console = {
    log: function() { var args = Array.prototype.slice.call(arguments); __logs.push(args.map(safeStringify).join(' ')); },
    warn: function() { var args = Array.prototype.slice.call(arguments); __logs.push('[warn] ' + args.map(safeStringify).join(' ')); },
    error: function() { var args = Array.prototype.slice.call(arguments); __logs.push('[error] ' + args.map(safeStringify).join(' ')); },
    info: function() { var args = Array.prototype.slice.call(arguments); __logs.push('[info] ' + args.map(safeStringify).join(' ')); },
  };
`;

// ---------------------------------------------------------------------------
// Module resolution helpers
// ---------------------------------------------------------------------------

function rewriteExports(code: string): string {
  const exportNames: string[] = [];
  let out = code;
  out = out.replace(/export\s+default\s+/g, '');
  out = out.replace(/export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, (_m, name) => {
    exportNames.push(name);
    return `function ${name}(`;
  });
  out = out.replace(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g, (m, name) => {
    exportNames.push(name);
    return m.replace(/^export\s+/, '');
  });
  out = out.replace(/export\s+class\s+([A-Za-z0-9_$]+)/g, (_m, name) => {
    exportNames.push(name);
    return `class ${name}`;
  });
  if (exportNames.length > 0) {
    out += '\n' + exportNames.map(n => `module.exports.${n} = ${n};`).join('\n');
  }
  return out;
}

function rewriteImports(code: string): string {
  let out = code;
  out = out.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g, (_m, names, path) => {
    return `var {${names.trim()}} = __require("${path}");`;
  });
  out = out.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/g, (_m, ns, path) => {
    return `var ${ns} = __require("${path}");`;
  });
  out = out.replace(/import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]+)['"]\s*;?/g, (_m, name, path) => {
    return `var ${name} = __require("${path}").default || __require("${path}");`;
  });
  return out;
}

function normalizePath(p: string): string {
  let path = p;
  if (!path.startsWith('/') && !path.startsWith('./')) path = './' + path;
  return path;
}

function findFileKey(requested: string, allFiles: Record<string, string>): string | null {
  const normalized = normalizePath(requested);
  for (const key of Object.keys(allFiles)) {
    if (normalizePath(key) === normalized) return key;
  }
  const exts = ['.js', '.ts', '.mjs'];
  for (const ext of exts) {
    for (const key of Object.keys(allFiles)) {
      if (normalizePath(key) === normalized + ext) return key;
    }
  }
  // Legacy compat
  if (normalized === './starter' || normalized === '/starter') {
    const sourceKeys = Object.keys(allFiles).filter(k => !k.includes('.test.'));
    if (sourceKeys.length > 0) return sourceKeys[0]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Backend execution (node:vm)
// ---------------------------------------------------------------------------

export async function executeBackendTests(
  candidateFiles: Record<string, string>,
  testFiles: Record<string, string>,
  timeoutMs: number = 10000,
): Promise<ExecutionResult> {
  const startedAt = Date.now();

  try {
    // Create sandbox context
    const sandbox: Record<string, unknown> = {};
    const context: Context = createContext(sandbox);

    // Inject test framework
    new Script(TEST_FRAMEWORK, { filename: '__framework.js' }).runInContext(context, { timeout: 2000 });

    // Build module cache + require function
    const allFiles = { ...candidateFiles, ...testFiles };
    const moduleCache: Record<string, { exports: Record<string, unknown> }> = {};

    const requireScript = new Script(`
      var __moduleCache = {};
      var __allFiles = ${JSON.stringify(allFiles)};

      function __require(requested) {
        var normalized = requested;
        if (normalized.charAt(0) !== '/' && normalized.substring(0,2) !== './') normalized = './' + normalized;

        // Find file key
        var foundKey = null;
        var keys = Object.keys(__allFiles);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var nk = k.charAt(0) !== '/' && k.substring(0,2) !== './' ? './' + k : k;
          if (nk === normalized) { foundKey = k; break; }
        }
        if (!foundKey) {
          var exts = ['.js', '.ts', '.mjs'];
          for (var e = 0; e < exts.length; e++) {
            for (var j = 0; j < keys.length; j++) {
              var k2 = keys[j];
              var nk2 = k2.charAt(0) !== '/' && k2.substring(0,2) !== './' ? './' + k2 : k2;
              if (nk2 === normalized + exts[e]) { foundKey = k2; break; }
            }
            if (foundKey) break;
          }
        }
        // Legacy ./starter compat
        if (!foundKey && (normalized === './starter' || normalized === '/starter')) {
          var sourceKeys = keys.filter(function(k) { return k.indexOf('.test.') === -1; });
          if (sourceKeys.length > 0) foundKey = sourceKeys[0];
        }

        if (!foundKey) throw new Error('Module not found: ' + requested);
        if (__moduleCache[foundKey]) return __moduleCache[foundKey].exports;

        var mod = { exports: {} };
        __moduleCache[foundKey] = mod;

        var code = __allFiles[foundKey];
        ${/* Inline rewriting is complex in stringified code, so we pre-rewrite */ ''}
        var fn = new Function('module', 'exports', 'require', 'assert', 'console', 'test', 'it', 'describe',
          code + '\\n//# sourceURL=' + foundKey
        );
        fn(mod, mod.exports, __require, assert, console, test, it, describe);

        return mod.exports;
      }
    `, { filename: '__require.js' });
    requireScript.runInContext(context, { timeout: 2000 });

    // Pre-rewrite all files for module system
    const rewrittenFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(allFiles)) {
      rewrittenFiles[path] = rewriteImports(rewriteExports(content));
    }

    // Override __allFiles with rewritten versions
    new Script(`__allFiles = ${JSON.stringify(rewrittenFiles)};`).runInContext(context, { timeout: 1000 });

    // Load candidate files first
    for (const path of Object.keys(candidateFiles)) {
      new Script(`__require(${JSON.stringify(path)});`, { filename: `load:${path}` })
        .runInContext(context, { timeout: timeoutMs });
    }

    // Load test files (registers test() calls)
    for (const path of Object.keys(testFiles)) {
      new Script(`delete __moduleCache[${JSON.stringify(path)}]; __require(${JSON.stringify(path)});`, { filename: `test:${path}` })
        .runInContext(context, { timeout: timeoutMs });
    }

    // Execute collected tests
    const runTestsScript = new Script(`
      var __results = [];
      for (var i = 0; i < __tests.length; i++) {
        var t = __tests[i];
        var startMs = Date.now();
        try {
          t.fn();
          __results.push({ name: t.name, status: 'pass', durationMs: Date.now() - startMs });
        } catch (err) {
          var msg = (err && err.message) ? String(err.message) : String(err);
          __results.push({ name: t.name, status: 'fail', error: msg, durationMs: Date.now() - startMs });
        }
      }
      __results;
    `, { filename: '__run_tests.js' });

    const results = runTestsScript.runInContext(context, { timeout: timeoutMs }) as TestCaseResult[];
    const logs = (sandbox['__logs'] as string[]) ?? [];

    return {
      tests: results,
      logs,
      durationMs: Date.now() - startedAt,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      tests: [{ name: 'execution', status: 'error', error: message }],
      logs: [],
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Frontend execution (jsdom — optional, requires jsdom dep)
// ---------------------------------------------------------------------------

export async function executeFrontendTests(
  candidateFiles: Record<string, string>,
  testFiles: Record<string, string>,
  timeoutMs: number = 10000,
): Promise<ExecutionResult> {
  const startedAt = Date.now();

  try {
    // Dynamic import — jsdom may not be installed in all environments
    const { JSDOM } = await import('jsdom');

    // Find the HTML file
    const htmlKey = Object.keys(candidateFiles).find(k => k.endsWith('.html'));
    const htmlContent = htmlKey ? candidateFiles[htmlKey] : '<html><body><div id="app"></div></body></html>';

    // Find CSS files
    const cssContent = Object.entries(candidateFiles)
      .filter(([k]) => k.endsWith('.css'))
      .map(([, v]) => v)
      .join('\n');

    // Find JS files (non-test, non-html, non-css)
    const jsFiles = Object.entries(candidateFiles)
      .filter(([k]) => !k.endsWith('.html') && !k.endsWith('.css'))
      .map(([, v]) => v);

    // Build full HTML with inline CSS + JS
    let fullHtml = htmlContent;
    if (cssContent) {
      fullHtml = fullHtml.replace('</head>', `<style>${cssContent}</style></head>`);
    }
    // JS will be injected into the JSDOM vm context instead of <script> tags

    const dom = new JSDOM(fullHtml, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });

    const vmContext = dom.getInternalVMContext();

    // Inject test framework
    new Script(TEST_FRAMEWORK, { filename: '__framework.js' }).runInContext(vmContext, { timeout: 2000 });

    // Run candidate JS
    for (const js of jsFiles) {
      new Script(js, { filename: 'candidate.js' }).runInContext(vmContext, { timeout: timeoutMs });
    }

    // Run test files
    for (const [path, content] of Object.entries(testFiles)) {
      const rewritten = rewriteImports(rewriteExports(content));
      new Script(rewritten, { filename: path }).runInContext(vmContext, { timeout: timeoutMs });
    }

    // Execute collected tests
    const runTestsScript = new Script(`
      var __results = [];
      for (var i = 0; i < __tests.length; i++) {
        var t = __tests[i];
        var startMs = Date.now();
        try {
          t.fn();
          __results.push({ name: t.name, status: 'pass', durationMs: Date.now() - startMs });
        } catch (err) {
          var msg = (err && err.message) ? String(err.message) : String(err);
          __results.push({ name: t.name, status: 'fail', error: msg, durationMs: Date.now() - startMs });
        }
      }
      __results;
    `, { filename: '__run_tests.js' });

    const results = runTestsScript.runInContext(vmContext, { timeout: timeoutMs }) as TestCaseResult[];
    const logs = (vmContext['__logs'] ?? []) as string[];

    dom.window.close();

    return {
      tests: results,
      logs,
      durationMs: Date.now() - startedAt,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      tests: [{ name: 'execution', status: 'error', error: message }],
      logs: [],
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Unified executor
// ---------------------------------------------------------------------------

export async function executeCodeChallenge(
  mode: 'backend' | 'frontend',
  candidateFiles: Record<string, string>,
  testFiles: Record<string, string>,
  timeoutMs?: number,
): Promise<ExecutionResult> {
  if (mode === 'frontend') {
    return executeFrontendTests(candidateFiles, testFiles, timeoutMs);
  }
  return executeBackendTests(candidateFiles, testFiles, timeoutMs);
}
