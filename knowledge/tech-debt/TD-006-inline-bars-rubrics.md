# TD-006: Inline BARS Rubrics Bloat cultureScorer.ts

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** 600+ lines of unmaintainable inline text; product tuning requires code deploy  
**Estimated Effort:** 2 days  
**Owner:** Unassigned

---

## Problem

`lib/cultureScorer.ts` is **1,086 lines**. Approximately **600 lines** are inline BARS (Behaviorally Anchored Rating Scale) rubric text — prose descriptions of what a score of 1–5 looks like for each culture dimension.

The file itself has TODOs acknowledging the problem:
```ts
// TODO (Phase C): Replace inline constants with wiki-sync output from
// TODO (Phase C): Sync from `knowledge/culture/dimensions/profiles/*.md`.
```

### Why This Is Bad

- **File size**: The scorer cannot be reviewed or loaded efficiently.
- **Product iteration**: Changing a rubric requires a code change, PR, review, and deploy.
- **Drift**: The `knowledge/culture/dimensions/profiles/*.md` files likely contain the same content but are never synced to code.
- **Localization**: Inline English text makes i18n impossible.

---

## Evidence

```bash
$ wc -l workers/api/src/lib/cultureScorer.ts
1086

$ grep -n "TODO (Phase C)" workers/api/src/lib/cultureScorer.ts
186: // TODO (Phase C): Replace inline constants with wiki-sync output from
308: // TODO (Phase C): Sync from `knowledge/culture/dimensions/profiles/*.md`.
```

Example inline rubric:
```ts
const DIMENSION_RUBRICS: Record<string, DimensionRubric> = {
  ownership: {
    name: 'Ownership',
    description: '...',
    anchors: {
      1: 'Blames others or circumstances when things go wrong.',
      2: 'Acknowledges mistakes but frames them as unavoidable.',
      3: 'Takes responsibility for outcomes within their control.',
      4: 'Proactively addresses issues before they escalate.',
      5: 'Demonstrates extreme ownership — takes responsibility for systemic issues even outside direct control.',
    },
  },
  // ... 10+ more dimensions
};
```

---

## Solution

### Option A: JSON Data Files (Recommended)

Move rubrics to `data/culture-rubrics.json` or `content/culture-rubrics/`:

```json
{
  "ownership": {
    "name": "Ownership",
    "description": "...",
    "anchors": {
      "1": "Blames others or circumstances when things go wrong.",
      "2": "Acknowledges mistakes but frames them as unavoidable.",
      "3": "Takes responsibility for outcomes within their control.",
      "4": "Proactively addresses issues before they escalate.",
      "5": "Demonstrates extreme ownership..."
    }
  }
}
```

Load at runtime:
```ts
import rubrics from '../../../content/culture-rubrics.json';

export function getRubric(dimension: string): DimensionRubric | undefined {
  return rubrics[dimension];
}
```

### Option B: Wiki Sync Pipeline

Create a build step that syncs `knowledge/culture/dimensions/profiles/*.md` into a JSON file consumed by the worker.

```bash
# scripts/sync-culture-rubrics.ts
# Reads markdown files, extracts rubric tables, writes culture-rubrics.json
```

Run in CI:
```yaml
- name: Sync culture rubrics
  run: npx tsx scripts/sync-culture-rubrics.ts
```

### Option C: Database-Driven Rubrics

Store rubrics in D1. Admins can edit them via a UI. The worker caches them in memory.

```sql
CREATE TABLE culture_rubrics (
  dimension TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  anchors_json TEXT NOT NULL
);
```

**Recommended**: Start with Option A (JSON file), migrate to Option C when admin editing is needed.

---

## Acceptance Criteria

- [ ] `cultureScorer.ts` is under 500 lines.
- [ ] All rubric text lives outside the source file.
- [ ] Rubric data is typed via Zod schema.
- [ ] Changing a rubric does not require a code deploy (if using DB) or requires only a data file change (if using JSON).

## Related

- TD-009 (hardcoded thresholds) — BARS bands (75/45/0) should also be config-driven.
- TD-001 (god route files) — cultureScorer is a lib file, not a route, but same principle applies.
