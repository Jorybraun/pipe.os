# Role overlays

The culture agent's question selection is baseline-agnostic — any question tagged for the candidate's seniority is eligible. Role overlays are optional weights that shift selection toward questions more relevant to a specific role shape.

Overlays are applied *on top of* the base seniority filter, not instead of it. An overlay never disqualifies a question; it only boosts selection probability.

---

## Overlay file format

```markdown
---
role_slug: senior-ic
description: Individual contributor at senior level, expected to mentor but not manage
---

## Dimension weights
- ownership: 1.2
- collaboration: 1.0
- learning-orientation: 1.3
- conflict-handling: 1.0
- self-awareness: 1.1

## Preferred question tags
- technical-disagreement
- mentorship
- cross-team-influence

## Deprioritized tags
- direct-reports
- performance-reviews
```

Default weights are 1.0. Values above 1.0 boost, below 1.0 deprioritize. Never use 0 — use the main bank's seniority field to disqualify instead.

---

## Files

- `senior-ic.md` — individual contributor, senior level
- `manager.md` — people manager, first-line or second-line
- (more to be added as PIPE grows)

The culture agent receives the overlay slug via `challenge.server_config.role_overlay`. If no overlay is configured, all weights default to 1.0 and all tags are treated equally.
