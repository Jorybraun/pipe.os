#!/usr/bin/env python3
"""Self-contained web dashboard for the agent-harness swarm.

Serves on http://localhost:8767 and auto-refreshes every 5 seconds.
Reads directly from the broker SQLite DB — no Docker connection needed.
"""
from __future__ import annotations

import sqlite3
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / ".swarm" / "broker.db"
PORT = 8767


def _fmt_ago(ts: float | None) -> str:
    if not ts:
        return "—"
    elapsed = time.time() - ts
    if elapsed < 60:
        return f"{elapsed:.0f}s ago"
    if elapsed < 3600:
        return f"{elapsed/60:.0f}m ago"
    return f"{elapsed/3600:.1f}h ago"


def _status_color(status: str) -> str:
    s = (status or "").upper()
    if s in ("COMPLETE", "DONE", "PASS"):
        return "#22c55e"  # green
    if s in ("RUNNING", "CLAIMED", "PENDING"):
        return "#eab308"  # yellow
    if s in ("FAILED", "ESCALATED", "BLOCKED"):
        return "#ef4444"  # red
    return "#9ca3af"  # gray


def render_page() -> str:
    if not DB_PATH.exists():
        return "<h1>Database not found</h1>"

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # ── Active lanes ──
    lanes_rows = conn.execute(
        "SELECT lane_id, plan_id, status, started_at, last_heartbeat, budget_used FROM lanes WHERE status = 'running' ORDER BY started_at DESC"
    ).fetchall()

    lanes_html = ""
    for ln in lanes_rows:
        color = _status_color(ln["status"])
        lanes_html += f"""
        <tr>
          <td><span style="color:{color};font-weight:bold">{ln['status']}</span></td>
          <td>{ln['lane_id']}</td>
          <td>{ln['plan_id']}</td>
          <td>{_fmt_ago(ln['started_at'])}</td>
          <td>{_fmt_ago(ln['last_heartbeat'])}</td>
          <td>{ln['budget_used'] or 0}</td>
        </tr>
        """

    if not lanes_html:
        lanes_html = '<tr><td colspan="6" style="text-align:center;color:#666">No active lanes</td></tr>'

    # ── Recent handoffs ──
    handoff_rows = conn.execute(
        "SELECT plan_id, subtask_id, status, handoff_to, created_at FROM handoffs ORDER BY created_at DESC LIMIT 15"
    ).fetchall()

    handoffs_html = ""
    for h in handoff_rows:
        color = _status_color(h["status"])
        handoffs_html += f"""
        <tr>
          <td><span style="color:{color};font-weight:bold">{h['status']}</span></td>
          <td>{h['plan_id']}</td>
          <td>{h['subtask_id']}</td>
          <td>{h['handoff_to']}</td>
          <td>{_fmt_ago(h['created_at'])}</td>
        </tr>
        """

    # ── Recent events ──
    event_rows = conn.execute(
        "SELECT event_type, plan_id, lane_id, emitted_at FROM events ORDER BY emitted_at DESC LIMIT 15"
    ).fetchall()

    events_html = ""
    for e in event_rows:
        events_html += f"""
        <tr>
          <td>{e['event_type']}</td>
          <td>{e['plan_id'] or '—'}</td>
          <td>{e['lane_id'] or '—'}</td>
          <td>{_fmt_ago(e['emitted_at'])}</td>
        </tr>
        """

    # ── Plans summary ──
    plan_rows = conn.execute(
        "SELECT plan_id, status, phase FROM plans WHERE plan_id LIKE 'qa-swarm-bugfix/%' ORDER BY plan_id"
    ).fetchall()

    plans_html = ""
    for p in plan_rows:
        color = _status_color(p["status"])
        plans_html += f"""
        <tr>
          <td>{p['phase'] or 0}</td>
          <td><span style="color:{color};font-weight:bold">{p['status']}</span></td>
          <td>{p['plan_id']}</td>
        </tr>
        """

    conn.close()

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Swarm Dashboard</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:20px; }}
    h1 {{ color:#38bdf8; margin-bottom:5px; }}
    .subtitle {{ color:#94a3b8; font-size:14px; margin-bottom:20px; }}
    table {{ width:100%; border-collapse:collapse; margin-bottom:30px; font-size:13px; }}
    th {{ background:#1e293b; color:#94a3b8; text-align:left; padding:10px; border-bottom:2px solid #334155; }}
    td {{ padding:10px; border-bottom:1px solid #334155; }}
    tr:hover td {{ background:#1e293b; }}
    .section {{ background:#1e293b; border-radius:8px; padding:15px; margin-bottom:20px; }}
    .section h2 {{ color:#38bdf8; margin-top:0; font-size:18px; }}
  </style>
</head>
<body>
  <h1>🐝 Agent Harness Swarm Dashboard</h1>
  <div class="subtitle">Auto-refreshes every 5 seconds | {time.strftime('%H:%M:%S')}</div>

  <div class="section">
    <h2>QA Plans</h2>
    <table>
      <tr><th>Phase</th><th>Status</th><th>Plan</th></tr>
      {plans_html}
    </table>
  </div>

  <div class="section">
    <h2>Active Lanes</h2>
    <table>
      <tr><th>Status</th><th>Lane ID</th><th>Plan</th><th>Started</th><th>Heartbeat</th><th>Budget</th></tr>
      {lanes_html}
    </table>
  </div>

  <div class="section">
    <h2>Recent Handoffs</h2>
    <table>
      <tr><th>Status</th><th>Plan</th><th>Subtask</th><th>Handoff To</th><th>Time</th></tr>
      {handoffs_html}
    </table>
  </div>

  <div class="section">
    <h2>Recent Events</h2>
    <table>
      <tr><th>Event Type</th><th>Plan</th><th>Lane</th><th>Time</th></tr>
      {events_html}
    </table>
  </div>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(render_page().encode("utf-8"))

    def log_message(self, format, *args):
        pass  # silence request logging


def main():
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"🐝 Swarm dashboard running at http://127.0.0.1:{PORT}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
