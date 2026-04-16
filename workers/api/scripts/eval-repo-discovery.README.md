# Repo Discovery Eval Harness

**File:** `workers/api/scripts/eval-repo-discovery.ts`
**Decision log entry:** STRATEGY.md 2026-04-14 — "Eval methodology for Vectorize semantic search"

Measures retrieval quality of the Vectorize-backed repo discovery system (`discover.ts`) against a gold set of expected repositories for five role archetypes.

---

## What each metric means

### Recall@K (R@5, R@10, R@20)

**Formula:** `|gold ∩ top-K| / |gold|`

How many of the expected "good fit" repos appear in the top K results, expressed as a fraction.

- R@20 = 0.8 means 8 out of 10 expected repos appeared in the top 20 results.
- R@20 is the **primary pass/fail metric** — discovery is a recall problem. A recruiter reviews the top 20 repos; if the right ones aren't there, the system failed.
- The pass threshold is **R@20 ≥ 0.6 averaged across all fixtures**.
- R@5 and R@10 measure early-rank quality — useful for tuning but not the pass criterion.

### Precision@K (P@10)

**Formula:** `|gold ∩ top-K| / K`

What fraction of the top K results are actually relevant.

- P@10 = 0.3 means 3 of the top 10 results were in the gold set.
- Lower than R@K is expected and acceptable. Discovery is a recall-first system — showing 10 repos where 3 are excellent is fine; missing all 10 excellent repos is not.
- P@10 is tracked for directional signal; it is not a pass/fail gate.

### Mean Reciprocal Rank (MRR)

**Formula:** `1 / (rank of first gold repo in results)`

How quickly does the system surface at least one relevant result?

- MRR = 1.0 means a gold repo is at rank 1 (first result).
- MRR = 0.5 means first gold repo at rank 2.
- MRR = 0.33 means first gold repo at rank 3.
- MRR is tracked for recruiter UX signal — a recruiter who sees a poor fit at rank 1 may lose trust in the system even if the overall recall is good.

---

## Fixtures

Each fixture is a `RoleContextDocument` JSON file in `workers/api/fixtures/repo-discovery/`.

| Filename | Role archetype | Primary language | Architecture | Test style |
|---|---|---|---|---|
| `rcd-senior-backend-typescript.json` | Senior Backend Engineer | TypeScript + Node.js | Microservice (strangler-fig) | integration_heavy |
| `rcd-staff-platform-go.json` | Staff Platform Engineer | Go + Kubernetes + gRPC | Microservice | e2e_present |
| `rcd-mid-fullstack-react.json` | Mid Fullstack Engineer | TypeScript + React | Monolith | unit_only |
| `rcd-senior-data-python.json` | Senior Data Engineer | Python + Spark + Airflow | Layered service | integration_heavy |
| `rcd-junior-backend-rust.json` | Junior Backend Engineer | Rust + Tokio | Library | unit_only |

### Adding a new fixture

1. Create a new JSON file in `workers/api/fixtures/repo-discovery/` following the `RoleContextDocument` schema in `workers/api/src/types.ts`.
2. At minimum, populate:
   - `technical_context` (all fields including `stack`, `constructs`, `seniority_band`, `codebase_expectations`, `dispositional_weights`)
   - `domain_matrix.HIRING_MANAGER` with at least `work`, `codebase`, and `bar` cells, each with a non-trivial `summary` (50–150 words)
   - 2–3 `bars_overrides` with realistic override text
   - `validation_metadata`
3. Add the fixture stem to `ALL_FIXTURE_STEMS` in `eval-repo-discovery.ts`.
4. Add a corresponding entry to `expected-top-repos.json`.

---

## Gold set

**File:** `workers/api/fixtures/repo-discovery/expected-top-repos.json`

Each entry maps a fixture stem to a list of `full_name` strings (e.g., `"prisma/prisma"`) that should appear in the top-20 discovery results for that role.

### Updating the gold set

- **Add repos:** Identify well-known open-source repos that genuinely match the role's stack, constructs, and codebase style. Pick repos the crawler has likely indexed (100–10,000 stars in the correct language).
- **Remove repos:** If a repo changes language, goes archived, or gets disqualified by the crawler, remove it from the gold set.
- **Tighten the gold set:** Once the corpus is mature, reduce the gold set to only the 5–6 highest-signal repos per fixture. A smaller, higher-precision gold set gives more informative metrics.
- **Never add repos the crawler hasn't indexed.** The harness warns when a gold repo is missing from D1 and excludes it from metrics — but a gold set with many missing repos gives misleading results.

---

## Pass threshold

**Target: R@20 ≥ 0.6 averaged across all fixtures**

### Why 0.6?

0.6 is the **documentary baseline** established at the time the system was built (2026-04-14). At that point, the Vectorize index was newly populated and the corpus was still growing. 0.6 means the system surfaces 60% of the expected repos in the top 20 — enough to be useful, not yet at production quality.

**When to tighten:** Once the crawler has indexed 5,000+ repos and the Vectorize index contains at least 1,000 embedded profiles, the target should increase to 0.7. At 10,000+ repos, 0.75 is a reasonable production target.

**Why not 1.0?** The gold set repos may not all be in the crawler's corpus. Repos that don't meet the crawler's star threshold, language filter, or quality criteria are excluded from `qualified_repos` — the system cannot recall them.

---

## How to run locally

### Prerequisites

1. Populate the local D1 corpus (run the crawler):
   ```bash
   cd workers/api
   npx tsx scripts/crawl-repos/index.ts --limit 100
   ```

2. Start wrangler dev with local persistence:
   ```bash
   cd workers/api
   npx wrangler dev --local --persist-to .wrangler/state &
   ```

   The `--persist-to` flag tells wrangler to store D1 and Vectorize state on disk so it persists across restarts.

3. Populate the Vectorize index (run pass 3 embed script when available):
   ```bash
   # Generates embeddings and upserts them to REPO_INDEX
   npx tsx scripts/crawl-repos/pass3/embed-profiles.ts
   ```

### Run the harness

```bash
# Full eval (all 5 fixtures)
cd workers/api
npx tsx scripts/eval-repo-discovery.ts

# Single fixture
npx tsx scripts/eval-repo-discovery.ts --fixture rcd-senior-backend-typescript

# Dry run (fixture validation only — no Vectorize/D1 calls)
npx tsx scripts/eval-repo-discovery.ts --dry-run
```

### Expected output (dry run, no corpus)

```
Repo Discovery Eval — v2.0.0
══════════════════════════════════════════════════════════

Loading fixtures...
  rcd-senior-backend-typescript: OK (search profile: 512 words)
  rcd-staff-platform-go: OK (search profile: 487 words)
  rcd-mid-fullstack-react: OK (search profile: 498 words)
  rcd-senior-data-python: OK (search profile: 543 words)
  rcd-junior-backend-rust: OK (search profile: 471 words)

Loading gold set...
  rcd-senior-backend-typescript: 9 expected repos
  rcd-staff-platform-go: 9 expected repos
  rcd-mid-fullstack-react: 9 expected repos
  rcd-senior-data-python: 8 expected repos
  rcd-junior-backend-rust: 7 expected repos

Acquiring Cloudflare platform bindings...
  No platform bindings available. Metrics will be zero — fixture validation only.
```

### Expected output (with corpus)

```
Eval results — repo discovery v2.0.0
────────────────────────────────────────────────────────────────────────────
Fixture                                R@5    R@10   R@20   P@10   MRR
────────────────────────────────────────────────────────────────────────────
rcd-senior-backend-typescript          0.33   0.56   0.78   0.50   0.50
rcd-staff-platform-go                  0.22   0.44   0.67   0.44   0.33
rcd-mid-fullstack-react                0.44   0.56   0.78   0.56   0.50
rcd-senior-data-python                 0.25   0.50   0.75   0.50   0.50
rcd-junior-backend-rust                0.43   0.57   0.71   0.43   0.50
────────────────────────────────────────────────────────────────────────────

Average R@20 across 5 fixture(s): 0.74 (target >= 0.6) ✓ PASS
```

## How to run against staging

If the local Vectorize state is not populated but the staging deployment has a live index:

```bash
# Point at staging (no wrangler dev needed)
WRANGLER_API_URL=https://pipe-api.your-account.workers.dev \
  npx tsx workers/api/scripts/eval-repo-discovery.ts
```

Note: this uses the `getPlatformProxy` remote path. The staging DB must have `qualified_repos` populated.

---

## Troubleshooting

**All metrics are 0.00 / "no-bindings"**
- wrangler dev is not running or `--persist-to` path doesn't match.
- Run: `cd workers/api && npx wrangler dev --local --persist-to .wrangler/state`

**"Gold repos not found in D1"**
- The crawler hasn't indexed those repos yet.
- Run more crawler passes or increase `--limit`.
- The gold repos may have more than 10,000 stars (above the crawler's `maxStars` cap for some queries). Adjust `config.ts` SEARCH_QUERIES for those repos.

**R@20 is well above 0.6 for most fixtures but one fixture scores 0.0**
- Check whether the primary language in that fixture's `technical_context.stack` matches the crawler's indexed languages.
- The `derivePrimaryLanguageFromStack` function in the harness maps stacks to canonical language strings. Verify the mapping covers your stack.

**Vectorize returns no matches**
- The REPO_INDEX may not be populated for local dev.
- The `repo_searchable_profile` column in `repo_engineering_signals` needs to be populated by pass 3 and then embedded.
- The harness automatically falls back to SQL-only when Vectorize returns nothing.
