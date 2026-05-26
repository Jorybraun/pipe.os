# TD-005: console.* Logging Instead of Structured Logger

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Unsearchable logs, no log levels, no request correlation  
**Estimated Effort:** 2 days  
**Owner:** Unassigned

---

## Problem

There are **455 `console.log` / `console.warn` / `console.error` calls** across the backend. In Cloudflare Workers, these emit unstructured text to the edge log stream. There is no:
- Log level filtering
- Request ID correlation
- JSON formatting for log aggregation
- Redaction of PII

### Why This Is Bad

- **Debugging**: Finding an error for a specific candidate requires grepping through thousands of lines.
- **Compliance**: PII (emails, names, resume content) may be logged to third-party log sinks.
- **Observability**: Cannot build dashboards or alerts from unstructured text.
- **Cost**: Verbose logs increase log volume and retention costs.

---

## Evidence

```bash
$ grep -rn "console\." workers/api/src --include="*.ts" | grep -v "__tests__" | grep -v "\.test\.ts" | wc -l
455
```

Examples:
```ts
// rpc.ts:917
console.log(`[rpc/intake] queued resume ingestion for candidate ${candidateId}`);

// culture.ts:200
console.error('[cultureScoringJob] Scoring pipeline failed:', sessionId, err);

// email.ts:110
console.log('[email] /users/me response:', { status: userRes.status });
```

---

## Solution

### Step 1: Create a Logger Module

Create `lib/logger.ts`:

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  candidateId?: string;
  roleContextId?: string;
  sessionId?: string;
  userId?: string;
  [key: string]: unknown;
}

class Logger {
  constructor(private env: Env) {}

  private log(level: LogLevel, message: string, context?: LogContext, error?: unknown) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...(error instanceof Error ? { error: error.message, stack: error.stack } : {}),
    };

    if (this.env.LOG_FORMAT === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      const ctx = context ? ` ${JSON.stringify(context)}` : '';
      const err = error instanceof Error ? ` | ${error.message}` : '';
      console.log(`[${level}] ${message}${ctx}${err}`);
    }
  }

  debug(msg: string, ctx?: LogContext) { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: LogContext) { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: LogContext, err?: unknown) { this.log('warn', msg, ctx, err); }
  error(msg: string, ctx?: LogContext, err?: unknown) { this.log('error', msg, ctx, err); }
}

export function createLogger(env: Env): Logger {
  return new Logger(env);
}
```

### Step 2: Add Logger to Hono Context

In `src/index.ts`:
```ts
app.use('*', async (c, next) => {
  c.set('logger', createLogger(c.env));
  await next();
});
```

### Step 3: Replace All console.* Calls

Before:
```ts
console.error('[cultureScoringJob] Scoring pipeline failed:', sessionId, err);
```

After:
```ts
c.var.logger.error('Scoring pipeline failed', { sessionId }, err);
```

### Step 4: Redact PII

Add a redaction layer:
```ts
const SENSITIVE_KEYS = ['email', 'phone', 'resumeText', 'linkedinUrl'];

function redact(context: LogContext): LogContext {
  const copy = { ...context };
  for (const key of SENSITIVE_KEYS) {
    if (typeof copy[key] === 'string') {
      copy[key] = '[REDACTED]';
    }
  }
  return copy;
}
```

### Step 5: Add Log Level Control

Respect `env.LOG_LEVEL` (default `info` in production, `debug` in dev).

---

## Acceptance Criteria

- [ ] `lib/logger.ts` exists with debug/info/warn/error methods.
- [ ] Logger is available on Hono context via `c.var.logger`.
- [ ] Zero `console.*` calls in production code (tests may still use `console.log`).
- [ ] PII fields are redacted automatically.
- [ ] Log level respects `env.LOG_LEVEL`.

## Related

- TD-004 (unvalidated JSON.parse) — parse failures should use structured logger.
- TD-001 (god route files) — splitting routes first makes logger migration easier.
