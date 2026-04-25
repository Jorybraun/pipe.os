"""
Git Tools - Shared tools for branch, commit, and merge operations.
Available to Dev and PM agents.
"""

import subprocess
import os
from typing import Optional


def run_git_command(cmd: list[str], cwd: Optional[str] = None) -> tuple[int, str, str]:
    """Run a git command and return (returncode, stdout, stderr)."""
    repo_path = cwd or os.getenv("REPO_PATH", ".")
    
    result = subprocess.run(
        ["git"] + cmd,
        cwd=repo_path,
        capture_output=True,
        text=True
    )
    
    return result.returncode, result.stdout, result.stderr


def git_branch(branch_name: str, base: str = "main") -> str:
    """Create a new feature branch from base."""
    # First checkout base
    run_git_command(["checkout", base])
    # Create and checkout new branch
    code, out, err = run_git_command(["checkout", "-b", branch_name])
    
    if code != 0:
        return f"Error creating branch: {err}"
    
    return f"Created and checked out branch: {branch_name}"


def git_commit(message: str, files: Optional[list[str]] = None) -> str:
    """Stage and commit files. If no files specified, stages all."""
    if files:
        for f in files:
            run_git_command(["add", f])
    else:
        run_git_command(["add", "."])
    
    code, out, err = run_git_command(["commit", "-m", message])
    
    if code != 0:
        return f"Error committing: {err}"
    
    return f"Committed: {message}"


def git_push(remote: str = "origin", branch: Optional[str] = None) -> str:
    """Push current branch or specified branch to remote."""
    if branch:
        code, out, err = run_git_command(["push", remote, branch])
    else:
        code, out, err = run_git_command(["push"])
    
    if code != 0:
        return f"Error pushing: {err}"
    
    return f"Pushed to {remote}"


def git_merge(branch: str, into: str = "main") -> str:
    """Merge a feature branch into target branch."""
    # Checkout target branch
    run_git_command(["checkout", into])
    # Merge
    code, out, err = run_git_command(["merge", branch])
    
    if code != 0:
        return f"Merge conflict or error: {err}"
    
    return f"Successfully merged {branch} into {into}"


def git_log(n: int = 5) -> str:
    """Get recent commit log."""
    code, out, err = run_git_command(["log", f"--oneline", f"-{n}"])
    return out if code == 0 else err


def git_status() -> str:
    """Get current git status."""
    code, out, err = run_git_command(["status", "--short"])
    return out if code == 0 else err


# Export tools for use by agents
GIT_TOOLS = [
    git_branch,
    git_commit,
    git_push,
    git_merge,
    git_log,
    git_status
]
