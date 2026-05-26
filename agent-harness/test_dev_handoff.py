#!/usr/bin/env python3
"""Quick test: run developer agent directly and see if it submits a handoff."""
import os
import sys

# Developer tools use CWD as root_dir — must be repo root
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(repo_root)

from agent_harness.broker.db import init_db
from agent_harness.broker import get_plan
from agent_harness.swarm.agents.developer import run_developer

init_db()
plan = get_plan('part2-role-discovery/phase0-cockpit-rcd-cutover.md')
subtask = plan['subtasks'][0]
plan_content = (
    f'# {plan["title"]}\n\n'
    f'## Subtask {subtask["subtask_id"]}\n'
    f'{subtask.get("spec", "(no spec)")}'
)

print(f'CWD: {os.getcwd()}')
print(f'Running developer on: {plan["title"]}')
print(f'Subtask: {subtask["title"]}')
print()

final = run_developer(
    plan_id='part2-role-discovery/phase0-cockpit-rcd-cutover.md',
    subtask_id='subtask-1',
    plan_content=plan_content,
    thread_id='test-dev-handoff',
)

print(f'\n=== RESULT ===')
print(f'Status: {final.get("status")}')
print(f'Turn count: {final.get("turn_count")}')
print(f'Budget used: {final.get("budget_used")}')

msgs = final.get('messages', [])
for i, msg in enumerate(msgs[-10:]):
    name = getattr(msg, 'name', type(msg).__name__)
    content = getattr(msg, 'content', '')[:200]
    print(f'  [{i}] {name}: {content}...')
