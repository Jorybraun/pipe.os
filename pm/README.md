# PIPE PM — Standalone Project Management

Auto-syncing PM dashboard for Pipe OS. Reads git commits, uses Mistral AI to analyze changes, and keeps feature status up-to-date.

## Quick Start

### 1. Install dependencies

```bash
cd /Users/hans/Code/PIPE/pm
npm install
```

### 2. Set up environment

Check `.env` — it should have your `MISTRAL_API_KEY` already.

```
MISTRAL_API_KEY=your_key_here
PM_DATA_FILE=pm.json
GIT_REPO_PATH=../PIPE-OS
```

### 3. Initialize

```bash
npm run pm:init
```

Creates `pm.json` with seed features from Pipe OS.

### 4. Run first sync

```bash
npm run pm:sync
```

Scans git commits in ../PIPE-OS since last sync, asks Mistral to analyze them, updates feature status.

## Commands

```bash
npm run pm:sync          # Scan commits, analyze with Mistral, update status
npm run pm:status        # Show feature table, open bugs, pending requests
npm run pm:bug <id> <title> --severity P1     # Log a bug
npm run pm:request <id> <title> --priority P2 # Log a request
npm run pm:init          # Reinitialize pm.json
```

## How It Works

1. **Scanner** reads git log since last sync
2. **Mistral** analyzes each commit to determine:
   - Which feature(s) it touches
   - Type: bugfix, feature, refactor, docs, chore
   - Severity if bugfix (P0, P1, P2, P3)
3. **Status Inference** determines feature status based on:
   - Open P0/P1 bugs → broken
   - Open P2 bugs → partial
   - No recent commits → stale
   - Frequent commits → in_progress
4. **pm.json** updated with work log + feature status
5. **CLI displays** formatted status table

## Data Structure

```json
{
  "features": [
    {
      "id": "feat-001",
      "name": "Pipeline Creation",
      "status": "working",
      "bugs": [
        {
          "id": "bug-001",
          "title": "Form validation error",
          "status": "open",
          "severity": "P1"
        }
      ],
      "requests": [...]
    }
  ],
  "workLog": [
    {
      "date": "2026-03-25",
      "commit": "abc123",
      "summary": "Fixed form validation",
      "featuresImpacted": ["feat-001"],
      "autoDetected": true
    }
  ],
  "lastSync": "2026-03-25T14:30:00Z"
}
```

## Next Phase

Phase 2 adds:
- Web dashboard (http://localhost:3333)
- [SYNC NOW] button to trigger sync from dashboard
- Real-time progress updates
- API endpoints

## Costs

~$0.01 per sync (Mistral small model, ~50 commits per sync, ~10K tokens).

---

**Phase 1 Complete!** Ready to test and then build Phase 2.
