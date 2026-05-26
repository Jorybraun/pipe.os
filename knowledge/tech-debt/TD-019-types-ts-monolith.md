# TD-019: types.ts Is a 1,489-Line God File

**Status:** 🔴 PENDING  
**Priority:** P3 — Low  
**Severity:** Slow imports, merge conflicts, cognitive overload  
**Estimated Effort:** 1 day  
**Owner:** Unassigned

---

## Problem

`workers/api/src/types.ts` is **1,489 lines**. It contains database row types, API request/response types, env bindings, Zod schemas, and utility types. Every file in the backend imports from it.

### Why This Is Bad

- **Import cost**: Even files that need one type import the entire 1,489-line module.
- **Merge conflicts**: Multiple features touching different types conflict in the same file.
- **Discoverability**: Finding a type requires scrolling or IDE search.

---

## Evidence

```bash
$ wc -l workers/api/src/types.ts
1489

$ grep -rn "from '../../types'\|from '../types'\|from './types'" workers/api/src --include="*.ts" | wc -l
89
```

89 files import from `types.ts`.

---

## Solution

### Step 1: Split into Module Files

```
types/
├── index.ts          # Re-exports everything for backward compatibility
├── db.ts             # All *Row types, D1 schemas
├── api.ts            # Request/response DTOs
├── env.ts            # Env bindings, provider config
├── agents.ts         # Agent-specific types (RoleContextDocument, ScoreReport, etc.)
└── utils.ts          # Shared utility types (Nullable, DeepPartial, etc.)
```

### Step 2: Update Imports Gradually

Keep `types/index.ts` as a re-export barrel for backward compatibility:
```ts
// types/index.ts
export * from './db';
export * from './api';
export * from './env';
export * from './agents';
export * from './utils';
```

New code imports from sub-modules:
```ts
import type { PipelineRow } from '../types/db';
```

Old code continues to work:
```ts
import type { PipelineRow } from '../types';
```

### Step 3: Migrate Over Time

Update one import path per PR. No big-bang refactor needed.

---

## Acceptance Criteria

- [ ] `types.ts` is deleted or reduced to a re-export barrel.
- [ ] No single file in `types/` exceeds 400 lines.
- [ ] All existing imports continue to work (backward compatibility).
- [ ] New code uses sub-module imports.

## Related

- TD-010 (fragmented row types) — row types move to `types/db.ts`.
