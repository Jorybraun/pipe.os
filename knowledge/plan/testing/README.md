# Testing Strategy

Every feature shipped to `main` must have a corresponding testing plan in this directory.

## Directory Structure

```
knowledge/plan/testing/
├── README.md                           # This file — testing strategy overview
├── TEMPLATE.md                         # Copy this to create a new testing plan
├── github-client-and-dynamic-profile.md # 2026-05-01 — GitHub Client Rewrite + Dynamic Candidate Profile
└── ...
```

## Testing Pyramid

| Layer | Purpose | Owner | When |
|-------|---------|-------|------|
| **Unit** | Fast feedback on logic, parsing, algorithms | Agent / dev | On every code change |
| **Integration** | API routes, DB writes, external service calls | Agent / dev | On every PR |
| **Smoke** | Critical path still works after deploy | Human / staging | After every deploy |
| **E2E** | Real browser flows, critical user journeys | Playwright / human | Before release |

## Smoke Test Rule

> **If a feature touches the candidate profile, enrichment, or matching pipeline, it MUST have a smoke test section that can be run in under 2 minutes on staging.**

Smoke tests are manual instructions — they do not need to be automated, but they must be written down.

## How to Add a Testing Plan

1. Copy `TEMPLATE.md` to a new file named after the feature
2. Fill in all sections
3. Add the file to the commit that ships the feature
4. Update this README's directory listing
