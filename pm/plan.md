# Plan: Agentic Work Flow + Rich Item Detail

## What we're building

Two things tightly coupled:

1. **▶ Run Agent** — trigger a Claude agentic session from any kanban card (task or bug), stream the output live, auto-update the ticket when done
2. **Rich item detail** — tabbed modal for both tasks and bugs with: Details | Work Log | Linked Docs

---

## Server changes (`server.js`)

### New function: `buildAgentPrompt(item, type, feature)`
Builds a targeted Claude prompt containing:
- Item title, description, BDD/steps to reproduce, severity/priority
- Feature context: route, component file path, sync note
- Linked docs list (ADRs, specs, etc.)
- Clear instruction to output a JSON block at the end: `{summary, nextStatus, filesChanged}`

### New endpoint: `POST /api/agent-run` (SSE)
Body: `{ type: 'task'|'bug', id, featureId }`

1. Load item from pm.json (task from `tasks[]`, bug from `feature.bugs[]`)
2. Set SSE headers
3. Spawn `claude -p <prompt> --dangerously-skip-permissions` in `REPO_PATH`
4. Stream stdout/stderr chunks as `{type:'output', text}` events
5. On process close:
   - Parse `{summary, nextStatus, filesChanged}` JSON from accumulated output
   - Append a `workUpdate` entry to the item (`{date, summary, agentRan:true, filesChanged, claudeOutput}`)
   - Apply `nextStatus` to the item's status field
   - Re-load and save pm.json (so any file changes Claude made are reflected)
   - Send `{type:'done', summary, nextStatus, filesChanged}` event

---

## Frontend changes (`index.html`)

### New component: `AgentRunModal`
Props: `{item, itemType, featureId, onClose, onDone}`

- On mount: `fetch('/api/agent-run', {method:'POST', ...})` + `response.body.getReader()` SSE loop (same pattern as `pageSync`)
- Renders a terminal-style streaming output panel (reuses `SyncTerminal` styling)
- Header: pulsing violet dot + "🤖 AGENT WORKING — {title}" → green "✓ DONE" when finished
- Footer: on done, shows parsed summary + files changed + new status
- Click-outside closes only when not running; ESC always kills + closes

### Replace `TaskModal` → enhanced tabbed version
Props: `{task, features, onSave, onClose, onRunAgent}`

**Header**: task ID + "▶ Run Agent" button (violet) → calls `onRunAgent(task, 'task', task.featureId)`

**3 tabs:**
- **Details** — all existing fields (title, brief, BDD, priority/status/route, due date, notes, subtasks) — unchanged content, just restructured
- **Work Log** — reverse-chronological `workUpdates[]` entries, each showing:
  - Date, "🤖 Agent" tag if `agentRan`, files-changed count
  - Summary text
  - `<details>` expander for full Claude output
  - Manual note add (Input + "+ Add" button)
- **Docs** — `linkedDocs[]` list with type badge (ADR/SPEC/FIGMA/LINK), title, optional clickable URL, remove button; "+ Add Doc / ADR" form with type select + title + URL

### New component: `BugModal`
Props: `{bug, feature, onSave, onClose, onRunAgent}`

Same tab structure as `TaskModal` but adapted for bug fields:
- **Details**: title, severity select, status (open/closed) select, description textarea, steps-to-reproduce textarea
- **Work Log**: identical to TaskModal
- **Docs**: identical to TaskModal

Header: 🐛 bug ID + severity/status tags + feature name tag + "▶ Run Agent" button

### Update `KanbanView`
New state:
- `agentModal` — `null | {item, itemType, featureId}` — drives `AgentRunModal`
- `openBug` — `null | {bug, feature}` — drives `BugModal`

New helper: `saveBug(updatedBug, featureId)` — patches `feature.bugs[]` via `POST /api/feature`, calls `onReload()`

Card changes:
- Bug cards: `onClick` finds the **original** bug from `data.features` (not the kanban-mapped version) and sets `openBug`
- All cards: small `▶` button in top-right corner → sets `agentModal` directly (bypasses detail modal)
- After agent run `onDone`: calls `onReload()` + clears `agentModal`

### Data model additions (no schema migration needed — pm.json is free-form)
Tasks gain:
```json
"workUpdates": [{ "date", "summary", "agentRan", "filesChanged", "claudeOutput" }],
"linkedDocs":  [{ "type", "title", "url" }]
```
Bugs (inside `feature.bugs[]`) gain the same two fields.

---

## What does NOT change
- Existing `BugsTab` within `RoutesView` (still works as the per-feature bug manager)
- Existing drag-and-drop kanban columns
- The bug-in-kanban fix from the previous session
- All other views (Overview, Routes, Lambdas, Data, Log)
