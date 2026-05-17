# Conversation Synthesis: Phase 3 Redesign — Intentional Micro-Turns

**Date:** 2026-05-03  
**Participants:** User (product/UX lead), Agent (implementation)  
**Status:** Proposal ready for implementation

---

## 1. The Problem

### What we observed
The culture interview feels like an interrogation, not a conversation. Candidates (especially neurodivergent/ADHD) struggle with:

- **Opaque purpose:** They don't know what the interviewer is looking for, so they guess at what to emphasize.
- **Grand-tour questions:** *"Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway. What was the problem, what did you do, and what happened?"* — this is a 3-part question that requires holding multiple constraints in working memory simultaneously.
- **No escape hatch:** If a candidate doesn't understand the question, their only option is to give a thin answer or make something up. There's no "Can you rephrase that?" mechanism.
- **Generic probes:** Follow-ups feel templated (*"Can you be more specific?"*) rather than targeted to the actual gap.

### Why it matters
- Candidate drop-off increases when the interview feels adversarial or confusing.
- Signal quality degrades when candidates are anxious or guessing at intent.
- The current system optimizes for cost (heuristic evaluator replacing LLM analysis) when the user explicitly wants **quality** — rich, structured signal that supports hiring decisions.

---

## 2. What We Explored

### Phase 3 design review
The original Phase 3 plan (`sentry-metamorpho-mister-miracle.md`) proposed:
- Heuristic evaluator replacing per-turn LLM STAR analysis (saves ~10 LLM calls)
- Pure reducer + phase architecture
- Cost target: ≤13 LLM calls per interview

**User rejected the cost-first framing.**
> *"I just want to conduct an interview and not get 5 sentences. Discovery is not good enough right now."*

### What does turn analysis actually offer?
We audited `runTurnAnalysis()` (the per-turn LLM call):

| Output | Value | Can Heuristic Replace? |
|---|---|---|
| `probe_text` — personalized follow-up | **High** — turns thin answers into rich ones | ❌ No — requires semantic understanding |
| `acknowledgment` — warm response | Medium — UX polish | ✅ Yes — template rotation |
| `star_slots` — coverage scoring | Medium — feeds termination | ⚠️ Partial — heuristic can approximate |
| `running_theme` — selector bias | Low | ✅ Yes — simple extraction |
| `reasoning` — audit trail | Low | ✅ Yes — derived from heuristic |

**Conclusion:** The probe text generation is the core value. Everything else is replaceable or nice-to-have.

### The pivot: intention
The user articulated the central design principle:
> *"I think every question needs intention. A purpose."*

This reframes the entire interview from "coverage-driven question bank" to "purpose-driven conversation."

---

## 3. The Proposal: Intentional Micro-Turns

### Core idea
Every turn has an explicit, communicable purpose. The candidate knows what signal the interviewer is seeking. Questions are scoped to one concept at a time. The conversation unfolds as a structured dialogue, not a series of standalone prompts.

### Architecture changes

#### A. Probe bank v2 — add `intention` field
```typescript
interface ProfileProbe {
  id: string;
  dimension: ProfileProbeDimension;
  intention: string;        // ← NEW: what we're looking for
  text: string;             // the question
  expectedSlots: string[];
  maxProbes: number;
  probes: Record<string, string>;
}
```

**Example:**
```typescript
{
  id: 'ownership-001',
  dimension: 'cultural',
  intention: 'I want to know if you take initiative when you spot problems — even ones outside your job description.',
  text: 'Have you ever fixed a problem at work that technically wasn\'t your responsibility? What was it?',
  // ...
}
```

#### B. Intention is surfaced to the candidate
The UI shows the intention subtly — e.g., as a subtitle or helper text:

> **Question:** Have you ever fixed a problem at work that technically wasn't your responsibility? What was it?  
> *What I'm looking for: initiative, problem-spotting, willingness to act without being asked.*

This is not patronizing; it's transparent. It tells the candidate how to answer well.

#### C. Micro-turn STAR decomposition
Instead of one big STAR question, break into 4 micro-turns with explicit intentions:

| Micro-turn | Intention | Question |
|---|---|---|
| S (Situation) | "I need to understand the context." | "What was the situation? Just the setup." |
| T (Task) | "I need to understand your role." | "What was your specific responsibility?" |
| A (Action) | "I need to understand what you did." | "What did you actually do? Walk me through your steps." |
| R (Result) | "I need to understand the outcome." | "What happened? How did you know it worked?" |

**Benefits:**
- ADHD-friendly: one concept at a time
- Better signal: candidate can't skip the hard parts
- Easier to evaluate: each micro-turn is scoped
- Clarification is natural: "What do you mean by 'context'?" → "Just tell me where this happened and who was involved."

#### D. Clarification mechanism
New action type: `CLARIFY`
- Candidate can ask for rephrasing (UI button: "I'm not sure what you're asking")
- LLM rephrases the current micro-turn more directly
- Does not count as an answer — no coverage impact
- The intention is restated, not hidden

#### E. Phase architecture (kept from original plan)
```
[consent]
   │
   ▼
[rapport_building] — 1-2 warm-up questions (not scored, not probed)
   │
   ▼
[probing] — micro-turn sequence per dimension
   │ candidate answers → heuristic evaluator runs
   │ if thin → [drilling] with targeted probe
   │ if adequate → continue to next micro-turn or next dimension
   │
   ▼
[drilling] — warm follow-up, max 2 attempts
   │
   ▼
[wrap_up] — 1-2 summary questions
   │
   ▼
[scoring] — 11 LLM calls (parallel, in waitUntil)
   │
   ▼
[complete] — batch decomposition + re-embed + match trigger
```

#### F. Heuristic evaluator role (revised)
`answerEvaluator.ts` (already built by evaluator-agent) is used for:
- **Coverage scoring** — rich/moderate/thin classification
- **Drill decision** — thin answers trigger drilling phase
- **NOT for probe text generation** — LLM still handles that

This preserves probe quality while saving ~$0.10 per interview on coverage decisions.

---

## 4. What This Means for the Project

### Files to create/modify

| File | Change | Owner |
|---|---|---|
| `profileProbeBank.ts` | Add `intention` field to all 18 probes | fsm-agent |
| `cultureAgent.ts` | Rewrite FSM for micro-turns + phase architecture | fsm-agent |
| `cultureAgentPrompts.ts` | Add intention-injection to system prompt | prompt-agent |
| `cultureAgentAdaptive.ts` | Preserve `profile_builder` static bypass, delete generative path | fsm-agent |
| `cultureInterviewReducer.ts` | New: pure reducer with micro-turn tracking | fsm-agent |
| `culturePhaseDirective.ts` | New: deterministic phase controller | fsm-agent |
| `culture.ts` (route handler) | Add `CLARIFY` endpoint | fsm-agent |
| Frontend | Show intention subtitle, add "Clarify" button | frontend-agent |

### Cost impact
- Per-turn LLM analysis: **kept** for probe text generation (~10 calls)
- Scoring pipeline: **kept** (11 calls)
- Micro-turn decomposition: **batch at termination** (1 call)
- Profile synthesis: **batch at termination** (1 call)
- **Total: ~23 LLM calls per interview** (vs. original Phase 3 target of ≤13)

**The user explicitly accepts this cost** — quality over savings.

### Interview length impact
- Old model: 10 questions × 1 turn each = 10 turns
- Micro-turn model: 10 questions × 4 micro-turns each = 40 micro-turns
- BUT: micro-turns are faster to answer (scoped, direct)
- Estimated wall-clock time: **similar or slightly longer**, but signal depth increases significantly

---

## 5. Trade-Offs

| Dimension | Before | After | Risk |
|---|---|---|---|
| **Interview length** | 10 turns | 30-40 micro-turns | Longer wall-clock time; candidate fatigue |
| **LLM cost** | ~24 calls | ~23 calls | Negligible change |
| **Implementation complexity** | Medium | High | New reducer, new FSM, new UI |
| **Signal quality** | Medium | High | Richer STAR stories, harder to fake |
| **Accessibility** | Poor | Good | ADHD-friendly, clarifiable, transparent |
| **Candidate experience** | Interrogation | Conversation | Lower anxiety, higher completion |
| **Backend complexity** | Medium | High | Micro-turn state machine, phase tracking |
| **Frontend complexity** | Low | Medium | Intention display, clarify button, progress UI |

### Biggest risks
1. **Candidate fatigue from 40 micro-turns** — mitigated by making each micro-turn fast (scoped, no narrative construction required)
2. **Implementation time** — this is a significant refactor of `cultureAgent.ts` (~836 lines)
3. **UI/UX design** — intention display must not feel patronizing or test-like

### Biggest wins
1. **Signal quality** — structured micro-turns are harder to fake than open-ended STAR stories
2. **Accessibility** — explicit intentions reduce anxiety for neurodivergent candidates
3. **Auditability** — every turn has a stated purpose, making scoring more defensible

---

## 6. Open Questions

1. **Should the candidate see the intention before or after answering?** Before = more transparent but potentially leading. After = less transparent but more natural.
2. **Should micro-turns be mandatory or adaptive?** Mandatory = consistent structure. Adaptive = skip S/T if the candidate already covered them in A.
3. **How does this interact with Mode-2 (role fit)?** Role fit uses BARS scoring — does BARS work on micro-turns or only on full STAR narratives?

---

## 7. Recommendation

**Proceed with intentional micro-turns.** The user's core insight — every question needs a purpose — is correct and high-leverage. The cost increase is acceptable. The implementation complexity is manageable if scoped to the culture agent files only.

**Sequence:**
1. Update `profileProbeBank.ts` with intentions (content work, 1 hour)
2. Build `cultureInterviewReducer.ts` with micro-turn tracking (engineering, 1 day)
3. Wire reducer into `cultureAgent.ts` with phase architecture (engineering, 1 day)
4. Add `CLARIFY` endpoint to `culture.ts` (engineering, 2 hours)
5. Frontend: intention subtitle + clarify button (engineering, 1 day)
6. Golden set calibration on evaluator thresholds (data work, 1 day)
