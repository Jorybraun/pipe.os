# Pipe

Pipe is a technical interview platform for engineering teams. Recruiters build assessment pipelines. Candidates complete async or live technical challenges. AI scores submissions.

---

## What works today

### Recruiter dashboard
- Pipeline CRUD — create, list, view, and manage assessment pipelines
- Stage builder — add/remove stages, configure ASYNC or LIVE_VIDEO mode
- Challenge management — add CODE_REVIEW and MCQ challenges to stages via `ChallengePicker.tsx`
- Candidate list with scores and signal labels (STRONG / YES / MAYBE / NO)

### Scheduling
- Calendly and Cal.com OAuth integration
- Interview cards with status tracking (`InterviewCard.tsx`, `SchedulingDashboard.tsx`)
- Status override modal for manual recruiter control

### Video interviewing
- WebRTC live video sessions (`useVideoSession.ts`, `useVideoSignaling.ts`)
- Custom TURN credential service — `turnCredentials` Lambda + Metered.ca relay
- Waiting room, PiP floating window, device check

### Code review challenges
- GitHub PR integration — fetch real pull requests as code review challenges (`fetchGitHubPR`, `listGitHubPRs` Lambdas)
- Diff viewer with annotation support (`DiffPanel.tsx`, `DiffAnnotationPanel.tsx`)
- Ground-truth scoring (`scoreCodeReview` Lambda)

### Dev containers
- ECS Fargate containers launched per session (`devContainerLaunch` Lambda)
- Container lifecycle: launch / destroy / status / logs (`devContainerDestroy`, `devContainerStatus`, `getContainerLogs`, `ecsStatusBridge` Lambdas)
- Real-time status via AppSync subscriptions

### AI agents
- Job description agent (`jobDescriptionAgent` Lambda)
- Question generation agent (`questionAgent` Lambda)
- Submission scoring agent (`scoringAgent` Lambda)

### Notifications
- Lambda-based notification service (`notificationService`, `notificationStreamService` Lambdas)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict mode) |
| Auth | AWS Cognito (Amplify Gen 2) |
| API | AWS AppSync GraphQL (Amplify Gen 2) |
| Database | Amazon DynamoDB |
| Functions | AWS Lambda (TypeScript, 18 functions) |
| Containers | AWS ECS Fargate (dev container sessions) |
| Infrastructure | Terraform (`infra/`) — ECS cluster, IAM, security groups, SSM, CloudWatch |
| Hosting | AWS Amplify Hosting |

---

## Local development

```bash
npm install
npm run dev               # Vite dev server
npx ampx sandbox          # Deploy schema to personal cloud sandbox
npx tsc --noEmit          # Type check (required before any commit)
```

---

## Repo crawling pipeline (Pass 1 / 2 / 3)

Pipe qualifies open-source repos in three passes. Passes 1 and 2 are offline CLI jobs (clone + analyze); Pass 3 is Gemma-driven narrative summarization that can run from the CLI *or* the admin UI, with a human gate before vectorization.

All crawler commands run from `workers/api/`:

```bash
cd workers/api
```

Required env vars in `workers/api/.dev.vars`:

```
GITHUB_TOKEN=...                 # Pass 1 + Pass 2
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...         # needs D1 + AI write
CLOUDFLARE_D1_DATABASE_ID=...
# Pass 3 only:
ROLE_AGENT_PROVIDER=vertex-ai    # or "cloudflare-ai"
GOOGLE_SERVICE_ACCOUNT_KEY=...   # Vertex service account JSON (single line)
```

### Pass 1 — search + coarse filter

Finds candidate repos on GitHub, applies coarse filters (stars, license, activity), extracts manifest skills. Writes `qualified_repos` rows with `pass = 1`.

```bash
npx tsx scripts/crawl-repos/index.ts --pass1
npx tsx scripts/crawl-repos/index.ts --pass1 --limit 50 --dry-run
```

### Pass 2 — clone + deep analysis

For each `pass = 1 AND disqualified = 0` repo: clones to a temp dir, measures complexity (SLOC/CCN), detects constructs and stack, samples PRs, infers domain. Promotes the row to `pass = 2`.

Bulk (all eligible repos, up to batch size):

```bash
npx tsx scripts/crawl-repos/index.ts --pass2
npx tsx scripts/crawl-repos/index.ts --pass2 --limit 200
```

Single repo by D1 ID (retry / targeted re-run):

```bash
npx tsx scripts/crawl-repos/index.ts --pass2 --repo-id 5016
```

`--repo-id` bypasses the `pass = 1` filter, so it also works to re-run Pass 2 on a row that's already at `pass = 2`.

### Pass 3 — AI narrative + human-gated vectorization

Pass 3 has two entry points.

**A. Bulk / offline CLI** — runs Gemma on every `pass = 2` repo:

```bash
npx tsx scripts/crawl-repos/index.ts --pass3
npx tsx scripts/crawl-repos/index.ts --pass3 --repo-id 5016
npx tsx scripts/crawl-repos/index.ts --pass3 --concurrency 5
```

**B. Admin UI (recommended for quality review)** — at `/admin/repos/:id`:

1. Click **"Run AI analysis"** → `POST /api/v1/admin/repos/:id/pass3/analyze`. Gemma generates `engineering_narrative` + `repo_searchable_profile` + `architecture_style`. Persists to `repo_engineering_signals`. **Does not vectorize.**
2. Read the narrative.
3. Click **"Approve & ingest"** (optional critique note) → `POST /pass3/feedback {verdict:'approved'}` → `POST /pass3/ingest`. Embeds the profile with `@cf/baai/bge-large-en-v1.5` and upserts to the `REPO_INDEX` Vectorize index. Sets `vectorized_at`.
4. Click **"Deny"** (optional critique note) → verdict recorded, **no vectorize**.
5. Click **"Re-run analysis"** to wipe the verdict + vectorized_at and regenerate.

Two approval concepts, do not confuse them:

| Column | Table | Meaning |
|---|---|---|
| `admin_status` | `qualified_repos` | Pre-Pass-3 approval queue gate. Set via `PATCH /api/v1/admin/repos/:id`. |
| `admin_verdict` | `repo_engineering_signals` | Per-narrative verdict. Gates vectorization. Set via `/pass3/feedback`. |

### Finding a repo's D1 ID

- **URL**: `/admin/repos/:id` — the `:id` segment.
- **Queue API**: `GET /api/v1/admin/repos` returns `id` on each row.
- **D1 direct**: `./node_modules/.bin/wrangler d1 execute pipe-dev --local --command "SELECT id, full_name FROM qualified_repos WHERE full_name = 'owner/repo'"`

### Requeue (drop back to Pass 1)

Wipes all Pass-2 derived data (PRs, constructs, signals, complexity, stack, verdict) and resets `pass = 1, admin_status = 'pending'` so the next `--pass2` run picks it up again:

```
POST /api/v1/admin/repos/:id/requeue
```

---

## Documentation

Full documentation lives in [`docs/`](docs/README.md):
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system overview, file inventory, data model
- [`docs/design/design-system.md`](docs/design/design-system.md) — UI design language (Technical Terminal)
- [`docs/decisions/`](docs/decisions/) — Architectural Decision Records (ADRs)
- [`docs/STATUS.md`](docs/STATUS.md) — current project state

---

## License

Private — All Rights Reserved
