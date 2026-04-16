# Pass 3 — Offline AI signal extraction (ADR-036)

Pass 3 is the third crawler stage defined by ADR-036's Repo Understanding Contract. It reads deterministic artifacts from Pass 1 (GitHub search + manifest) and Pass 2 (SLOC/CCN + constructs + PR sampling) and summarizes them through **Vertex AI Gemma 4 26B** into role-agnostic engineering signals that live in `repo_engineering_signals` (migration `0022_role_discovery_data_contract.sql`).

The runtime rerank (`workers/api/src/lib/repoDiscovery/rerankPipeline.ts`) reads from that table and combines it with the Role Context Document to produce a per-role `repo_role_alignment` score. The rerank is Stage 2 of the two-stage retrieval; Pass 3 is the Stage 1 signal substrate it depends on.

**If `repo_engineering_signals` is empty, the runtime rerank still runs — it just silently skips every repo that has no signals row.** Discovery falls back to `matchRepos`'s SQL-only ordering. This is by design (see `rerankPipeline.ts` §"missing signals skip behavior"), but it means the live rerank delivers zero role-fit lift until Pass 3 has been executed at least once against the production D1.

---

## Architecture — Pass 3 is a TypeScript module

Like Pass 1 and Pass 2, **Pass 3 is a plain `npx tsx` module** at `pass3/run.ts`. It reads Pass 1/2 artifacts from D1 via the REST API (`shared/d1Client.ts`), calls Vertex AI Gemma 4 26B for summarization with content-hash idempotency, and writes `repo_engineering_signals` rows.

The full orchestrator lives in TypeScript:

| File | Role |
|---|---|
| `run.ts` | Main orchestrator — batch fetch, content hash check, Gemma call, validation, persist, audit |
| `fetch.ts` | Constructs `Pass3Input` objects by joining `qualified_repos`, `repo_constructs`, `repo_sample_prs` |
| `hash.ts` | SHA-256 content hash for idempotency |
| `validate.ts` | Fingerprint checks — repo_id match, narrative length, language mention, enum validity |
| `persist.ts` | `INSERT OR REPLACE` + SELECT-back verification |
| `audit.ts` | Post-run cross-check against `qualified_repos` |

**Note on model independence:** ADR-036 originally specified different model families for Pass 3 (signal writer) and Stage 2 (runtime rerank). The current implementation uses Gemma 4 26B for both. This deviation is accepted for the initial library build — the priority is getting signals into the database. A future iteration may restore model-family independence if needed for error-detection purposes.

---

## Running Pass 3

```bash
cd workers/api

# Direct invocation (recommended)
npx tsx scripts/crawl-repos/pass3/run.ts [--limit N] [--repo-id N] [--dry-run] [--concurrency N]

# Via the crawler CLI wrapper
npx tsx scripts/crawl-repos/index.ts --pass3 [--dry-run] [--limit N]
```

### Prerequisites

| Env var | Description |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with D1 permissions |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 database ID for `pipe_db` |
| `VERTEX_AI_PROJECT_ID` | GCP project (defaults to `pipe-493116`) |

The script auto-fetches the GCP access token via `gcloud auth print-access-token`. Just ensure you're logged in:
```bash
gcloud auth login  # one-time setup
```

The script also requires:
- Migration `0022_role_discovery_data_contract.sql` applied to D1
- `qualified_repos` populated by successful Pass 1 + Pass 2 runs


---

## How the runtime rerank consumes Pass 3 output

For every repo in the rerank batch (typically the top 20 `matchRepos` candidates):

1. Check `repo_role_alignment` for a cached row keyed on `(role_context_id, rcd_version, repo_id)` where the stored `signals_version` matches the repo's current `repo_engineering_signals.signals_version`. Cache hit → use it.
2. Cache miss → load the repo's `repo_engineering_signals` row. If missing, skip the repo (it'll be ranked after all reranked repos in `discover.ts`).
3. Call `roleFitRerank` with the RCD + signals. Write the result back via `INSERT OR REPLACE INTO repo_role_alignment`.

Two flavors of "miss" matter here: a **stale-version miss** (the alignment row exists but its `rcd_version` or `signals_version` is old) is treated the same as a first-time miss and triggers a fresh rerank. A **missing-signals miss** (the repo has no `repo_engineering_signals` row at all) is the case Pass 3 is responsible for filling; until Pass 3 writes the row, that repo is silently skipped and discovery ranks it at the back of the list.

The skip-count is exposed via `rerankMatchedRepos`'s `skippedForMissingSignals` return field. `discover.ts` doesn't currently surface this counter to the caller, but it's available for instrumentation if we decide to alert on an empty signals table.

---

## Idempotency and `signals_version`

The orchestrator computes a SHA-256 content hash over the inputs that determine the summary (language, stack manifest, test/CI flags, construct slugs + counts, sampled PR metadata, and `signals_version`). Re-running on unchanged repos is a hash lookup, not a Gemma call — this is the cost guardrail.

**`signals_version` is the prompt version key, not a release tag.** Bumping the prompt without bumping `signals_version` serves stale rows forever, because the content hash still matches. Every prompt change must bump `signals_version`. It's also part of the cache key the runtime rerank uses, so version bumps invalidate stored alignments in `repo_role_alignment`.

---

## References

- ADR-036 — Role Discovery + Repo Understanding Data Contract (`docs/decisions/ADR-036-role-discovery-data-contract.md`)
- Migration `0022_role_discovery_data_contract.sql` — the DDL for `repo_engineering_signals` + `repo_role_alignment`
- `rerankPipeline.ts` — the runtime consumer; read this before touching `signals_version`
- `roleFitRerank.ts` — the Gemma prompt that the rerank pipeline wraps
