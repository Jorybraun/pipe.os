---
purpose: Closed vocabulary of behavioral probe patterns
consumed_by:
  - knowledge/culture/questions/**/*.md (frontmatter `probe_patterns:`)
  - workers/api/src/lib/cultureAgent.ts (runTurnAnalysis `running_theme_to_add`)
  - workers/api/src/lib/cultureQuestionBank.generated.ts (PROBE_PATTERNS const)
rule: Both the build-time tagger and the live agent MUST pick from this list. No free-text. No invented strings.
---

# Probe Patterns — Closed Vocabulary

A probe pattern is a *behavior* a question elicits — the thing the agent is actually listening for in the candidate's answer. Each question is tagged with 2-4 probe patterns from this list. During the interview, the agent emits one probe pattern per turn into `runningThemes`. The selector intersects them: questions whose probe patterns overlap the live themes get a resonance bonus.

The list is intentionally small (~30 tags) and stable. Adding a new tag means: (1) appending it here, (2) re-running `npm run sync:culture-wiki`, (3) confirming the agent prompt picks it up. Don't add tags casually — every new tag is dead until questions are re-tagged.

## Ownership

- `failure-ownership` — names a personal mistake without deflection
- `unowned-work` — engages with problems outside their formal scope
- `bias-for-action` — makes decisions under uncertainty rather than waiting
- `follow-through` — sustains effort past the easy handoff point
- `accountability-when-it-hurts` — accepts cost of a decision that didn't work

## Collaboration

- `cross-functional-collab` — works across function boundaries (eng/pm/design)
- `peer-coaching` — makes other people better through informal mentorship
- `stakeholder-management` — navigates competing stakeholder interests
- `async-communication` — communicates clearly without real-time presence
- `psychological-safety` — creates space for others to disagree or fail

## Learning orientation

- `learning-from-mistakes` — extracts lessons from a failure and changes behavior
- `changed-my-mind` — updated a strongly-held view based on new evidence
- `closed-a-gap` — recognized a knowledge gap and deliberately closed it
- `feedback-receptivity` — integrated hard feedback into how they work
- `deliberate-practice` — invested in skill growth on purpose, not by accident

## Conflict handling

- `technical-disagreement` — argued a technical position productively
- `difficult-feedback-delivery` — gave hard feedback to a peer or report
- `stakeholder-pushback` — held a position against a senior stakeholder
- `de-escalation` — defused a heated interpersonal conflict
- `principled-compromise` — found middle ground without abandoning core position

## Self-awareness

- `pattern-in-failures` — recognized a recurring failure mode in themselves
- `how-i-land` — aware of how they come across to others
- `surprising-feedback` — received feedback that contradicted their self-image
- `blind-spot-acknowledgment` — names a current weakness candidly
- `self-correction` — caught themselves mid-mistake and adjusted

## Cross-cutting (apply across multiple dimensions)

- `ambiguity-tolerance` — operates well without clear instructions
- `prioritization-tradeoffs` — chose between two good options under constraint
- `scope-management` — defined or contained scope of a hard problem
- `growth-orientation` — frames career around skill compounding
- `cultural-add` — brings a perspective the team doesn't already have
