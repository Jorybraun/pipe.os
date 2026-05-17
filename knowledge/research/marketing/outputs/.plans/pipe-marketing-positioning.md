# Research Plan: PIPE marketing positioning

## Core question

How should PIPE — an AI-native developer interview platform that replaces résumé/take-home screening with one rigorous AI-proctored challenge producing a cross-family-scored transcript artifact — be positioned to the recruiters and talent leaders who buy it?

## Sub-questions

1. **ICP & buyer persona.** Who is the economic buyer (title, company size, team shape, budget authority)? What do they currently pay for assessment/interviewing, and what's their #1 pain point in 2026? Is this a talent-ops buy, an engineering-leader buy, or a recruiting-agency buy?
2. **Competitive landscape.** The current developer assessment stack — HackerRank, Codility, CodeSignal, Karat, CodeInterview, CoderPad, take-homes, agency phone screens, DIY Zoom interviews. Pricing, share, strengths, weaknesses, recent product changes (especially AI responses). How has ChatGPT disrupted this market 2023–2026?
3. **Category & wedge.** What category angle is defensible? "Uncheatable in GPT era" / "Transcript as evidence" / "Defensible/audit-ready hires" / "AI-native interview" / something else. How is the category being talked about in 2026? What do HackerRank & Codility say now that they've added AI? Where is the genuine white space?
4. **AI-cheating crisis & buyer urgency.** How bad is the cheating problem in coding assessments post-ChatGPT? What data exists on false positives from current tools? What are real buyers writing/saying about this in 2025–2026? What's the urgency level driving switching?
5. **Compliance story.** EU AI Act for hiring, NYC AEDT, Colorado AI Act, emerging US state laws. What are real buyer obligations in 2026? Is "audit-ready AI hiring" a real differentiator or a footnote? Who else claims it?

## Strategy

- **Supervisor:** Opus (this run). Synthesizes the final brief — does not delegate writing.
- **Researchers:** 4 parallel general-purpose subagents, each on Sonnet model, each assigned one disjoint dimension. Sub-question 3 (category/wedge) is written by the supervisor from the other three outputs — it's synthesis, not discovery.
- **Expected rounds:** 1, maybe 2 if major gaps surface.
- **Tool budget per researcher:** WebSearch + WebFetch, bounded ≤ 25 tool calls. Write to file, return a ≤ 300-word summary to supervisor context.

### Researcher allocation

| ID | Owner | Dimension |
|---|---|---|
| R1 | sonnet | ICP, buyer persona, willingness-to-pay |
| R2 | sonnet | Competitive landscape (HackerRank, Codility, CodeSignal, Karat, CoderPad, take-homes) |
| R3 | sonnet | AI-cheating crisis 2023–2026, buyer sentiment, market timing |
| R4 | sonnet | Compliance landscape (EU AI Act, NYC AEDT, Colorado, emerging) |

## Acceptance criteria

- [ ] Each sub-question answered with ≥ 2 independent sources
- [ ] Contradictions between sources identified and addressed
- [ ] No single-source claims on critical findings (ICP description, competitor pricing, regulatory effective dates)
- [ ] Each researcher file contains an inline citations list with URLs
- [ ] Supervisor's final brief includes an Open Questions section with real unknowns

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1 sonnet | ICP + buyer persona + budgets | todo | `outputs/pipe-marketing-positioning-icp.md` |
| T2 | R2 sonnet | Competitive landscape | todo | `outputs/pipe-marketing-positioning-competitors.md` |
| T3 | R3 sonnet | AI-cheating crisis + buyer urgency | todo | `outputs/pipe-marketing-positioning-crisis.md` |
| T4 | R4 sonnet | Compliance landscape | todo | `outputs/pipe-marketing-positioning-compliance.md` |
| T5 | supervisor (Opus) | Synthesize category/wedge + write draft brief | blocked on T1–T4 | `outputs/.drafts/pipe-marketing-positioning-draft.md` |
| T6 | verifier | Cite & verify URLs | blocked on T5 | `outputs/pipe-marketing-positioning-brief.md` |
| T7 | reviewer | Evidence-integrity pass | blocked on T6 | `outputs/pipe-marketing-positioning-verification.md` |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|

## Decision log

- 2026-04-19: Sonnet chosen for researchers (cost + parallelism); Opus retained as supervisor & draft author. General-purpose subagent type used because `researcher` agent is project-scoped to PIPE-OS and this run happens from the PIPE parent dir.
- 2026-04-19: R3 (AI-cheating) and R4 (compliance) split because evidence bases are very different — cheating is forum/vendor/journalistic; compliance is statutory/legal.
