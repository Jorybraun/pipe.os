# Research Plan: Role Discovery as Dual-Purpose Sales Intake

**Date:** 2026-04-11
**Slug:** `role-discovery-sales-intake`
**Requested by:** Founder
**Context:** Prior research (`role-discovery-data-contract`) locked the qualitative methodology for extracting role context (laddering, framework analysis, Means-End Chain, BARS, multi-stakeholder preservation). But in production, the Role Discovery agent is still vague and goal-light — it listens well but does not act with clear goals. The user's complaint, verbatim: *"its still really vague and doesnt really act with out goals. Our goals is to figure out who this person is and what they want in the candidate... extract sales information to sell the candidate from them while getting the information on what we are selling them."*

The missing domain is the **recruiter-as-sales-partner playbook** — how professional recruiters run a discovery conversation that simultaneously (a) qualifies the role requirements the hiring manager has in mind and (b) extracts the narrative ammunition needed to sell that role to the candidate later. Our current prompt does (a) imperfectly and does not do (b) at all.

---

## Core question

How should PIPE's Role Discovery interview be redesigned — as a prompt, a turn structure, and a data contract — so that a single 20-turn conversation with a hiring manager (and optional team-member stakeholders) produces **both** a rigorous requirements document **and** a structured sales narrative the recruiter can use to attract and close the candidate, grounded in research on how professional sales and recruiting discovery actually works?

## Sub-questions

1. **Sales discovery frameworks applied to hiring intake.** What do the major consultative-sales frameworks (SPIN, MEDDIC/MEDDPICC, Challenger Sale, Gap Selling, Sandler, NEAT, GPCT) each contribute to an intake conversation whose goal is dual — understand need + uncover leverage? Which techniques map cleanly onto a recruiter–hiring-manager conversation, which do not, and what does the evidence say about their effectiveness? Specifically: what does a SPIN "Implication" probe look like in recruiting, and how is it different from the current Five-Whys / laddering loop?

2. **Recruiter intake call playbooks — professional practice.** How do elite recruitment agencies and in-house TA leads actually structure the first intake / kickoff call with a hiring manager? What are the standard phases, the standard probes, and the standard artifacts (intake form, scorecard, target candidate profile)? Distinguish retained executive search (Heidrick, Spencer Stuart), contingency tech recruiting (Robert Half, Kforce, Insight Global), and modern in-house TA playbooks (Greenhouse, Ashby, Lever thought-leadership). What does a 60-minute kickoff look like in each? What do they ask that PIPE's current agent does not?

3. **Employer Value Proposition extraction and dual-purpose interview design.** How do recruiters and employer-brand practitioners actually surface the Employer Value Proposition (EVP) — the 3–5 non-obvious reasons a candidate would accept this role over alternatives? Where does the evidence (LinkedIn Talent, Gartner, Universum, BCG employer-brand research, Charles Handy / Tandehill) locate the EVP source material — hiring-manager anecdote, team-member anecdote, product framing, compensation positioning, mission/purpose statement? How should an interview protocol simultaneously extract requirements ("who do you want") and sales ammunition ("why would they come") from the same hiring-manager answers, without forcing two separate conversations?

4. **Design thinking, Jobs-to-Be-Done, and narrative extraction.** What do design-thinking and JTBD traditions contribute to designing an intake interview whose downstream consumer is both an internal hiring panel *and* an external candidate pitch? Specifically: JTBD's "switch interview" technique for understanding why people move jobs; IDEO/d.school empathy-mapping for building a persona that lives in the hiring manager's head; the narrative-transportation literature on what makes a story persuasive to a listener who wasn't there. How do these methods tell us to structure questions so the resulting artifacts serve both the scorecard and the sales pitch?

## Strategy

**Four parallel researcher subagents**, each owning a disjoint dimension of the core question. Dimensions are chosen so there is minimal overlap with each other and near-zero overlap with the completed `role-discovery-data-contract` research (which owns laddering, framework analysis, OCAI, BARS, and legal compliance).

| Researcher | Dimension | Primary sources |
|---|---|---|
| R1-sales | Consultative sales frameworks applied to recruiting | Rackham (SPIN), Dixon & Adamson (Challenger), Keenan (Gap Selling), Dunkin (MEDDIC), Sandler, academic sales research |
| R2-intake | Professional recruiter intake playbooks | LinkedIn Talent Solutions blog, SHRM, ERE Media, Recruitroo, agency playbooks, Ashby/Greenhouse/Lever guides |
| R3-evp | EVP creation and dual-purpose extraction | LinkedIn Talent, Gartner TalentNeuron, Universum, Tandehill, BCG employer-brand, academic OB/HR literature |
| R4-jtbd | Design thinking, JTBD, narrative extraction | Christensen JTBD, Ulwick ODI, d.school, Madsbjerg Sensemaking, narrative-transportation psychology |

**Boundary rules (explicit "do NOT cover" list, shared across all four briefs):**
- Do NOT re-derive laddering / Means-End Chain / grounded theory / framework analysis — those are owned by R1 of the data-contract research.
- Do NOT re-derive OCAI culture archetypes or BARS anchor calibration — owned by R2 of the data-contract research.
- Do NOT re-derive multi-stakeholder ρ=.34 preservation — owned by R4 of the data-contract research.
- Do NOT write LLM prompt text; that is the synthesis-layer output, which the Lead writes.
- Do NOT cover candidate-facing interview design (behavioral culture, code review). Those live in other briefs.

**Expected rounds:** 1 primary round. A targeted second round only if a key framework turns out to be thinly sourced (likely candidates for second-round backfill: MEDDIC applied to TA, EVP extraction at small companies <50 headcount).

## Acceptance criteria

- [x] Each sub-question answered with ≥3 independent sources, at least one of which is primary practitioner material (actual playbook, training curriculum, or empirical study) rather than secondary commentary.
- [x] Sales frameworks are not just summarized — each one has a concrete mapping to a recruiter intake probe, with a cited example.
- [x] EVP sub-question produces a concrete list of 5–10 sales-narrative element types a recruiter should leave the intake with (e.g., "compelling team story," "mission hook," "non-obvious compensation lever," etc.).
- [x] The final brief ends with a **prompt-level recommendation**: specific additions to the existing system prompt and turn controller so the agent acts with clear dual goals per turn. This is the artifact the founder can hand back to the implementer.
- [x] Contradictions between frameworks (e.g., Challenger "teach, tailor, take control" vs. SPIN "listen and probe") are named and resolved, not papered over.
- [x] No single-source claims on any critical finding.
- [x] The existing `role-discovery-data-contract` research is treated as a substrate, not re-litigated.

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | lead | Audit current agent + prior research | complete | Explore agent report (in Lead context) |
| T2 | lead | Plan + user confirmation | complete | this file |
| T3 | R1-sales | Consultative sales frameworks applied to recruiting intake | complete | `knowledge/outputs/role-discovery-sales-intake-research-sales.md` (36 sources) |
| T4 | R2-intake | Professional recruiter intake call playbooks | complete | `knowledge/outputs/role-discovery-sales-intake-research-intake.md` (60 sources) |
| T5 | R3-evp | EVP extraction and dual-purpose interview design | complete | `knowledge/outputs/role-discovery-sales-intake-research-evp.md` (34 sources) |
| T6 | R4-jtbd | Design thinking, JTBD, narrative extraction | complete | `knowledge/outputs/role-discovery-sales-intake-research-jtbd.md` (80 sources) |
| T7 | lead | Synthesize draft brief | complete | `knowledge/outputs/.drafts/role-discovery-sales-intake-draft.md` |
| T8 | verifier | Citation + URL verification pass | complete | `knowledge/outputs/role-discovery-sales-intake-brief.md` (247 citations, 45 URLs checked) |
| T9 | reviewer | Evidence integrity review | complete | `knowledge/role-discovery/role-discovery-sales-intake-verification.md` (PASS WITH NOTES) |
| T10 | lead | Deliver to `knowledge/role-discovery/` | complete | `knowledge/role-discovery/role-discovery-sales-intake.md` + provenance |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|
| Prior research coverage mapped | Explore agent read of R1–R4 data-contract files | done | Explore report in Lead context |
| Current prompt gaps identified | Explore agent read of roleAgentPrompts.ts, roleAgent.ts, roleContexts.ts | done | 5 concrete file:line gaps identified |
| Sales framework evidence | Researcher pending | pending | — |
| Recruiter intake evidence | Researcher pending | pending | — |
| EVP evidence | Researcher pending | pending | — |
| JTBD evidence | Researcher pending | pending | — |

## Decision log

- **2026-04-11, Lead:** Scope explicitly set to sales-intake dimensions. Prior role-discovery-data-contract research is treated as substrate; no re-derivation. Deliverable directory is `knowledge/role-discovery/` per user instruction, distinct from the default `knowledge/outputs/` root.
- **2026-04-11, Lead:** Chose 4 parallel researchers over 3 because the sales-framework axis (R1-sales) and the recruiter-practice axis (R2-intake) have enough volume each to deserve their own researcher — merging them would produce a thin 20-source file rather than two 15-source files.
