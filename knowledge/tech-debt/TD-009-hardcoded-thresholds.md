# TD-009: Hardcoded Thresholds and Magic Numbers

**Status:** 🔴 PENDING  
**Priority:** P1 — High  
**Severity:** Product tuning requires code changes and redeploys  
**Estimated Effort:** 2–3 days  
**Owner:** Unassigned

---

## Problem

Dozens of business-critical thresholds are hardcoded as literal numbers across the backend. Changing any of them requires a code edit, PR, review, and deployment.

### Critical Hardcoded Values

| Value | Location | What It Controls |
|-------|----------|----------------|
| `0.6` | `match/autoStageBuilder.ts:185` | Cosine similarity threshold for PR matching |
| `0.3` | `cultureScorer.ts:446, 493, 509` | Confidence penalty for ungrounded scores |
| `1024` / `2048` | `cultureScorer.ts:396, 417, 465, 483, 683, 836, 920` | LLM maxTokens for different scoring phases |
| `5` | `culture.rest.test.ts`, `cultureQuestionBank.ts` | Minimum culture questions before termination |
| `25` | `culture.rest.test.ts` | Max culture interview turns (loop guard) |
| `50` | `github/issueClient.ts`, `repoDiscovery/discover.ts` | GitHub API page size |
| `20` | `repoDiscovery/discover.ts:241` | Repo discovery result limit |
| `100` | `devContainerSessions.ts:217` | Session query limit |
| `75` / `45` / `0` | `scorerRubric.ts:79-81` | BARS score band boundaries |
| `0.55`–`0.65` | `cultureScorer.ts:25` | Human expert QWK agreement range (comment only) |

### Why This Is Bad

- **Product iteration**: A/B testing different similarity thresholds requires a deploy.
- **Context loss**: The rationale for choosing 0.6 vs 0.7 is in someone's head, not in code.
- **Environment drift**: Staging and production may need different thresholds, but the code forces them to be identical.
- **Inconsistency**: `limit: 50` in one file and `limit: 20` in another with no explanation.

---

## Evidence

```ts
// match/autoStageBuilder.ts:185
const similarity = cosineSimilarity(candidateEmbedding, prEmbedding);
if (similarity > 0.6) {
  matchedPrs.push(pr);
}

// cultureScorer.ts:446
confidence: Math.max(0, result.confidence - 0.3),

// scorerRubric.ts:79-81
strong: { min: 75, max: 100 },
adequate: { min: 45, max: 74 },
weak: { min: 0, max: 44 },
```

---

## Solution

### Option A: Environment Variables (Quick Win)

For thresholds that vary by environment:
```ts
const PR_MATCH_THRESHOLD = parseFloat(env.PR_MATCH_THRESHOLD ?? '0.6');
const CULTURE_CONFIDENCE_PENALTY = parseFloat(env.CULTURE_CONFIDENCE_PENALTY ?? '0.3');
const CULTURE_MAX_TURNS = parseInt(env.CULTURE_MAX_TURNS ?? '25', 10);
```

### Option B: Database Config Table (Recommended)

Create a `config` table for per-tenant or global tuning:

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO config (key, value, description) VALUES
('pr_match_threshold', '0.6', 'Cosine similarity threshold for PR matching'),
('culture_confidence_penalty', '0.3', 'Penalty for ungrounded culture scores'),
('culture_max_turns', '25', 'Maximum culture interview turns'),
('bars_strong_min', '75', 'BARS strong band minimum'),
('bars_adequate_min', '45', 'BARS adequate band minimum');
```

Load at startup:
```ts
// lib/config.ts
let configCache: Record<string, string> | null = null;

export async function getConfig(db: D1Database, key: string, defaultValue: string): Promise<string> {
  if (!configCache) {
    const rows = await db.prepare('SELECT key, value FROM config').all<{ key: string; value: string }>();
    configCache = Object.fromEntries(rows.results?.map(r => [r.key, r.value]) ?? []);
  }
  return configCache[key] ?? defaultValue;
}
```

### Option C: Challenge Config Extension

For thresholds that are per-challenge or per-pipeline, add columns to `challenges.server_config_json`:

```json
{
  "culture": {
    "maxTurns": 25,
    "minQuestions": 5,
    "confidencePenalty": 0.3
  },
  "matching": {
    "prSimilarityThreshold": 0.6
  }
}
```

**Recommended approach**: Use Option B (config table) for global defaults, Option C for per-challenge overrides.

---

## Acceptance Criteria

- [ ] Zero literal numbers in business logic without a named constant or config lookup.
- [ ] All thresholds are documented with a comment explaining why the value was chosen.
- [ ] Critical thresholds (similarity, confidence, max turns) are loaded from config.
- [ ] Config values are validated at load time (e.g., `z.number().min(0).max(1)`).

## Related

- TD-006 (inline BARS rubrics) — BARS bands should also be config-driven.
- TD-001 (god route files) — splitting routes makes config injection easier.
