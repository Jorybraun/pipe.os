import fs from 'fs';
import path from 'path';

const HARNESS_DIR = '/root/.openclaw/workspace/pipe.os/.github/agents/harness';
const SWARM_DIR = path.join(HARNESS_DIR, '.swarm');
const TELEMETRY_FILE = path.join(SWARM_DIR, 'telemetry.jsonl');
const STATE_FILE = path.join(SWARM_DIR, 'state.json');
const MAILBOXES_DIR = path.join(SWARM_DIR, 'mailboxes');

/**
 * Read-only observer of harness telemetry.
 *
 * The harness is triggered externally (OpenClaw agent session, CLI, etc).
 * This bridge just reads .swarm/ state and formats it for the dashboard.
 */
export class HarnessBridge {
  constructor() {
    this._cache = new Map();
    this._cacheTTL = 2000; // ms
  }

  _readJSON(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch { return null; }
  }

  /**
   * List all harness runs found in .swarm/ state.
   */
  listRuns() {
    const runs = [];

    // From state.json
    const state = this._readJSON(STATE_FILE);
    if (state && state.task_id) {
      runs.push({
        taskId: state.task_id,
        phase: state.phase,
        status: state.status,
        updatedAt: state.updated_at,
      });
    }

    // From telemetry (latest task_id)
    const events = this.readTelemetryEvents();
    const taskIds = [...new Set(events.map(e => e.task_id).filter(Boolean))];
    for (const tid of taskIds) {
      if (runs.find(r => r.taskId === tid)) continue;
      const taskEvents = events.filter(e => e.task_id === tid);
      const latest = taskEvents[taskEvents.length - 1];
      runs.push({
        taskId: tid,
        phase: this._getLatestPhase(taskEvents),
        status: latest?.event_type === 'workflow_complete' ? 'completed'
          : latest?.event_type === 'workflow_rejected' ? 'rejected'
          : 'running',
        updatedAt: latest?.timestamp,
      });
    }

    return runs.sort((a, b) => (b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1);
  }

  /**
   * Get status of a harness run by reading .swarm/ directly.
   */
  getRunStatus(taskId) {
    const state = this._readJSON(STATE_FILE);
    const events = this.readTelemetryEvents(taskId);
    const mailboxes = this.readMailboxes();

    const latestPhase = this._getLatestPhase(events);
    const activeAgents = this._getActiveAgents(events, mailboxes);
    const pendingApprovals = this._getPendingApprovals(events);
    const qaResults = this._getQAResults(events);

    const isComplete = state?.status === 'complete'
      || events.some(e => e.event_type === 'workflow_complete')
      || events.some(e => e.event_type === 'workflow_rejected');

    const isRejected = state?.status === 'rejected'
      || events.some(e => e.event_type === 'workflow_rejected');

    // Calculate duration from events
    let duration = 0;
    if (events.length >= 2) {
      const first = new Date(events[0].timestamp).getTime();
      const last = new Date(events[events.length - 1].timestamp).getTime();
      duration = (last - first) / 1000;
    }

    return {
      taskId,
      status: isComplete ? (isRejected ? 'rejected' : 'completed') : 'running',
      phase: latestPhase,
      agents: activeAgents,
      pendingApprovals,
      qaResults,
      events: events.slice(-30),
      result: state?.result || null,
      duration,
      rawState: state,
    };
  }

  readTelemetryEvents(taskId) {
    if (!fs.existsSync(TELEMETRY_FILE)) return [];

    const lines = fs.readFileSync(TELEMETRY_FILE, 'utf-8')
      .split('\n')
      .filter(l => l.trim());

    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && (!taskId || e.task_id === taskId));
  }

  readMailboxes() {
    const mailboxes = {};
    if (!fs.existsSync(MAILBOXES_DIR)) return mailboxes;

    const files = fs.readdirSync(MAILBOXES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const role = file.replace('.json', '');
      const data = this._readJSON(path.join(MAILBOXES_DIR, file));
      if (data) mailboxes[role] = data;
    }
    return mailboxes;
  }

  _getLatestPhase(events) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].event_type === 'phase_transition') {
        return events[i].details?.phase || 'analysis';
      }
      if (events[i].event_type === 'task_started') {
        return events[i].details?.phase || 'analysis';
      }
    }
    return 'analysis';
  }

  _getActiveAgents(events, mailboxes) {
    const agents = new Map();

    // From telemetry events
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

    // From mailbox files (may be fresher)
    for (const [role, data] of Object.entries(mailboxes)) {
      if (data.status) {
        agents.set(role, {
          role,
          status: data.status,
          since: data.last_heartbeat || Date.now(),
          summary: data.result?.summary,
          changedFiles: data.result?.changed_files || [],
        });
      }
    }

    return Array.from(agents.values());
  }

  _getPendingApprovals(events) {
    const approvals = [];
    for (const e of events) {
      if (e.event_type === 'approval_requested') {
        approvals.push({ phase: e.details?.phase, content: e.details?.content, timestamp: e.timestamp });
      }
      if (e.event_type === 'approval_granted' || e.event_type === 'approval_rejected') {
        const idx = approvals.findIndex(a => a.phase === e.details?.phase);
        if (idx >= 0) approvals.splice(idx, 1);
      }
    }
    return approvals;
  }

  _getQAResults(events) {
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

  /**
   * Write a completed harness result into pm.json work log.
   * Called by the harness sync endpoint.
   */
  formatWorkEntry(taskId, status) {
    const result = status.result || {};
    const workflowStatus = result.workflow_status || status.status;

    return {
      date: new Date().toISOString().split('T')[0],
      summary: `Harness ${workflowStatus} — ${status.phase} — ${result.changed_files?.length || 0} files`,
      agentRan: true,
      filesChanged: result.changed_files || [],
      harnessResult: result,
      harnessEvents: status.events?.slice(-20),
      harnessDuration: status.duration,
    };
  }
}
