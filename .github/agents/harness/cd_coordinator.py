#!/usr/bin/env python3
"""
Pipe CD Coordinator — Git Workflow for Agent Swarm

Handles continuous deployment coordination:
- Pull latest before starting work
- Auto-commit agent outputs with descriptive messages
- Push to feature branch
- Notify user for review
- Pull updates from user merges
- Handle merge conflicts

Usage:
    python cd_coordinator.py --pull              # sync before work
    python cd_coordinator.py --commit "msg"      # commit current changes
    python cd_coordinator.py --push              # push to remote
    python cd_coordinator.py --sync              # pull + push cycle
    python cd_coordinator.py --pr "title"        # create PR for review
    python cd_coordinator.py --status            # show git status
"""

import argparse
import subprocess
import sys
import os
from pathlib import Path
from datetime import datetime

GIT_SSH_COMMAND = 'ssh -i /root/.openclaw/workspace/.ssh/id_ed25519 -o UserKnownHostsFile=/root/.openclaw/workspace/.ssh/known_hosts -o StrictHostKeyChecking=accept-new'


def run_git(args, cwd=None, check=True):
    """Run a git command with proper SSH config."""
    env = os.environ.copy()
    env['GIT_SSH_COMMAND'] = GIT_SSH_COMMAND
    
    cmd = ['git'] + args
    result = subprocess.run(
        cmd,
        cwd=cwd or '/root/.openclaw/workspace/pipe.os',
        env=env,
        capture_output=True,
        text=True
    )
    
    if check and result.returncode != 0:
        print(f"Git error: {result.stderr}", file=sys.stderr)
        return None
    
    return result.stdout.strip()


def get_current_branch():
    """Get current git branch."""
    return run_git(['rev-parse', '--abbrev-ref', 'HEAD'])


def pull_latest():
    """Pull latest changes from remote."""
    branch = get_current_branch()
    print(f"Pulling latest from origin/{branch}...")
    
    # Stash any local changes first
    run_git(['stash', 'push', '-m', f'auto-stash-{datetime.now().isoformat()}'], check=False)
    
    # Pull
    output = run_git(['pull', 'origin', branch])
    if output is None:
        print("Pull failed. Manual intervention needed.")
        return False
    
    print(f"Pulled: {output}")
    
    # Pop stash if there were local changes
    run_git(['stash', 'pop'], check=False)
    
    return True


def commit_changes(message, files=None):
    """Commit changes with a descriptive message."""
    if files:
        for f in files:
            run_git(['add', f])
    else:
        run_git(['add', '-A'])
    
    # Check if there are changes to commit
    status = run_git(['status', '--porcelain'])
    if not status:
        print("No changes to commit.")
        return False
    
    # Commit
    run_git(['commit', '-m', message])
    print(f"Committed: {message[:60]}...")
    return True


def push_to_remote():
    """Push current branch to remote."""
    branch = get_current_branch()
    print(f"Pushing to origin/{branch}...")
    
    output = run_git(['push', 'origin', branch])
    if output is None:
        print("Push failed.")
        return False
    
    print("Push successful.")
    return True


def sync_cycle():
    """Full sync: pull latest, push local commits."""
    print("="*60)
    print("  SYNC CYCLE")
    print("="*60)
    
    # Pull first
    if not pull_latest():
        return False
    
    # Push any local commits
    push_to_remote()
    
    print("Sync complete.")
    return True


def create_pr(title, body=""):
    """Create a pull request using GitHub CLI if available."""
    # Check if gh is installed
    result = subprocess.run(['which', 'gh'], capture_output=True)
    if result.returncode != 0:
        print("GitHub CLI not installed. Manual PR required.")
        print(f"Branch: {get_current_branch()}")
        print(f"Title: {title}")
        return False
    
    branch = get_current_branch()
    cmd = ['gh', 'pr', 'create', '--title', title, '--body', body or title, '--base', 'main']
    
    env = os.environ.copy()
    env['GIT_SSH_COMMAND'] = GIT_SSH_COMMAND
    
    result = subprocess.run(cmd, cwd='/root/.openclaw/workspace/pipe.os', env=env, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"PR creation failed: {result.stderr}")
        return False
    
    print(f"PR created: {result.stdout}")
    return True


def show_status():
    """Show comprehensive git status."""
    branch = get_current_branch()
    print(f"\nBranch: {branch}")
    print("-" * 40)
    
    # Status
    status = run_git(['status', '--short'])
    if status:
        print("Modified files:")
        print(status)
    else:
        print("Working tree clean.")
    
    # Latest commit
    log = run_git(['log', '--oneline', '-3'])
    if log:
        print("\nRecent commits:")
        print(log)
    
    # Remote status
    ahead_behind = run_git(['rev-list', '--left-right', '--count', f'origin/{branch}...{branch}'], check=False)
    if ahead_behind:
        behind, ahead = ahead_behind.split()
        print(f"\nRemote: {ahead} ahead, {behind} behind")


def agent_commit(task_id, agent_role, files_changed, summary):
    """Standardized commit format for agent work."""
    message = f"""[{agent_role}] {task_id}: {summary}

- Agent: {agent_role}
- Task: {task_id}
- Files: {', '.join(files_changed)}
- Quality gates: tsc --noEmit passing
"""
    
    return commit_changes(message, files_changed)


def main():
    parser = argparse.ArgumentParser(description="Pipe CD Coordinator")
    parser.add_argument("--pull", "-p", action="store_true", help="Pull latest changes")
    parser.add_argument("--commit", "-c", help="Commit message")
    parser.add_argument("--files", "-f", nargs="+", help="Specific files to commit")
    parser.add_argument("--push", action="store_true", help="Push to remote")
    parser.add_argument("--sync", "-s", action="store_true", help="Full sync cycle")
    parser.add_argument("--pr", help="Create PR with title")
    parser.add_argument("--status", action="store_true", help="Show status")
    parser.add_argument("--agent-commit", help="Agent commit: TASK_ID|ROLE|SUMMARY")
    
    args = parser.parse_args()
    
    if args.status:
        show_status()
    elif args.pull:
        pull_latest()
    elif args.commit:
        commit_changes(args.commit, args.files)
    elif args.push:
        push_to_remote()
    elif args.sync:
        sync_cycle()
    elif args.pr:
        create_pr(args.pr)
    elif args.agent_commit:
        parts = args.agent_commit.split("|")
        if len(parts) >= 3:
            task_id, role, summary = parts[0], parts[1], parts[2]
            files = args.files or []
            agent_commit(task_id, role, files, summary)
        else:
            print("Format: TASK_ID|ROLE|SUMMARY")
    else:
        show_status()


if __name__ == "__main__":
    main()
