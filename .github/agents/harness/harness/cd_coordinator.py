#!/usr/bin/env python3
"""
Agent Harness — CD Coordinator

Git operations for the harness: branch, commit, push, merge.
"""

import subprocess
from pathlib import Path


class CDCoordinator:
    """Git operations coordinator."""
    
    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path)
    
    def run(self, cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
        """Run a git command."""
        return subprocess.run(
            ["git"] + cmd,
            capture_output=True,
            text=True,
            check=check,
            cwd=str(self.repo_path)
        )
    
    def branch_exists(self, branch: str) -> bool:
        """Check if a branch exists."""
        result = self.run(["branch", "--list", branch], check=False)
        return branch in result.stdout
    
    def create_branch(self, branch: str, base: str = "main") -> None:
        """Create a new branch from base."""
        self.run(["checkout", base])
        self.run(["pull", "origin", base])
        self.run(["checkout", "-b", branch])
    
    def commit(self, message: str, files: list[str] = None) -> None:
        """Stage and commit files."""
        if files:
            self.run(["add"] + files)
        else:
            self.run(["add", "-A"])
        self.run(["commit", "-m", message])
    
    def push(self, branch: str) -> None:
        """Push branch to origin."""
        self.run(["push", "-u", "origin", branch])
    
    def merge(self, branch: str, target: str = "main") -> None:
        """Merge branch into target."""
        self.run(["checkout", target])
        self.run(["merge", "--no-ff", branch, "-m", f"Merge {branch}"])
        self.run(["push", "origin", target])
    
    def status(self) -> str:
        """Get git status."""
        result = self.run(["status", "--short"], check=False)
        return result.stdout
    
    def changed_files(self) -> list[str]:
        """Get list of changed files."""
        result = self.run(["diff", "--name-only"], check=False)
        return [f.strip() for f in result.stdout.split("\n") if f.strip()]
