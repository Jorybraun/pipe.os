# TD-014: roleAgentPrompts.ts Migration Never Completed

**Status:** 🔴 PENDING  
**Priority:** P2 — Medium  
**Severity:** Two sources of truth for role agent prompts  
**Estimated Effort:** 4–6 hours  
**Owner:** Unassigned

---

## Problem

`lib/roleAgentPrompts.ts` has an explicit TODO:
```ts
/**
 * TODO: Migrate direct consumers to import from agents/roleDiscovery/prompts
 */
```

There are now **two prompt files** for role discovery:
1. `lib/roleAgentPrompts.ts` (legacy, still imported by some consumers)
2. `lib/agents/roleDiscovery/prompts.ts` (new canonical source)

### Why This Is Bad

- A prompt change made in one file is invisible to consumers of the other.
- New developers don't know which file to edit.
- The legacy file may contain stale prompts that produce inconsistent RCD quality.

---

## Evidence

```bash
$ grep -rn "roleAgentPrompts" workers/api/src --include="*.ts" | grep -v "__tests__" | grep -v "\.test\.ts"
lib/roleAgentPrompts.ts:1
routes/discovery/roleContexts.ts:30
lib/roleAgent.ts:10

$ grep -rn "agents/roleDiscovery/prompts" workers/api/src --include="*.ts" | grep -v "__tests__" | grep -v "\.test\.ts"
routes/discovery/roleContexts.ts:31
lib/agents/roleDiscovery/prompts.ts:1
```

Both `roleContexts.ts` and `roleAgent.ts` import from the legacy file.

---

## Solution

### Step 1: Compare Prompts

Diff the two files to identify divergences. Decide which version is authoritative for each prompt.

### Step 2: Merge into Canonical File

Move all unique prompt content from `lib/roleAgentPrompts.ts` into `lib/agents/roleDiscovery/prompts.ts`.

### Step 3: Update All Imports

Replace:
```ts
import { buildSystemPrompt, buildBatchSystemPrompt } from '../../lib/roleAgentPrompts';
```

With:
```ts
import { buildSystemPrompt, buildBatchSystemPrompt } from '../../lib/agents/roleDiscovery/prompts';
```

### Step 4: Delete Legacy File

```bash
rm workers/api/src/lib/roleAgentPrompts.ts
```

### Step 5: Update CHANGELOG

Document the breaking change for any external consumers.

---

## Acceptance Criteria

- [ ] `lib/roleAgentPrompts.ts` is deleted.
- [ ] Zero imports reference `lib/roleAgentPrompts`.
- [ ] All prompt content from the legacy file is preserved in the canonical file.
- [ ] Tests pass without modification (prompt output should be identical).

## Related

- TD-001 (god route files) — `roleContexts.ts` imports both prompt files.
