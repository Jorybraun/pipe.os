# Pipeline Builder — Changelog

## [Unreleased]

### 2024-12-18 — Initial Requirements Draft

**Context**: Establishing baseline requirements for pipeline builder as the core orchestration feature that connects role creation to stage configuration.

**Added**
- REQ-PB-001 through REQ-PB-018: Core functional requirements
- US-PB-01 through US-PB-10: User stories
- Two-panel layout specification (AI chat + pipeline canvas)
- Stage card design with summary view
- AI assistant behavior patterns
- Acceptance criteria (10 items)
- Open questions (4 items)

**Design Decisions**
- Split panel layout: AI assistant left, pipeline canvas right
- Stages displayed vertically with connector arrows
- AI suggests initial pipeline but user has full control
- Stage cards show summary; click navigates to full config
- Pass thresholds configurable per stage

**Requirements Impact**
- REQ-PB-001 to REQ-PB-018: Added (Draft status)

**Open Questions**
- OQ-PB-01: Show drop-off rate estimates?
- OQ-PB-02: Allow duplicate stage types?
- OQ-PB-03: Timeline/calendar view option?
- OQ-PB-04: Conditional branching support?

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2024-12-18 | Initial requirements draft |
