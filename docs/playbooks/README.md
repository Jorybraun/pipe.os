# Playbooks

A **playbook** is a repeatable, human-readable recipe for dogfooding a Pipe feature. Each playbook contains:

- **Scope** — what slice of product behavior is being exercised.
- **Prerequisites** — environment, credentials, and seed data.
- **Fast automated check** — a quick Playwright or script command that proves the happy path.
- **Manual steps** — the exact clicks, URLs, payloads, and observations for a real user session.
- **Pass/fail criteria** — what observable outcomes mean the feature is working.
- **Known blockers** — environment limits, mocks, or real bugs to expect.
- **Cleanup** — how to remove test data.

## When to use a playbook

- Before a PR: confirm the feature still works with real credentials and data.
- During QA: reproduce a flaky e2e failure or verify a fix manually.
- For onboarding: give a new contributor a concrete path through the product.
- For demos: a scripted, source-backed session that exercises real matching / scheduling / video flows.

## Playbook output

After running a playbook, save the result as a dated report under `dogfood-output/`, e.g.:

```
dogfood-output/matching-report-2026-07-08.md
```

The report should record observed behavior, screenshots, and any failures. If a playbook step fails and it is **not** an already-documented blocker, file a bug or add a Playwright regression test.

## Playbook template

Create new playbooks by copying this structure:

```markdown
# Playbook: <feature>

## Scope
...
## Prerequisites
...
## Fast automated check
...
## Manual dogfood steps
1. ...
2. ...
## Pass/fail criteria
...
## Known blockers
...
## Cleanup
...
```

## Index

- [`matching.md`](matching.md) — dogfooding candidate-to-repo matching.
