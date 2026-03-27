// ---------------------------------------------------------------------------
// testRunner — sandboxed JS test execution via Web Worker
// Supports: multi-file VirtualFS, named test() / describe() framework,
// structured TestCaseResult[] output, backward-compatible legacy API.
// ---------------------------------------------------------------------------

import type { VirtualFS, EnhancedRunResult, TestCaseResult } from './virtualFS';

/** Legacy run result shape (backward compat) */
export interface RunResult {
  status: 'success' | 'error';
  logs: string[];
  error?: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Web Worker source — runs in an isolated thread
// ---------------------------------------------------------------------------

const WORKER_SOURCE = `
  // ── Utilities ──────────────────────────────────────────────────────────────
  function safeStringify(x) {
    try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
  }

  // ── Assert API ─────────────────────────────────────────────────────────────
  const assert = {
    ok: (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); },
    equal: (a, b, msg) => {
      if (a !== b) throw new Error(msg || ('Expected ' + safeStringify(a) + ' to equal ' + safeStringify(b)));
    },
    notEqual: (a, b, msg) => {
      if (a === b) throw new Error(msg || ('Expected ' + safeStringify(a) + ' to NOT equal ' + safeStringify(b)));
    },
    deepEqual: (a, b, msg) => {
      const aa = safeStringify(a);
      const bb = safeStringify(b);
      if (aa !== bb) throw new Error(msg || ('Expected ' + aa + ' to deepEqual ' + bb));
    },
    throws: (fn, msg) => {
      let threw = false;
      try { fn(); } catch { threw = true; }
      if (!threw) throw new Error(msg || 'Expected function to throw');
    },
  };

  // ── Named test framework ──────────────────────────────────────────────────
  const __tests = [];
  let __describePrefix = '';
  let __bareAssertCount = 0;

  function test(name, fn) {
    __tests.push({ name: __describePrefix ? __describePrefix + ' > ' + name : name, fn });
  }

  // Alias
  function it(name, fn) { test(name, fn); }

  function describe(name, fn) {
    const prev = __describePrefix;
    __describePrefix = prev ? prev + ' > ' + name : name;
    try { fn(); } finally { __describePrefix = prev; }
  }

  // Proxy assert to count bare assertions (outside test() blocks)
  const trackingAssert = new Proxy(assert, {
    get(target, prop) {
      const orig = target[prop];
      if (typeof orig !== 'function') return orig;
      return function(...args) {
        __bareAssertCount++;
        return orig.apply(target, args);
      };
    }
  });

  // ── Module resolution ─────────────────────────────────────────────────────
  function rewriteExports(code) {
    const exportNames = [];
    let out = String(code || '');
    out = out.replace(/export\\s+default\\s+/g, '');
    out = out.replace(/export\\s+function\\s+([A-Za-z0-9_$]+)\\s*\\(/g, (m, name) => {
      exportNames.push(name);
      return 'function ' + name + '(';
    });
    out = out.replace(/export\\s+(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=/g, (m, name) => {
      exportNames.push(name);
      return m.replace(/^export\\s+/, '');
    });
    out = out.replace(/export\\s+class\\s+([A-Za-z0-9_$]+)/g, (m, name) => {
      exportNames.push(name);
      return 'class ' + name;
    });
    if (exportNames.length > 0) {
      out += '\\n' + exportNames.map(n => 'module.exports.' + n + ' = ' + n + ';').join('\\n');
    }
    return out;
  }

  function rewriteImports(code, resolvedModules) {
    let out = String(code || '');
    // import { foo, bar } from './path'
    out = out.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s+['"](\\.[^'"]+)['"]\\s*;?/g, (m, names, path) => {
      return 'const {' + names.trim() + '} = __require("' + path + '");';
    });
    // import * as ns from './path'
    out = out.replace(/import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+['"](\\.[^'"]+)['"]\\s*;?/g, (m, ns, path) => {
      return 'const ' + ns + ' = __require("' + path + '");';
    });
    // import defaultExport from './path'
    out = out.replace(/import\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s+from\\s+['"](\\.[^'"]+)['"]\\s*;?/g, (m, name, path) => {
      return 'const ' + name + ' = __require("' + path + '").default || __require("' + path + '");';
    });
    return out;
  }

  // ── Main handler ──────────────────────────────────────────────────────────
  self.onmessage = (e) => {
    const { files, testFiles, starterCode, testCode } = e.data || {};
    const startedAt = Date.now();
    const logs = [];

    const consoleShim = {
      log: (...args) => logs.push(args.map(safeStringify).join(' ')),
      warn: (...args) => logs.push('[warn] ' + args.map(safeStringify).join(' ')),
      error: (...args) => logs.push('[error] ' + args.map(safeStringify).join(' ')),
      info: (...args) => logs.push('[info] ' + args.map(safeStringify).join(' ')),
    };

    // ── Build module registry ────────────────────────────────────────────
    const __moduleCache = {};

    function normalizePath(p) {
      let path = String(p);
      if (!path.startsWith('/') && !path.startsWith('./')) path = './' + path;
      // Resolve ./solution -> try ./solution.js, ./solution.ts, etc.
      return path;
    }

    function findFile(requestedPath, allFiles) {
      const normalized = normalizePath(requestedPath);
      // Direct match
      for (const key of Object.keys(allFiles)) {
        const normalizedKey = normalizePath(key);
        if (normalizedKey === normalized) return key;
      }
      // Try adding extensions
      const exts = ['.js', '.ts', '.mjs'];
      for (const ext of exts) {
        for (const key of Object.keys(allFiles)) {
          const normalizedKey = normalizePath(key);
          if (normalizedKey === normalized + ext) return key;
        }
      }
      // Legacy compat: ./starter -> first source file
      if (normalized === './starter' || normalized === '/starter') {
        const sourceKeys = Object.keys(allFiles).filter(k => !k.includes('.test.'));
        if (sourceKeys.length > 0) return sourceKeys[0];
      }
      return null;
    }

    try {
      // Determine mode: VirtualFS (new) or legacy (starterCode + testCode)
      const isLegacy = !files && typeof starterCode === 'string';
      let allSourceFiles = {};
      let allTestFiles = {};

      if (isLegacy) {
        allSourceFiles = { '/starter.js': starterCode };
        allTestFiles = { '/tests.js': testCode || '' };
      } else {
        // Extract content strings from VirtualFile objects
        for (const [path, file] of Object.entries(files || {})) {
          const content = typeof file === 'object' && file !== null ? file.content : file;
          allSourceFiles[path] = String(content || '');
        }
        for (const [path, file] of Object.entries(testFiles || {})) {
          const content = typeof file === 'object' && file !== null ? file.content : file;
          allTestFiles[path] = String(content || '');
        }
      }

      const allFiles = { ...allSourceFiles, ...allTestFiles };

      function __require(requestedPath) {
        const resolvedKey = findFile(requestedPath, allFiles);
        if (!resolvedKey) throw new Error('Module not found: ' + requestedPath);
        if (__moduleCache[resolvedKey]) return __moduleCache[resolvedKey].exports;

        const mod = { exports: {} };
        __moduleCache[resolvedKey] = mod;

        let code = allFiles[resolvedKey];
        code = rewriteExports(code);
        code = rewriteImports(code);

        const fn = new Function(
          'module', 'exports', 'require', '__require', 'assert', 'console',
          'test', 'it', 'describe',
          code + '\\n//# sourceURL=' + resolvedKey
        );
        fn(mod, mod.exports, __require, __require, trackingAssert, consoleShim,
           test, it, describe);

        return mod.exports;
      }

      // Make __require available globally for rewritten imports
      self.__require = __require;

      // ── Load source files ─────────────────────────────────────────────
      for (const path of Object.keys(allSourceFiles)) {
        __require(path);
      }

      // ── Load test files (registers test() calls) ──────────────────────
      __bareAssertCount = 0;
      for (const path of Object.keys(allTestFiles)) {
        // Clear cache for test files so they always run fresh
        delete __moduleCache[path];
        __require(path);
      }

      // ── Execute named tests ───────────────────────────────────────────
      const results = [];

      if (__tests.length > 0) {
        for (const t of __tests) {
          const testStart = Date.now();
          try {
            t.fn();
            results.push({ name: t.name, status: 'pass', durationMs: Date.now() - testStart });
          } catch (err) {
            const msg = (err && err.message) ? String(err.message) : String(err);
            results.push({ name: t.name, status: 'fail', error: msg, durationMs: Date.now() - testStart });
          }
        }
      } else if (__bareAssertCount > 0) {
        // Legacy mode: all bare assertions passed (they throw on failure)
        results.push({ name: 'assertions', status: 'pass', durationMs: Date.now() - startedAt });
      }

      const passed = results.filter(r => r.status === 'pass').length;
      const total = results.length;
      const allPassed = total > 0 && passed === total;

      self.postMessage({
        type: 'done',
        success: allPassed,
        tests: results,
        logs,
        passed,
        total,
        durationMs: Date.now() - startedAt,
      });

    } catch (err) {
      const message = (err && err.message) ? String(err.message) : String(err);
      const stack = (err && err.stack) ? String(err.stack) : undefined;
      self.postMessage({
        type: 'done',
        success: false,
        tests: [{ name: 'execution', status: 'error', error: message }],
        logs,
        error: message,
        stack,
        passed: 0,
        total: 0,
        durationMs: Date.now() - startedAt,
      });
    }
  };
`;

const TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// New API — multi-file, structured results
// ---------------------------------------------------------------------------

export function runTestsVFS(
  files: VirtualFS,
  testFiles: VirtualFS,
  language: string,
): Promise<EnhancedRunResult> {
  if (language !== 'javascript' && language !== 'typescript') {
    return Promise.resolve({
      status: 'error',
      tests: [],
      logs: [],
      error: `Runner supports JavaScript only. Got "${language}".`,
      durationMs: 0,
      passed: 0,
      total: 0,
    });
  }

  return new Promise((resolve) => {
    const blob = new Blob([WORKER_SOURCE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const timeout = window.setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({
        status: 'error',
        tests: [{ name: 'timeout', status: 'error', error: `Timeout after ${TIMEOUT_MS}ms (possible infinite loop).` }],
        logs: [],
        error: `Timeout after ${TIMEOUT_MS}ms (possible infinite loop).`,
        durationMs: TIMEOUT_MS,
        passed: 0,
        total: 0,
      });
    }, TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent) => {
      if (!e?.data || e.data.type !== 'done') return;
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);

      const payload = e.data as {
        success: boolean;
        tests?: TestCaseResult[];
        logs?: string[];
        error?: string;
        passed?: number;
        total?: number;
        durationMs?: number;
      };

      const tests = Array.isArray(payload.tests) ? payload.tests : [];
      const passed = typeof payload.passed === 'number' ? payload.passed : tests.filter(t => t.status === 'pass').length;
      const total = typeof payload.total === 'number' ? payload.total : tests.length;

      let status: EnhancedRunResult['status'];
      if (payload.success) status = 'success';
      else if (passed > 0) status = 'partial';
      else status = 'error';

      resolve({
        status,
        tests,
        logs: Array.isArray(payload.logs) ? payload.logs : [],
        ...(payload.error ? { error: payload.error } : {}),
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
        passed,
        total,
      });
    };

    worker.onerror = (err: ErrorEvent) => {
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({
        status: 'error',
        tests: [{ name: 'worker', status: 'error', error: err?.message || 'Worker error' }],
        logs: [],
        error: err?.message || 'Worker error',
        durationMs: 0,
        passed: 0,
        total: 0,
      });
    };

    worker.postMessage({ files, testFiles });
  });
}

// ---------------------------------------------------------------------------
// Legacy API — backward compatible, delegates to new worker
// ---------------------------------------------------------------------------

export function runTests(
  starterCode: string,
  testCode: string,
  testLanguage: string,
): Promise<RunResult> {
  if (testLanguage !== 'javascript') {
    return Promise.resolve({
      status: 'error',
      logs: [],
      error: 'Runner currently supports JavaScript only. Set TESTS language to JAVASCRIPT to run.',
    });
  }

  return new Promise((resolve) => {
    const blob = new Blob([WORKER_SOURCE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const timeout = window.setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ status: 'error', logs: [], error: `Timeout after ${TIMEOUT_MS}ms (possible infinite loop).` });
    }, TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent) => {
      if (!e?.data || e.data.type !== 'done') return;
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);

      const payload = e.data as {
        success: boolean;
        logs?: string[];
        error?: string;
        durationMs?: number;
      };

      resolve({
        status: payload.success ? 'success' : 'error',
        logs: Array.isArray(payload.logs) ? payload.logs : [],
        ...(payload.error ? { error: payload.error } : {}),
        ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
      });
    };

    worker.onerror = (err: ErrorEvent) => {
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ status: 'error', logs: [], error: err?.message || 'Worker error' });
    };

    worker.postMessage({ starterCode, testCode });
  });
}
