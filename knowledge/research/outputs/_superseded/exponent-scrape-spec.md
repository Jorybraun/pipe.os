> **⚠️ SUPERSEDED — 2026-04-08**
>
> Both scrape attempts this spec describes were aborted:
> 1. First pass (`_aborted.md`) completed listing pages but detail-page fetch was blocked.
> 2. Second pass (Chrome MCP browser automation) stalled at 13/102 questions.
>
> The 1,015 listing-stub questions that reached the wiki via these attempts were then tagged by 10 parallel Haiku 4.5 subagents (commit `5cec8ff`) and wired into the selector as `CULTURE_QUESTION_BANK_GENERATED`. On 2026-04-08 the whole Exponent layer was removed — the stubs had no BARS rubrics, the scorer could not grade them, and the selector could surface them to real candidates. See CHANGELOG `[Unreleased]` entry of the same date for the removal scope.
>
> Retained here as provenance. **Do not revive this scrape strategy.** If the question bank needs to grow beyond the 15 curated BARS questions, author new questions by hand with full rubric + L/M/H calibration, mine the `first-round-seed-questions.md` source, or source from a permissively-licensed open repo — do not scrape paid interview prep platforms.

---

# Exponent Scrape Spec — Behavioral Question Bank

**Recon date:** 2026-04-07
**Source:** https://www.tryexponent.com/questions
**Output target:** `knowledge/culture/.raw/exponent/`
**Spec author:** Phase C recon pass (task #22)
**ToS posture:** User is a paying Exponent customer extracting public-tier content for private knowledge-base seeding. Scraped material stays in `.raw/` and is never republished verbatim — only rubric-authored derivatives ship to candidates.

---

## 1. URL structure

### Listing page

```
https://www.tryexponent.com/questions?type=behavioral&page={N}
```

- Page 1 omits `&page=` (page 1 link is the canonical `?type=behavioral`)
- Pages 2..51 use the explicit `&page=N` parameter
- **Last page observed: 51**
- **Total behavioral questions: ~1020** (51 × 20)

Combining filters (e.g. `?role=software-engineering&type=behavioral`) currently returns "Sorry, no results found." even though server-side data exists. Use the un-roled `?type=behavioral` URL only — role tags can be derived from the per-question page metadata.

### Question detail page

```
https://www.tryexponent.com/questions/{id}/{slug}
```

- `id` is a stable numeric primary key (e.g. `240`, `653`, `5898`)
- `slug` is a kebab-case mirror of the title; the server appears to redirect mismatched slugs to the canonical one but this is unverified — use the slug from the listing
- Question 240 verified as behavioral and unauthenticated (no paywall)

---

## 2. Listing page DOM

Each question row exposes a `<a href="/questions/{id}/{slug}">` whose `textContent` is the question title. Extraction recipe:

```js
// From a listing page:
Array.from(document.querySelectorAll('a'))
  .map(a => a.getAttribute('href') || '')
  .map(h => h.match(/^\/questions\/(\d+)\/([a-z0-9-]+)$/))
  .filter(Boolean)
  .map(m => ({ id: m[1], slug: m[2] }));
```

Per-page yield: **20 unique IDs**.

Pagination links live as `<a>` elements with numeric textContent (1, 2, 3, ..., 51) and a "Next" link with the page-2 href; both follow the `?page=N&type=behavioral` pattern.

---

## 3. Question detail page DOM

- `<h1>` — the question text exactly as asked (e.g. "Tell me about a time you made a mistake.")
- Section headings to anchor on:
  - **`Interview Details`** — contains the structured metadata. Children carry pseudo-tables of:
    - **Roles** — list of role names (e.g. `Security Analyst`, `Software Engineer`, `Backend Engineer`, `Engineering Manager`, ...)
    - **Companies** — company name + asked-at count tuples concatenated as "Amazon3 Google2 OpenAI2 Meta2 Snap1 ...". Parse with regex `/([A-Z][\w &.]+?)(\d+)/g`.
    - **Categories** — high-level type tag (e.g. `Behavioral`, `Customer Interaction`)
  - **`Community Answers`** — verbatim user-contributed answers. **Volume warning:** for popular questions this section is 100KB+ of raw text. Cap extraction to the **first 2 answers** and **5000 chars each** to keep `.raw/` tractable.
  - `Related Questions`, `Related Courses` — **skip**.
- No paywall observed on question 240 — content is fully readable while logged in.
- The "Expert answers" filter chip in the listing UI suggests a separate premium tier; unverified whether question detail pages gate the content. **Subagent must check** for any "Unlock" / "Upgrade" / "Premium" string in the body and skip the question if it's gated.

---

## 4. Anti-bot / pacing

- No CAPTCHA observed during recon
- No `robots.txt` check performed yet — **subagent must `curl https://www.tryexponent.com/robots.txt` once at start** and log the result; if the questions path is disallowed, abort the scrape
- **Pacing target:** 1 request per **3–5 seconds** (random jitter)
- **Total estimated runtime:** (51 listing + 1020 detail) × 4s ≈ **70 minutes**
- **User-Agent:** use a real Chrome UA string. Cloudflare-protected sites block default `node-fetch` UAs.
- Use HTTP/2 keep-alive if the fetch lib supports it; one connection re-used across all calls is friendlier than 1071 fresh sockets.

---

## 5. Extraction shape — one markdown file per question

`knowledge/culture/.raw/exponent/{id}-{slug}.md`:

```markdown
---
source: exponent
source_id: 240
source_url: https://www.tryexponent.com/questions/240/mistake
scraped_at: 2026-04-07T15:42:00Z
roles: [security-analyst, security-engineer, software-engineer, backend-engineer, engineering-manager]
companies:
  - {name: Amazon, count: 3}
  - {name: Google, count: 2}
  - {name: OpenAI, count: 2}
  - {name: Meta, count: 2}
categories: [behavioral]
---

# Tell me about a time you made a mistake.

## Community answers (top 2, capped at 5000 chars each)

### Answer 1
{first answer text, truncated to 5000 chars}

### Answer 2
{second answer text, truncated to 5000 chars}
```

---

## 6. Subagent invocation contract

Phase C task #23 launches a **Haiku** general-purpose subagent with:

- `isolation: "worktree"` — agent works in an isolated copy of the repo, only writes to `knowledge/culture/.raw/exponent/`
- `run_in_background: true` — main session continues during the ~70-min crawl
- This spec file path passed in the prompt
- Strict instructions to:
  1. Read this spec
  2. Hit `robots.txt` first; abort if disallowed
  3. Walk pages 1..51, write a `_index.json` with all `(id, slug, title)` tuples
  4. For each question, fetch the detail page, parse the four fields above, write the markdown file
  5. Respect the 3–5s pacing
  6. Skip and log any question that 404s, 403s, or contains a paywall string
  7. On completion, write a `_summary.md` with: total scraped, total skipped, total errors, runtime
  8. NEVER republish answer text outside `.raw/` — that's the human review step (task #24)

---

## 7. Open questions (subagent should answer or escalate)

- Are any of the 1020 questions actually duplicates of question 240 that I sampled? (Subagent should dedupe by `id` only — slugs may collide)
- Do role-tagged URLs work via a different parameter shape? (Out of scope — recon used the working un-roled URL)
- Is the "expert answers" tier gated on a different DOM structure? (Subagent flags any anomalous detail-page shape and skips it for human review)
