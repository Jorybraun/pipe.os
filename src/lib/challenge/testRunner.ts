// ---------------------------------------------------------------------------
// testRunner — sandboxed JS test execution via Web Worker
// ---------------------------------------------------------------------------

export interface RunResult {
  status: 'success' | 'error';
  logs: string[];
  error?: string;
  durationMs?: number;
}

const WORKER_SOURCE = `
  function safeStringify(x) {
    try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
  }

  const assert = {
    ok: (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); },
    equal: (a, b, msg) => { if (a !== b) throw new Error(msg || ('Expected ' + safeStringify(a) + ' to equal ' + safeStringify(b))); },
    deepEqual: (a, b, msg) => {
      const aa = safeStringify(a);
      const bb = safeStringify(b);
      if (aa !== bb) throw new Error(msg || ('Expected ' + aa + ' to deepEqual ' + bb));
    },
  };

  self.onmessage = (e) => {
    const { starterCode, testCode } = e.data || {};
    const startedAt = Date.now();
    const logs = [];

    const consoleShim = {
      log: (...args) => logs.push(args.map(safeStringify).join(' ')),
      warn: (...args) => logs.push('[warn] ' + args.map(safeStringify).join(' ')),
      error: (...args) => logs.push('[error] ' + args.map(safeStringify).join(' ')),
    };

    try {
      const module = { exports: {} };
      const exports = module.exports;
      const run = (code, filename) => {
        const fn = new Function('module', 'exports', 'assert', 'console', 'globalThis', code + '\\n//# sourceURL=' + filename);
        fn(module, exports, assert, consoleShim, self);
      };

      const rewriteStarter = (code) => {
        const exportNames = [];
        let out = String(code || '');
        out = out.replace(/export\\s+default\\s+/g, '');
        out = out.replace(/export\\s+function\\s+([A-Za-z0-9_]+)\\s*\\(/g, (m, name) => {
          exportNames.push(name);
          return 'function ' + name + '(';
        });
        out = out.replace(/export\\s+(?:const|let|var)\\s+([A-Za-z0-9_]+)\\s*=/g, (m, name) => {
          exportNames.push(name);
          return m.replace(/^export\\s+/, '');
        });
        if (exportNames.length > 0) {
          out += '\\n' + exportNames.map((n) => 'module.exports.' + n + ' = ' + n + ';').join('\\n');
        }
        return out;
      };

      run(rewriteStarter(starterCode), 'starter.js');
      self.__exports = module.exports;

      const rewrittenTests = String(testCode || '')
        .replace(/import\\s+\\{([^}]+)\\}\\s+from\\s+['"]\\.\\/starter['"]\\s*;?/g, (m, names) => {
          return 'const {' + names.trim() + '} = globalThis.__exports;';
        })
        .replace(/import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+['"]\\.\\/starter['"]\\s*;?/g, (m, ns) => {
          return 'const ' + ns + ' = globalThis.__exports;';
        });

      run(rewrittenTests, 'tests.js');
      self.postMessage({ type: 'done', success: true, logs, durationMs: Date.now() - startedAt });
    } catch (err) {
      const message = (err && err.message) ? String(err.message) : String(err);
      const stack = (err && err.stack) ? String(err.stack) : undefined;
      self.postMessage({ type: 'done', success: false, logs, error: message, stack, durationMs: Date.now() - startedAt });
    }
  };
`;

const TIMEOUT_MS = 5000;

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
