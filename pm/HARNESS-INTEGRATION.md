# PM Dashboard ↔ Harness Integration Guide

## File Paths (Actual)

- PM Dashboard: `/root/.openclaw/workspace/pipe.os/pm/`
- Harness Skill: `/root/.openclaw/workspace/pipe.os/.github/agents/harness/harness/`
- Harness Entry: `harness/__init__.py` — provides `run(task, repo_path, auto_approve, phase)`
- Telemetry: `.github/agents/harness/.swarm/telemetry.jsonl`
- Mailboxes: `.github/agents/harness/.swarm/mailboxes/{role}.json`
- State: `.github/agents/harness/.swarm/state.json`

## Harness API Contract

### 1. Direct Python Import (for in-process use)

```python
from harness import run
result = run(
    task="Implement login page",
    repo_path="/root/.openclaw/workspace/pipe.os",
    auto_approve=False,
    phase="all"   # or "pm", "design", "architecture", "implementation", "qa"
)
```

Returns:
```json
{
  "workflow_status": "complete|rejected_at_pm|rejected_at_design|failed_qa|...",
  "approvals": 3,
  "qa_results": {
    "tsc_passed": true,
    "no_any_types": true,
    "named_exports": true,
    "changelog_updated": true,
    "overall": true,
    "errors": []
  },
  "telemetry_summary": {
    "events": 12,
    "agents": ["pm", "designer", "backend", "frontend", "qa"],
    "duration": 145.2
  },
  "changed_files": ["src/pages/Login.tsx", "amplify/functions/login/handler.ts"]
}
```

### 2. CLI Mode (for subprocess spawn)

```bash
cd /root/.openclaw/workspace/pipe.os/.github/agents/harness
python3 -m harness --task "Fix imports" --repo /root/.openclaw/workspace/pipe.os --json
```

The `--json` flag outputs machine-readable JSON to stdout.

### 3. Telemetry Events (telemetry.jsonl)

Append-only JSONL format:
```json
{"timestamp": "2026-04-25T04:35:52.815701+00:00", "task_id": "945b4ac8", "event_type": "task_started", "details": {"task": "test harness telemetry", "phase": "analysis"}}
{"timestamp": "...", "task_id": "...", "event_type": "phase_transition", "details": {"phase": "pm", "action": "..."}}
{"timestamp": "...", "task_id": "...", "event_type": "agent_assigned", "details": {"role": "backend", "task_file": "...", "result_file": "..."}}
{"timestamp": "...", "task_id": "...", "event_type": "agent_spawned", "details": {"role": "backend"}}
{"timestamp": "...", "task_id": "...", "event_type": "agent_completed", "details": {"role": "backend", "summary": "...", "changed_files": []}}
{"timestamp": "...", "task_id": "...", "event_type": "approval_requested", "details": {"phase": "design", "content": "..."}}
{"timestamp": "...", "task_id": "...", "event_type": "approval_granted", "details": {"phase": "design"}}
{"timestamp": "...", "task_id": "...", "event_type": "quality_gate_passed", "details": {"gate": "tsc"}}
{"timestamp": "...", "task_id": "...", "event_type": "workflow_complete", "details": {"status": "complete"}}
```

Event types to handle:
- `task_started` — harness began processing
- `phase_transition` — moved to new phase (analysis, pm, design, architecture, implementation, qa, complete)
- `agent_assigned` — agent assigned a task, but not yet spawned
- `agent_spawned` — agent is now running
- `agent_completed` — agent finished
- `approval_requested` — waiting for human approval
- `approval_granted` / `approval_rejected` / `approval_revise` — approval response
- `quality_gate_passed` / `quality_gate_failed` — QA results
- `workflow_complete` / `workflow_rejected` — final state

### 4. Live Agent Status (Mailboxes)

Per-role JSON files in `.swarm/mailboxes/{role}.json`:
```json
{
  "role": "backend",
  "current_task": {
    "task_id": "backend_20260425_124414",
    "role": "backend",
    "description": "Implement server-side logic for: ...",
    "files_to_modify": [],
    "acceptance_criteria": [...],
    "context": {...}
  },
  "status": "assigned|in_progress|complete|error",
  "progress": [
    {"timestamp": 1777092254.337209, "percent": 50, "message": "Writing handler.ts", "files_touched": [...]}
  ],
  "result": {
    "success": true,
    "summary": "...",
    "changed_files": [...],
    "errors": []
  },
  "last_heartbeat": 1777092254.337209
}
```

## Architecture: How PM Calls Harness

```
PM Dashboard (Node.js)                Harness (Python)
  │                                        │
  │ POST /api/harness-run                  │
  │ {taskId, taskTitle, description}       │
  ├───────────────────────────────────────>│
  │                                        │ spawn python3 harness
  │                                        │ (returns immediately with state)
  │                                        │
  │  SSE stream:                           │
  │  {type:"phase", phase:"pm"}           │
  │  {type:"agent", role:"backend"}         │
  │  {type:"approval", phase:"design"}      │
  │  {type:"qa", gate:"tsc", passed:true} │
  │  {type:"complete", result:{...}}       │
  │<────────────────────────────────────────│ poll telemetry.jsonl
  │                                        │ every 2-3 seconds
```

### Key Design Decisions

1. **Harness runs in subprocess**, not inline. It can take 5-30 minutes.
2. **PM polls telemetry.jsonl** while harness runs, not the other way around.
3. **Approval gates pause the harness** — PM dashboard should show a UI to approve/reject, then write an approval signal back (or restart harness with `--auto-approve`).
4. **Each harness run gets a task_id** — use this to correlate telemetry events.
5. **Results sync back to pm.json workLog** when complete.

## What to Build

### 1. `harness-bridge.js` (new file)

Node.js module that:
- Spawns `python3 -m harness` as a child process
- Captures stdout for the final JSON result
- Provides a polling interface for telemetry.jsonl
- Tracks which harness run belongs to which PM task

```javascript
// harness-bridge.js
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const HARNESS_DIR = '/root/.openclaw/workspace/pipe.os/.github/agents/harness';
const SWARM_DIR = path.join(HARNESS_DIR, '.swarm');
const TELEMETRY_FILE = path.join(SWARM_DIR, 'telemetry.jsonl');

export class HarnessBridge {
  constructor() {
    this.activeRuns = new Map(); // taskId -> {process, taskData, startTime}
  }

  /**
   * Start a harness run for a task.
   * Returns immediately. The caller polls getRunStatus() for updates.
   */
  startRun(taskId, taskDescription, repoPath = '/root/.openclaw/workspace/pipe.os') {
    const taskFile = path.join(SWARM_DIR, 'tasks', `pm_${taskId}.json`);
    
    // Write task spec for harness to read
    const taskSpec = {
      task_id: taskId,
      description: taskDescription,
      repo_path: repoPath,
      created_at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, JSON.stringify(taskSpec, null, 2));

    // Spawn harness
    const proc = spawn('python3', ['-m', 'harness',
      '--task', taskDescription,
      '--repo', repoPath,
      '--json'
    ], {
      cwd: HARNESS_DIR,
      env: { ...process.env, PYTHONPATH: HARNESS_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => stdout += chunk);
    proc.stderr.on('data', chunk => stderr += chunk);

    proc.on('close', (code) => {
      let result = null;
      try {
        // Parse the JSON result from the last non-empty line
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        const lastLine = lines[lines.length - 1];
        result = JSON.parse(lastLine);
      } catch (e) {
        result = { error: 'Failed to parse harness output', raw: stdout.slice(-2000), stderr };
      }
      this.activeRuns.set(taskId, {
        ...this.activeRuns.get(taskId),
        status: 'completed',
        exitCode: code,
        result,
        completedAt: Date.now(),
      });
    });

    this.activeRuns.set(taskId, {
      process: proc,
      taskId,
      taskDescription,
      startTime: Date.now(),
      status: 'running',
      result: null,
    });

    return { taskId, status: 'running' };
  }

  /**
   * Get current status of a harness run.
   * Reads telemetry.jsonl to build a live picture.
   */
  getRunStatus(taskId) {
    const run = this.activeRuns.get(taskId);
    if (!run) return null;

    const events = this.readTelemetryEvents(taskId);
    const latestPhase = this.getLatestPhase(events);
    const activeAgents = this.getActiveAgents(events);
    const pendingApprovals = this.getPendingApprovals(events);
    const qaResults = this.getQAResults(events);
    const isComplete = run.status === 'completed';

    return {
      taskId,
      status: isComplete ? 'completed' : 'running',
      phase: latestPhase,
      agents: activeAgents,
      pendingApprovals,
      qaResults,
      events: events.slice(-20), // Last 20 events for UI
      result: run.result,
      duration: isComplete 
        ? (run.completedAt - run.startTime) / 1000 
        : (Date.now() - run.startTime) / 1000,
    };
  }

  readTelemetryEvents(taskId) {
    if (!fs.existsSync(TELEMETRY_FILE)) return [];
    const lines = fs.readFileSync(TELEMETRY_FILE, 'utf-8').split('\n').filter(l => l.trim());
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(e => e && (!taskId || e.task_id === taskId));
  }

  getLatestPhase(events) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].event_type === 'phase_transition') {
        return events[i].details?.phase || 'unknown';
      }
      if (events[i].event_type === 'task_started') {
        return events[i].details?.phase || 'analysis';
      }
    }
    return 'analysis';
  }

  getActiveAgents(events) {
    const agents = new Map();
    for (const e of events) {
      if (e.event_type === 'agent_spawned' || e.event_type === 'agent_assigned') {
        const role = e.details?.role || e.agent;
        agents.set(role, { role, status: 'running', since: e.timestamp });
      }
      if (e.event_type === 'agent_completed') {
        const role = e.details?.role || e.agent;
        agents.set(role, { role, status: 'completed', since: e.timestamp, summary: e.details?.summary });
      }
    }
    return Array.from(agents.values());
  }

  getPendingApprovals(events) {
    const approvals = [];
    for (const e of events) {
      if (e.event_type === 'approval_requested') {
        approvals.push({ phase: e.details?.phase, content: e.details?.content });
      }
      if (e.event_type === 'approval_granted' || e.event_type === 'approval_rejected') {
        // Remove the matching pending approval
        const idx = approvals.findIndex(a => a.phase === e.details?.phase);
        if (idx >= 0) approvals.splice(idx, 1);
      }
    }
    return approvals;
  }

  getQAResults(events) {
    const results = {};
    for (const e of events) {
      if (e.event_type === 'quality_gate_passed') {
        results[e.details?.gate] = { passed: true };
      }
      if (e.event_type === 'quality_gate_failed') {
        results[e.details?.gate] = { passed: false, error: e.details?.error };
      }
    }
    return results;
  }

  killRun(taskId) {
    const run = this.activeRuns.get(taskId);
    if (run && run.process) {
      run.process.kill();
      run.status = 'killed';
    }
  }
}
```

### 2. `server.js` Changes

Add these endpoints after the existing routes:

```javascript
import { HarnessBridge } from './harness-bridge.js';
const harnessBridge = new HarnessBridge();

// ──────────────────────────────────────────────────────────
// HARNESS ENDPOINTS
// ──────────────────────────────────────────────────────────

// Start a harness run for a task
else if (req.url === '/api/harness-run' && req.method === 'POST') {
  const body = await parseBody(req);
  const { taskId, taskType, description, featureId } = body;
  
  const run = harnessBridge.startRun(taskId, description || body.title);
  jsonRes(res, { ok: true, taskId, harnessTaskId: run.taskId, status: 'running' });
}

// Get live status of a harness run
else if (req.url?.startsWith('/api/harness-status/') && req.method === 'GET') {
  const harnessTaskId = req.url.split('/').pop();
  const status = harnessBridge.getRunStatus(harnessTaskId);
  if (!status) { jsonRes(res, { error: 'Run not found' }, 404); return; }
  jsonRes(res, status);
}

// SSE stream for live harness status
else if (req.url?.startsWith('/api/harness-stream/') && req.method === 'GET') {
  const harnessTaskId = req.url.split('/').pop();
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  
  // Send initial status
  const initial = harnessBridge.getRunStatus(harnessTaskId);
  if (!initial) { send({ type: 'error', text: 'Run not found' }); res.end(); return; }
  send({ type: 'status', ...initial });

  // Poll every 3 seconds
  const interval = setInterval(() => {
    const status = harnessBridge.getRunStatus(harnessTaskId);
    if (!status) { send({ type: 'error', text: 'Run lost' }); clearInterval(interval); res.end(); return; }
    
    send({ type: 'status', ...status });
    
    if (status.status === 'completed') {
      send({ type: 'complete', result: status.result });
      clearInterval(interval);
      res.end();
    }
  }, 3000);

  res.on('close', () => clearInterval(interval));
}

// Sync harness results back to PM work log
else if (req.url === '/api/harness-sync' && req.method === 'POST') {
  const body = await parseBody(req);
  const { taskId, harnessTaskId, taskType, featureId } = body;
  
  const status = harnessBridge.getRunStatus(harnessTaskId);
  if (!status || status.status !== 'completed') {
    jsonRes(res, { error: 'Harness run not complete' }, 400); return;
  }

  const pmData = loadPMData(PM_FILE);
  const workEntry = {
    date: new Date().toISOString().split('T')[0],
    summary: `Harness: ${status.result?.workflow_status || 'unknown'} — ${status.phase}`,
    agentRan: true,
    filesChanged: status.result?.changed_files || [],
    harnessResult: status.result,
    harnessEvents: status.events,
    harnessDuration: status.duration,
  };

  // Update the task or bug
  if (taskType === 'task') {
    const task = pmData.tasks.find(t => t.id === taskId);
    if (task) {
      task.workUpdates = task.workUpdates || [];
      task.workUpdates.push(workEntry);
      // Auto-update status based on harness result
      if (status.result?.workflow_status === 'complete') task.status = 'done';
      else if (status.result?.workflow_status?.includes('rejected')) task.status = 'blocked';
    }
  } else if (taskType === 'bug') {
    const feature = pmData.features.find(f => f.id === featureId);
    const bug = feature?.bugs?.find(b => b.id === taskId);
    if (bug) {
      bug.workUpdates = bug.workUpdates || [];
      bug.workUpdates.push(workEntry);
      if (status.result?.workflow_status === 'complete') bug.status = 'closed';
    }
  }

  pmData.workLog.push({
    date: workEntry.date,
    summary: workEntry.summary,
    tags: ['harness', taskType, status.phase],
    harnessTaskId,
    autoDetected: false,
  });

  savePMData(PM_FILE, pmData);
  jsonRes(res, { ok: true, workEntry });
}
```

### 3. `index.html` Changes

Replace the `AgentRunModal` with a `HarnessRunModal` that shows:
- Current phase (analysis → pm → design → architecture → implementation → qa → complete)
- Active agents with status
- Approval gates with Approve/Reject buttons
- QA gate results (tsc, no-any, named-exports, changelog)
- Final result

```javascript
function HarnessRunModal({item, itemType, featureId, onClose, onDone}) {
  const [harnessTaskId, setHarnessTaskId] = useState(null);
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    // Start harness run
    fetch('/api/harness-run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ taskId: item.id, taskType: itemType, description: item.title || item.brief, featureId })
    })
    .then(r => r.json())
    .then(data => {
      setHarnessTaskId(data.harnessTaskId);
      // Open SSE stream
      const es = new EventSource(`/api/harness-stream/${data.harnessTaskId}`);
      es.onmessage = (e) => {
        const ev = JSON.parse(e.data);
        if (ev.type === 'status') {
          setStatus(ev);
          setEvents(ev.events || []);
        }
        if (ev.type === 'complete') {
          setRunning(false);
          es.close();
          // Sync results back to PM
          fetch('/api/harness-sync', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ taskId: item.id, harnessTaskId: data.harnessTaskId, taskType: itemType, featureId })
          }).then(() => onDone());
        }
      };
    });
  }, []);

  // Render phases, agents, approvals, QA results
  // ... (UI similar to existing AgentRunModal but with phase pipeline visualization)
}
```

### 4. `knowledge-sync.js` (new file)

```javascript
import fs from 'fs';
import path from 'path';

const KNOWLEDGE_DIR = '/root/.openclaw/workspace/pipe.os/knowledge/plan';

export function syncKnowledgePlan(pmData) {
  const current = fs.readFileSync(path.join(KNOWLEDGE_DIR, 'current.md'), 'utf-8');
  
  // Extract active tasks from current.md
  const tasks = [];
  const activeMatch = current.match(/## Active\n([\s\S]*?)(?=\n## |$)/);
  if (activeMatch) {
    const lines = activeMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
    for (const line of lines) {
      const title = line.replace(/^-\s*/, '').trim();
      if (!title) continue;
      const existing = pmData.tasks.find(t => t.title === title && t.source === 'knowledge');
      if (!existing) {
        tasks.push({
          id: `K-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          title,
          brief: `From knowledge/plan/current.md: ${title}`,
          priority: 'P1',
          status: 'todo',
          source: 'knowledge',
          tags: ['knowledge-plan'],
        });
      }
    }
  }
  
  // Extract blockers as high-priority tasks
  const blockersMatch = current.match(/## Blockers\n([\s\S]*?)(?=\n## |$)/);
  if (blockersMatch) {
    const lines = blockersMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
    for (const line of lines) {
      const title = line.replace(/^-\s*/, '').trim();
      if (!title || title.toLowerCase() === 'none.') continue;
      const existing = pmData.tasks.find(t => t.title === title && t.source === 'knowledge');
      if (!existing) {
        tasks.push({
          id: `K-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          title,
          brief: `BLOCKER from knowledge/plan/current.md: ${title}`,
          priority: 'P0',
          status: 'blocked',
          source: 'knowledge',
          tags: ['knowledge-plan', 'blocker'],
        });
      }
    }
  }
  
  return tasks;
}
```

## Approval Gate Handling

The harness `auto_approve=False` pauses at each approval gate and waits for stdin input. Since PM dashboard runs harness as a subprocess without a TTY, you have two options:

**Option A: Auto-approve mode**
Start harness with `--auto-approve`. The harness never pauses. Dashboard just shows phases as they complete.

**Option B: Interactive approval**
1. Start harness without `--auto-approve`
2. When harness outputs `APPROVAL GATE: design` and waits for input, the subprocess blocks
3. Dashboard detects this via telemetry (approval_requested event)
4. Dashboard shows Approve/Reject UI
5. On user action, write `"approved\n"` or `"rejected\n"` to the subprocess stdin
6. Harness continues

**Recommended: Option A for now.** Add a dashboard toggle for auto-approve. When false, show the approval UI based on telemetry events, but still use `--auto-approve` to avoid subprocess stdin complexity. In a future iteration, switch to true interactive mode.

## Phase Display Order

```
analysis → pm → design → architecture → implementation → qa → complete
```

Show a horizontal pipeline with each phase as a step. Active phase highlighted. Completed phases green. Failed/red phases red. Pending approvals shown as a pause icon.

## Implementation Checklist

- [ ] Create `harness-bridge.js` with `HarnessBridge` class
- [ ] Add `/api/harness-run` endpoint to `server.js`
- [ ] Add `/api/harness-status/:id` endpoint
- [ ] Add `/api/harness-stream/:id` SSE endpoint
- [ ] Add `/api/harness-sync` endpoint for writing results to pm.json
- [ ] Replace `AgentRunModal` in `index.html` with `HarnessRunModal`
- [ ] Add phase pipeline visualization to harness modal
- [ ] Add `knowledge-sync.js` and `/api/knowledge-sync` endpoint
- [ ] Add "Sync from /knowledge/plan" button to Overview tab
- [ ] Test end-to-end: create task → run harness → watch phases → verify work log entry

## Notes for Desktop

1. Keep the old `/api/agent-run` as fallback for backward compatibility.
2. The harness takes time. The SSE stream must stay alive for minutes.
3. Don't parse the subprocess stdout for live updates — only for final JSON. Use telemetry.jsonl for live status.
4. Kill the subprocess if the user closes the modal (res.on('close') → proc.kill()).
5. The telemetry file grows. Only read lines matching the current task_id.
