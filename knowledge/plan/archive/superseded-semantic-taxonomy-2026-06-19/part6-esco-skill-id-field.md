# ESCO Skill ID Field on Skill Sub-Elements

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part6-market-research.md (lines 86–108)
**Phase:** 1
**Status:** PENDING
**Estimate:** 0.5 weeks
**Type:** Engineering

## Source quote

> ESCO is **practically useful** as a reference vocabulary for the Skill sub-element. Sub-element records carry an optional `esco_id` field pointing to the ESCO URI when the skill has a standard entry. Extraction prompts mention ESCO as a preference.

## Why

Adding an optional `esco_id` field to Skill sub-elements gives Pipe standardized tags for ~500 developer skills without inventing a taxonomy. It reduces LLM extraction prompt burden (the LLM can prefer ESCO names) and enables future interoperability with HR systems that speak ESCO.

## Subtasks (delegable)

### Subtask 1 — Add `esco_id` to Skill sub-element schema

**Files / Deliverables:**
- `workers/api/migrations/XXXX_skill_esco_id.sql`
- `workers/api/src/types/candidateGraph.ts` (or wherever Skill sub-element types live)

**Spec:**
Migration adds nullable `esco_id TEXT` column to the skill sub-element table (or JSON schema field if stored as JSON). The ESCO ID format is a URI: `http://data.europa.eu/esco/skill/[uuid]`.

Type update: add `escoId?: string` to the `SkillSubElement` (or equivalent) TypeScript type. Field is optional — not all skills have ESCO entries.

Identify the correct table/JSON field location by checking the candidate graph schema. Do not guess file names; read the existing schema first.

**Status:** ⏳ PENDING

### Subtask 2 — Update extraction prompts to prefer ESCO skill names

**Files / Deliverables:**
- `workers/api/src/lib/candidateDiscovery/prompts.ts`

**Spec:**
Add a prompt instruction to the skill extraction section:

> When naming skills, prefer the canonical ESCO skill name where one exists (e.g., "Java programming language" not "Java dev"). If you know the ESCO URI, include it as `esco_id`. Otherwise omit the field.

This is a low-cost prompt addition — one sentence in the existing skill extraction instruction block. Verify the change does not break existing Vitest tests for prompt formatting.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: Candidate graph schema (read existing schema before writing migration)
- Blocks: nothing immediately; improves downstream HR system interoperability

## Acceptance criteria

- [ ] Migration applies cleanly: `esco_id` column present on skill sub-element storage
- [ ] `SkillSubElement` type has `escoId?: string` (optional, non-breaking)
- [ ] Extraction prompt includes ESCO preference instruction
- [ ] All existing prompt tests still pass
- [ ] `npx tsc --noEmit` passes
