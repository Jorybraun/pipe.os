# PM Dashboard Specification

## Overview

A **standalone project management system** that lives in `/pm/` (sibling to PIPE-OS) and auto-syncs feature status, bugs, and requests by:
- Scanning git commits and code changes
- Using Mistral AI to analyze diffs and infer feature status
- Storing data in local JSON files
- Providing a CLI to sync and view status
- Offering a lightweight web dashboard

**Key philosophy:** Write once (via git/comments), read everywhere (dashboard auto-updates).

---

## Architecture

### File Structure

```
/Users/hans/Code/PIPE/
├── PIPE-OS/                    (the app)
└── pm/                         (PM system)
    ├── .env                    (MISTRAL_API_KEY)
    ├── pm.json                 (main data file)
    ├── cli.js                  (node CLI entry point)
    ├── scanner.js              (git + codebase scanner)
    ├── mistral-analyzer.js     (Mistral integration)
    ├── server.js               (lightweight dashboard)
    ├── utils.js                (helpers)
    ├── package.json
    └── SPEC.md                 (this file)
```

### Core Data Model (`pm.json`)

```json
{
  "features": [
    {
      "id": "feat-001",
      "name": "Pipeline Creation",
      "route": "/pipeline/new",
      "status": "working",
      "lastChecked": "2026-03-25T14:30:00Z",
      "component": "PipelineCreatePage.tsx",
      "journeys": [
        {
          "name": "Create with template",
          "status": "working",
          "bdd": "Given recruiter on /pipeline/new\nWhen select DEFAULT\nThen form prefills"
        }
      ],
      "bugs": [
        {
          "id": "bug-001",
          "title": "Form doesn't validate email",
          "status": "open",
          "severity": "P1",
          "logged": "2026-03-24",
          "notes": "Email field allows invalid formats"
        }
      ],
      "requests": [
        {
          "id": "req-001",
          "title": "Add duplicate pipeline button",
          "status": "proposed",
          "logged": "2026-03-23",
          "priority": "P2"
        }
      ]
    }
  ],
  "workLog": [
    {
      "date": "2026-03-25",
      "commit": "abc123",
      "summary": "Fixed Pipeline form validation",
      "tags": ["bugfix", "pipeline"],
      "featuresImpacted": ["feat-001"],
      "autoDetected": true
    }
  ],
  "lastSync": "2026-03-25T14:30:00Z"
}
```

---

## CLI Commands

### 1. **Sync Status** (button in dashboard OR CLI)

**Via Dashboard (preferred):**
```
Dashboard shows: "Last synced: 2 hours ago"
Click: [SYNC NOW] button
→ Sends POST /api/sync
→ Server runs scanner + analyzer
→ Dashboard shows progress: "Scanning commits... Analyzing with Mistral..."
→ Auto-updates when complete
```

**Via CLI (fallback):**
```bash
npm run pm:sync
# OR
node pm/cli.js sync

# Output:
# ✓ Scanned 15 commits since last sync
# ✓ Detected changes in PipelineCreatePage.tsx
# ✓ Updated feature status: feat-001 → working
# ✓ Saved to pm/pm.json
```

**What happens:**
1. Read git log since last sync
2. For each commit, extract: message, files changed, diff
3. Send to Mistral: "Analyze this commit. What feature did it touch? Was it a bugfix, feature, or refactor?"
4. Mistral returns: `{ feature: "feat-001", type: "bugfix", summary: "..." }`
5. Update pm.json with new status
6. If via dashboard: stream progress to client in real-time

### 2. **View Status** (display in terminal)

```bash
npm run pm:status
# OR
node pm/cli.js status

# Output:
# FEATURES
# ✓ Pipeline Creation (working)      - 15 journeys, 1 bug open
# ✓ Candidate Assessment (working)   - 8 journeys, 0 bugs
# ⚠ Challenge Editor (broken)        - 2 journeys, 3 bugs open
#
# NEXT TASKS
# 1. Fix Challenge Editor IAM (P0)
# 2. Add email validation to form (P1)
# 3. Duplicate pipeline button (P2)
```

### 3. **Log Bug** (add to feature)

```bash
npm run pm:bug "feat-001" "Form doesn't validate email" --severity P1

# Updates pm.json[features[0].bugs] with new entry
```

### 4. **Log Request** (add feature request)

```bash
npm run pm:request "feat-001" "Add duplicate pipeline button" --priority P2

# Updates pm.json[features[0].requests] with new entry
```

### 5. **Dashboard** (web view with live sync)

```bash
npm run pm:dashboard
# Starts http://localhost:3333
# Shows: Features table, Bugs list, Requests backlog, Work log
# + [SYNC NOW] button that triggers real-time update
```

---

## Mistral Integration

### Commit Analysis Prompt

```
You are a code change analyzer. Given a git commit (message, files, diff), determine:
1. Which feature it touches (match to feature name or "unknown")
2. Type: bugfix, feature, refactor, docs, chore
3. Brief summary (1 line)
4. Severity if bugfix: P0, P1, P2, P3

Commit:
Message: "Fix Pipeline form validation"
Files: PipelineCreatePage.tsx
Diff: [truncated for brevity]

Respond as JSON: { feature: "Pipeline Creation", type: "bugfix", summary: "...", severity: "P1" }
```

### Status Inference Prompt

```
You are a feature status analyzer. Given a feature definition and recent commits/code patterns, determine status:
- working: Feature is complete and no open bugs
- partial: Feature partially implemented
- broken: Feature exists but has critical bugs (P0/P1)
- missing: Feature not yet implemented
- blocked: Feature depends on something else

Feature: { name: "Challenge Editor", component: "ChallengeEditorPage.tsx", bugs: [...], requests: [...], recentCommits: [...] }

Respond as JSON: { status: "broken", reason: "3 open P1 bugs blocking editor access", recommendedFix: "..." }
```

---

## Key Features

### 1. **Auto-detect Status Changes**

Every `pm:sync` call:
- Reads new commits
- Asks Mistral: "What changed and why?"
- Updates feature status based on:
  - Open bugs (P0/P1 → "broken", P2 → "partial", P3 → "working")
  - Recent commits (frequent commits → "in_progress")
  - Code patterns (feature flag enabled → "working")

### 2. **Manual Overrides**

```bash
npm run pm:status-override feat-001 --status broken --reason "awaiting client feedback"
# Marks feature as manually set; won't auto-update until cleared
```

### 3. **Bug/Request Attachment**

Every bug and request links to a feature:
```json
{
  "id": "bug-001",
  "title": "Form validation error",
  "feature": "feat-001",
  "severity": "P1",
  "linkedIssue": "https://github.com/.../issues/123",
  "linkedCommit": "abc123"
}
```

### 4. **Work Log Auto-Population**

Every sync creates work log entries:
```json
{
  "date": "2026-03-25",
  "commit": "abc123",
  "summary": "Fixed Pipeline form validation",
  "featuresImpacted": ["feat-001"],
  "autoDetected": true,
  "mistralAnalysis": {
    "type": "bugfix",
    "severity": "P1"
  }
}
```

---

## Dashboard UI (Web)

Simple HTML/CSS/JS view showing:

**Header:**
```
PIPE PM COMMAND CENTER
Last synced: 2 hours ago  [SYNC NOW] ← Click to trigger sync from dashboard
```

**Tab 1: Features**
```
Name              Route                    Status    Journeys  Bugs  Requests
─────────────────────────────────────────────────────────────────────────────
Pipeline Creation /pipeline/new            ✓ working    3       1       0
Assessment        /assess/:token           ✓ working    8       0       0
Challenge Editor  /pipeline/.../challenges ⚠ broken     2       3       1
```

**Tab 2: Bugs (filtered by priority)**
```
[P0] Form validation error (feat-001) — 2 days old
[P1] Timer resets on page refresh (feat-002) — 5 days old
[P2] Missing error message (feat-001) — 1 day old
```

**Tab 3: Feature Requests**
```
Duplicate pipeline button (feat-001) — proposed, P2
Export candidate PDF (feat-003) — proposed, P2
Dark mode (unassigned) — proposed, P3
```

**Tab 4: Work Log**
```
2026-03-25  Fixed Pipeline form validation            [feat-001] bugfix
2026-03-24  Add challenge picker modal                [feat-002] feature
2026-03-23  Refactor: extract scoring logic           [feat-003] refactor
```

**Sync Progress (when syncing):**
```
[████████░░░░░░░░░] Scanning commits...
or
[██████████████░░░] Analyzing with Mistral...
or
[████████████████████] Complete! Updated 3 features.
```

---

## Implementation Approach

### Phase 1: Core (1-2 hours)

1. **Scanner** (`scanner.js`)
   - Read git log: `git log --oneline --since="..." --name-only`
   - Extract commit message, files changed, timestamps
   - Build list of commits since `lastSync`

2. **Mistral analyzer** (`mistral-analyzer.js`)
   - Call Mistral API with commit data
   - Parse JSON responses
   - Map feature → status changes

3. **CLI sync** (`cli.js sync`)
   - Load `pm.json`
   - Call scanner + analyzer
   - Update features based on results
   - Save `pm.json`

### Phase 2: Dashboard + API Server (1.5 hours)

4. **Server with API** (`server.js`)
   - Node.js HTTP server
   - Serve static HTML + CSS
   - **API endpoint: POST /api/sync** → runs scanner + analyzer, streams progress
   - **API endpoint: GET /api/data** → returns current `pm.json`
   - **WebSocket (optional)**: Real-time progress updates during sync
   - Read `pm.json` and render tables
   - No hot reload needed

### Phase 3: Bug/Request Logging (30 min)

5. **CLI commands** (`cli.js bug`, `cli.js request`)
   - Append to `pm.json`
   - Optional: link to GitHub issue

---

## Technology Stack

| Component | Choice | Why |
|-----------|--------|-----|
| CLI | Node.js + Yargs | Simple, no build needed |
| Data | JSON | Git-friendly, version control |
| Sync Logic | Node git APIs | Read commits, detect changes |
| AI Analysis | Mistral API | Smart pattern detection |
| Dashboard | HTML + Vanilla JS | Lightweight, no frontend build |
| Server | Node.js http | Minimal dependencies |

---

## Success Criteria

- [ ] `pm:sync` runs in < 10 sec (even on first run)
- [ ] Dashboard loads instantly (static files)
- [ ] Can log a bug in 1 command
- [ ] Feature status auto-updates when you commit
- [ ] Works offline (Mistral calls cached/batched)
- [ ] `pm.json` is human-readable and git-friendly
- [ ] No dependencies on Pipe app structure

---

## Constraints & Trade-offs

**Pro:**
- ✅ No Amplify/AWS dependency
- ✅ Works offline (mostly)
- ✅ Data lives in git (versionable)
- ✅ Lightweight, fast
- ✅ Uses Mistral for intelligence

**Con:**
- ⚠️ Manual schema changes (add new feature → edit pm.json)
- ⚠️ Mistral API costs (but minimal, ~$0.01 per sync)
- ⚠️ Can't collaborate on bugs in real-time (it's local JSON)

---

## Next Steps

1. Initialize `/pm` with `package.json` and `.env`
2. Implement Phase 1: Scanner + Mistral integration + CLI sync
3. Test with existing PIPE-OS commits
4. Bootstrap initial `pm.json` from CLAUDE.md + git log
5. Add Phase 2 (dashboard) once sync is solid

Ready to start building?
