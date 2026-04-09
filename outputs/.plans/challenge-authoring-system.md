# Research Plan: Challenge Authoring System

## Core question

How should Pipe build a challenge design authoring system that:
1. Generates challenges from job descriptions (role context output)
2. Supports standalone default/template challenge packs (e.g., FRONT_END, FULLSTACK)
3. Allows recruiter-authored custom challenges
4. Covers three challenge types: MCQ, Implementation, Long-form text/video
5. Supports multi-language code challenges
6. Integrates into the existing Cloudflare Workers + D1 + React stack with a coherent UX

## Scope exclusions

- **CODE_REVIEW** challenges — handled separately by the arena system
- **FOLLOW_UP** challenges — AI-generated, not part of authoring
- **AGENT_INTERVIEW** (culture) — separate agent system

## Current state (from codebase exploration)

- **Challenge types exist** in D1 schema and TypeScript: MCQ, Implementation, Short Answer
- **Template library** exists at `src/content/challengeLibrary.ts` (~50 templates, hardcoded)
- **Preset system** exists at `workers/api/src/lib/presets.ts` (only DEFAULT + BLANK presets)
- **Challenge editor** exists per type (MCQ, CodeImpl, ShortAnswer editors)
- **Role discovery** produces persona + JD but does NOT feed into challenge generation
- **No admin UI** for managing template packs or language variants
- **No AI generation pipeline** from JD → challenges
- **No multi-language support** for code challenges

## Sub-questions

### SQ1: JD-to-Challenge Generation (AI pipeline)
How should the system generate relevant challenges from a role context (persona + JD)? What AI models, prompt patterns, and validation steps produce high-quality MCQ/Implementation/Short-Answer challenges?

### SQ2: Template Pack Architecture (data model + admin)
How should template challenge packs (FRONT_END, FULLSTACK, BACKEND, DATA_ENG, etc.) be modeled, stored, versioned, and managed? What's the D1 schema extension? How do packs compose with custom challenges?

### SQ3: Multi-Language Code Support
How should code challenges (Implementation + MCQ with code snippets) support multiple programming languages? What's the execution/validation model on Cloudflare Workers? How do other platforms handle language-specific test harnesses?

### SQ4: UX Strategy + Integration
What's the optimal recruiter UX flow for: (a) auto-generating challenges from a JD, (b) picking from template packs, (c) creating custom challenges, (d) mixing all three in a pipeline? How does this fit the existing stage-config wizard?

### SQ5: Competitive Landscape
How do HackerRank, Codility, TestGorilla, Testlify, and similar platforms handle challenge authoring, template libraries, and JD-based generation? What patterns work, what's table-stakes, what's differentiated?

## Strategy

| ID | Owner | Dimension | Boundaries |
|----|-------|-----------|------------|
| R1 | researcher | AI-powered assessment generation | Prompt engineering, model selection, validation chains. Do NOT cover UX or DB schema. |
| R2 | researcher | Template/pack architecture + multi-language | Data modeling, language runtime options, versioning. Do NOT cover AI generation or UX. |
| R3 | researcher | UX patterns + competitive landscape | Authoring UX flows, competitor analysis, integration patterns. Do NOT cover AI models or DB internals. |

Three parallel researchers, one synthesis round expected.

## Acceptance criteria

- [ ] AI generation pipeline design with model recommendations and prompt structure
- [ ] D1 schema extension for template packs with versioning
- [ ] Multi-language support architecture compatible with Cloudflare Workers
- [ ] UX wireframe-level flow descriptions for all authoring modes
- [ ] Competitive analysis of ≥4 platforms
- [ ] All critical claims backed by ≥2 sources
- [ ] Integration plan that respects existing preset system and stage-config wizard

## Task ledger

| ID | Owner | Task | Status | Output |
|----|-------|------|--------|--------|
| T1 | R1 | AI assessment generation patterns + model routing | todo | outputs/challenge-authoring-system-research-r1.md |
| T2 | R2 | Template pack data model + multi-language runtime | todo | outputs/challenge-authoring-system-research-r2.md |
| T3 | R3 | UX authoring flows + competitive landscape | todo | outputs/challenge-authoring-system-research-r3.md |

## Verification log

| Item | Method | Status | Evidence |
|------|--------|--------|----------|

## Decision log

(Updated as the workflow progresses)
