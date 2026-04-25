# Repo Linkage

How GitHub repositories are assigned to repo-using **stations** in a PIPE-OS pipeline.

## What is a "station"?

In the repo-linkage context, a **station** is a pipeline stage that is anchored on a GitHub repository. The term is borrowed from medical-education assessment design (OSCE — Objective Structured Clinical Examination), where a candidate rotates through timed "stations" each testing a different skill. In PIPE-OS the analogy is looser: a station is simply a stage whose challenge content is drawn from real repo data.

> **Not to be confused with** medical or OSCE stations in the literal sense. PIPE-OS does not run clinical exams. The word "station" appears in research docs as an analogy; in the product UI it is used as shorthand for "repo-using stage."

## Which stages are stations?

Only two stage types use repos. The UI and backend use slightly different names for the same concept:

| UI label | Stage type | Challenge type | What the candidate does |
|---|---|---|---|
| **Code Review** | `CODE_REVIEW` | `CODE_REVIEW` | Multi-turn PR review with an AI implementer |
| **Open Source** | `OPEN_SOURCE` | `CODE_IMPLEMENTATION` | Live issue implementation in a dev container |

*Every other stage type (SCREENING, CULTURAL, LIVE_PANEL) does not need a repo and is not a "station" for linkage purposes.*

## The two linkage options

When a recruiter builds a pipeline through the Match-Config Wizard, they are asked:

> **"One repo across both stations, or pick one per station?"**

### 1. Shared repo (recommended)
- **Both stations use the same matched repository.**
- The candidate builds context once and stays in one codebase.
- Lower cognitive load; faster onboarding.
- Default in ADR-039.
- Best when you want **consistency-across-modality signal** — comparing how the same candidate reviews code *versus* implements code in the same domain.

### 2. Sample across repos
- **Each station gets its own independently matched repository.**
- The matcher runs twice; the two repos may differ.
- Higher candidate load because the candidate must orient to a second codebase.
- Best when you want **breadth signal** — seeing how the candidate handles two different tech stacks or problem domains.
- Use sparingly; deferred to v2/enterprise tier in the current roadmap.

## When to pick which

| Goal | Pick |
|---|---|
| Minimize candidate drop-off | **Shared repo** |
| Measure consistency (review vs. implement) in one domain | **Shared repo** |
| Stress-test adaptability across codebases | **Sample across repos** |
| Role requires fluency in two very different stacks | **Sample across repos** |
| Early-stage pipeline / small candidate pool | **Shared repo** |

## Relationship to other config axes

Repo linkage is one of four orthogonal axes in the match-config system (ADR-039):

1. **Match philosophy** — `tailored` / `hybrid` / `validate`
2. **Tolerance** — `strict` / `moderate` / `lenient`
3. **Stage linkage** — `shared-repo` / `per-stage` *(this document)*
4. **Automation granularity** — `per-pipeline` / `per-candidate` / `per-stage` / `recruiter-override`

Stage linkage only affects the repo-using stations. A `shared-repo` pipeline still runs SCREENING and CULTURAL stages normally; those stages simply do not participate in repo matching at all.

## See also

- `knowledge/terminology.md` — definition of "station"
- `docs/decisions/current/ADR-039-bi-directional-vectorization-and-3-station-interview.md` — full decision record
- `knowledge/interview/repo-personalized-interview-config.md` — research brief on OSCE-style multi-station design
