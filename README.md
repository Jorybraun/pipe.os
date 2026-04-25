# Pipe

AI-native developer interview platform. Multi-turn code review + structured behavioral interviews, scored by AI.

## Quickstart

```bash
npm run dev          # Local dev server (Vite + React)
npx wrangler dev     # Workers dev server
npx playwright test  # Run BDD tests
```

## Documentation

| Question | Document |
|---|---|
| What is Pipe? | [`docs/vision.md`](docs/vision.md) |
| Why build this? | [`knowledge/STRATEGY.md`](knowledge/STRATEGY.md) |
| How is it architected? | [`migration/PLAN.md`](migration/PLAN.md) |
| What have we decided? | [`docs/decisions/README.md`](docs/decisions/README.md) |
| How do I work on it? | [`CLAUDE.md`](CLAUDE.md) |

## Tech Stack

Frontend: React + Vite + TypeScript (Cloudflare Pages)
API: Cloudflare Workers (Hono router)
Database: Cloudflare D1 (SQLite)
Storage: Cloudflare R2
Auth: Clerk Pro (recruiter) + custom JWT (candidate)
AI: Vertex AI + Workers AI + Mistral (per-task routing)

See [`migration/PLAN.md`](migration/PLAN.md) for full details.
