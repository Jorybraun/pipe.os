import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const HARNESS_DIR = '/root/.openclaw/workspace/pipe.os/.github/agents/harness';
const SWARM_DIR = path.join(HARNESS_DIR, '.swarm');
const TELEMETRY_FILE = path.join(SWARM_DIR, 'telemetry.jsonl');
const TASKS_DIR = path.join(SWARM_DIR, 'tasks');

/**
 * Bridge between PM Dashboard (Node.js) and Agent Harness (Python).
 *
 * Usage:
 *   const bridge = new HarnessBridge();
 *   bridge.startRun(taskId, description);
 *   const status = bridge.getRunStatus(taskId);
 */
export class HarnessBridge {
  constructor() {
    this.activeRuns = new Map();
    this._ensureDirs();
  }

  _ensureDirs() {
    fs.mkdirSync(TASKS_DIR, { recursive: true });
    fs.mkdirSync(path.join(SWARM_DIR, 'mailboxes'), { recursive: true });
  }

  /**
   * Start a harness run.
   * Returns immediately with { taskId, status: 'running' }.
   * Caller polls getRunStatus() for live updates.
   */
  startRun(taskId, taskDescription, repoPath = '/root/.openclaw/workspace/pipe.os', autoApprove = true, phase = 'all') {
    const taskFile = path.join(TASKS_DIR, `pm_${taskId}.json`);

    // Write task spec for harness
    const taskSpec = {
      task_id: taskId,
      description: taskDescription,
      repo_path: repoPath,
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(taskFile, JSON.stringify(taskSpec, null, 2));

    // Build harness args
    const args = [
      '-m', 'harness',
      '--task', taskDescription,
      '--repo', repoPath,
      '--phase', phase,
    ];
    if (autoApprove) args.push('--auto-approve');

    const proc = spawn('python3', args, {
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
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        const lastLine = lines[lines.length - 1];
        result = JSON.parse(lastLine);
      } catch (e) {
        result = {
          error: 'Failed to parse harness output',
          raw: stdout.slice(-2000),
          stderr,
          workflow_status: 'error',
        };
      }

      const run = this.activeRuns.get(taskId);
      if (run) {
        run.status = 'completed';
        run.exitCode = code;
        run.result = result;
        run.completedAt = Date.now();
      }
    });

    this.activeRuns.set(taskId, {
      process: proc,
      taskId,
      taskDescription,
      repoPath,
      startTime: Date.now(),
      status: 'running',
      result: null,
    });

    return { taskId, status: 'running' };
  }

  /**
   * Get live status of a harness run.
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
      events: events.slice(-30),
      result: run.result,
      duration: isComplete
        ? (run.completedAt - run.startTime) / 1000
        : (Date.now() - run.startTime) / 1000,
    };
  }

  readTelemetryEvents(taskId) {
    if (!fs.existsSync(TELEMETRY_FILE)) return [];

    const lines = fs.readFileSync(TELEMETRY_FILE, 'utf-8')
      .split('\n')
      .filter(l => l.trim());

    return lines
      .map(l => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(e => e && (!taskId || e.task_id === taskId));
  }

  getLatestPhase(events) {
    const phaseOrder = ['analysis', 'pm', 'design', 'architecture', 'implementation', 'qa', 'complete'];
    let latest = 'analysis';
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].event_type === 'phase_transition') {
        const p = events[i].details?.phase;
        if (p) { latest = p; break; }
      }
      if (events[i].event_type === 'task_started') {
        const p = events[i].details?.phase;
        if (p) { latest = p; break; }
      }
    }
    return latest;
  }

  getActiveAgents(events) {
    const agents = new Map();
    for (const e of events) {
      const role = e.details?.role || e.agent;
      if (!role) continue;

      if (e.event_type === 'agent_assigned') {
        agents.set(role, { role, status: 'assigned', since: e.timestamp });
      }
      if (e.event_type === 'agent_spawned') {
        agents.set(role, { role, status: 'running', since: e.timestamp });
      }
      if (e.event_type === 'agent_completed') {
        agents.set(role, {
          role,
          status: 'completed',
          since: e.timestamp,
          summary: e.details?.summary,
          changedFiles: e.details?.changed_files || [],
        });
      }
    }
    return Array.from(agents.values());
  }

  getPendingApprovals(events) {
    const approvals = [];
    for (const e of events) {
      if (e.event_type === 'approval_requested') {
        approvals.push({
          phase: e.details?.phase,
          content: e.details?.content,
          timestamp: e.timestamp,
        });
      }
      if (e.event_type === 'approval_granted' || e.event_type === 'approval_rejected') {
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

  getAllRuns() {
    return Array.from(this.activeRuns.values()).map(r => ({
      taskId: r.taskId,
      status: r.status,
      description: r.taskDescription,
      startTime: r.startTime,
      duration: r.status === 'completed'
        ? (r.completedAt - r.startTime) / 1000
        : (Date.now() - r.startTime) / 1000,
    }));
  }
}
