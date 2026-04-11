# Pass 3 — Offline AI signal extraction (ADR-036)

Pass 3 is the third crawler stage defined by ADR-036's Repo Understanding Contract. It reads the deterministic artifacts from Pass 1 (GitHub search + manifest) and Pass 2 (SLOC/CCN + constructs + PR sampling) and summarizes them through a small LLM into role-agnostic engineering signals that live in `repo_engineering_signals` (migration `0022_role_discovery_data_contract.sql`).

The runtime rerank (`workers/api/src/lib/repoDiscovery/rerankPipeline.ts`) reads from that table and combines it with the Role Context Document to produce a per-role `repo_role_alignment` score. The rerank is the stage-2 retriever in the two-stage architecture; Pass 3 is the signal substrate it depends on.

**If `repo_engineering_signals` is empty, the runtime rerank still runs — it just silently skips every repo that has no signals row.** Discovery falls back to `matchRepos`'s SQL-only ordering. This is by design (see `rerankPipeline.ts` §"missing signals skip behavior"), but it means the live rerank delivers zero role-fit lift until Pass 3 has been executed at least once against the production D1.

---

## Current state (as of commit `3de3d89`, 2026-04-11)

| Piece | Status | File |
|---|---|---|
| D1 writer (Tier 1 + Tier 2 columns, `INSERT OR REPLACE` by `repo_id`) | **Present** | `persist.ts` (commit `1bf7a74`) |
| Shared `Pass3Data` interface (19 columns from migration 0022) | **Present** | `../shared/types.ts` |
| Haiku-based summarizer / prompt module | **Missing** | _intended `summarize.ts`_ |
| Pass 3 entrypoint script | **Missing** | _intended `index.ts`_ |
| Main crawler integration (`../index.ts` branching on `--pass3`) | **Missing** | `../index.ts` has no Pass 3 case |
| Slash command at `.claude/commands/crawl-repos-pass3.md` | **Missing** | n/a |
| Content-hash cost guardrail | **Upstream** | `persist.ts` receives the hash; the hashing step has to live in the missing `summarize.ts` |

In short: the write side is done, the read side (the runtime rerank) is done, and the hole in the middle is the offline summarizer that consumes Pass 2's output and writes Pass 3 rows. Until that module exists, the rerank table is populated only by manual seed data or by test fixtures.

---

## What needs to land to complete Pass 3

Three files need to be written, in roughly this order:

1. **`summarize.ts`** — the Haiku 4.5 prompt module. Takes a repo's Pass 2 artifacts (`qualified_repos` row + `repo_sample_prs` + `repo_constructs`) and returns a `Pass3Data` payload. Must:
   - Call Haiku via the offline Claude Code Agent-tool path (see the pattern in `workers/api/scripts/sync-culture-wiki.ts`). The Worker hot path is off-limits per CLAUDE.md's "no new secrets or transports on the Worker hot path" rule.
   - Compute a stable content hash over the inputs that actually determine the summary — the language manifest, the test-file count, and the recent PR metadata window. Skip the Haiku call if the hash matches the existing row in `repo_engineering_signals`. **This is the cost guardrail from the research brief and it is not optional.**
   - Emit model-family metadata (`model_used = 'claude-haiku-4-5-20251001'`, `model_version = <release version>`) so the downstream rerank can record provenance and the independence-rule guardrail (Haiku writes signals, Gemma reranks — never cross the streams).

2. **`index.ts`** — a small entrypoint that iterates repos with `WHERE pass3_completed_at IS NULL OR content_hash != <recomputed>`, calls `summarize` + `persist` for each, and logs progress. Mirror the Pass 2 entrypoint shape in `../pass2/` — same flags (`--dry-run`, `--limit`, `--repo-id`), same logger, same D1 client.

3. **Wire it into `../index.ts`**. The main crawler entrypoint currently branches on `--pass1` and `--pass2`. Add `--pass3` and forward to `pass3/index.ts`. Keep the flags independent — Pass 3 must be runnable without re-running Pass 1 / Pass 2, and it must be restartable on failure via content-hash idempotency.

Optional but useful:

4. **`.claude/commands/crawl-repos-pass3.md`** — slash-command wrapper so the founder can type `/crawl-repos-pass3` and have Claude Code run the offline batch against dev D1 without having to remember the flag incantation. Model this on any existing `.claude/commands/*.md` in the repo.

---

## How to run Pass 3 against production D1 once it exists

You need:
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_DATABASE_ID` in `.dev.vars` (same credentials that Pass 1 / Pass 2 already use).
- `ANTHROPIC_API_KEY` in the environment — the summarizer uses the Agent-tool Claude path, so the key has to be resolvable at runtime.
- A populated `qualified_repos` table. Pass 1 + Pass 2 must have run at least once. Check with `SELECT COUNT(*) FROM qualified_repos;` — if this returns 0, Pass 3 has nothing to read.

Then from `workers/api/`:

```bash
# Dry run (logs what would be written, no D1 writes, no Haiku calls on unchanged repos):
npx tsx scripts/crawl-repos/index.ts --pass3 --dry-run --limit 5

# Full run:
npx tsx scripts/crawl-repos/index.ts --pass3

# Re-run a single repo (e.g., after a summarizer prompt tweak):
npx tsx scripts/crawl-repos/index.ts --pass3 --repo-id <id>
```

Idempotency note: the content-hash check means re-running on unchanged repos is cheap (no Haiku call, just a hash lookup). Tweaking the prompt without bumping `signals_version` will NOT force a re-summarization — bump `signals_version` in `summarize.ts` whenever you ship a prompt change, otherwise the cache will serve stale rows. `signals_version` is part of the cache key the runtime rerank uses (`rerankPipeline.ts` §"cache-key invariant"), so version bumps are the only way to invalidate stored alignments in `repo_role_alignment`.

---

## How the runtime rerank consumes Pass 3 output

For every repo in the rerank batch (typically the top 20 `matchRepos` candidates):

1. Check `repo_role_alignment` for a cached row keyed on `(role_context_id, rcd_version, repo_id)` where the stored `signals_version` matches the repo's current `repo_engineering_signals.signals_version`. Cache hit → use it.
2. Cache miss → load the repo's `repo_engineering_signals` row. If missing, skip the repo (it'll be ranked after all reranked repos in `discover.ts`).
3. Call `roleFitRerank` with the RCD + signals. Write the result back via `INSERT OR REPLACE INTO repo_role_alignment`.

Two flavors of "miss" matter here: a **stale-version miss** (the alignment row exists but its `rcd_version` or `signals_version` is old) is treated the same as a first-time miss and triggers a fresh rerank. A **missing-signals miss** (the repo has no `repo_engineering_signals` row at all) is the case Pass 3 is responsible for filling; until Pass 3 writes the row, that repo is silently skipped and discovery ranks it at the back of the list.

The skip-count is exposed via `rerankMatchedRepos`'s `skippedForMissingSignals` return field. `discover.ts` doesn't currently surface this counter to the caller, but it's available for instrumentation if we decide to alert on an empty signals table.

---

## Model independence guardrail

ADR-032 routing rule: **the offline signal writer and the runtime reranker must be from different model families.** Pass 3 uses Claude Haiku 4.5 (Anthropic); the rerank uses Gemma 4 26B (Google, via Workers AI binding). Never swap either one into the other's family without updating this line and the CLAUDE.md routing table.

Violations to watch for:
- Downgrading the reranker to Haiku to "save money" — kills independence. Route the money question through CAL-1..4 calibration instead.
- Moving Pass 3 to Gemma to "simplify the stack" — same problem, inverted. The rerank can't catch its own errors.
- Running Pass 3 on the Worker hot path to "avoid the batch job" — see CLAUDE.md, "no new secrets or transports on the Worker hot path." Pass 3 is offline-only.

---

## References

- ADR-036 — Role Discovery + Repo Understanding Data Contract (`docs/decisions/ADR-036-role-discovery-data-contract.md`), especially §2 "Repo Understanding Contract" and §2.3 "Two-stage retrieval"
- ADR-032 — Code Review Research Integration (`docs/decisions/ADR-032-*.md`), §"Model routing rules"
- Migration `0022_role_discovery_data_contract.sql` — the DDL for `repo_engineering_signals` + `repo_role_alignment`
- `rerankPipeline.ts` — the runtime consumer; read this before touching `signals_version`
- `roleFitRerank.ts` — the Gemma prompt that the rerank pipeline wraps
- `knowledge/STRATEGY.md` — Decision Log entry dated 2026-04-11 "Path B complete" for the full wave breakdown
