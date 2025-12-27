# Role Creation — Changelog

## [Unreleased]

### 2024-12-18 — Initial Requirements Draft

**Context**: Establishing baseline requirements for role creation feature as first step in pipeline creation flow.

**Added**
- REQ-RC-001 through REQ-RC-013: Core functional requirements
- US-RC-01 through US-RC-07: User stories
- UI layout specification with 4 main sections
- Content requirements (auto-generated vs user-provided)
- Acceptance criteria (10 items)
- Open questions (4 items)

**Design Decisions**
- Role creation is a single-page form (not wizard)
- Minimum viable input: title + seniority only
- AI suggestions for skills based on title
- Auto-save to prevent data loss

**Requirements Impact**
- REQ-RC-001 to REQ-RC-013: Added (Draft status)

**Open Questions**
- OQ-RC-01: Multiple hiring managers per role?
- OQ-RC-02: Roles spanning multiple departments?
- OQ-RC-03: Seniority affecting available stages?
- OQ-RC-04: Role templates for common positions?

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2024-12-18 | Initial requirements draft |
