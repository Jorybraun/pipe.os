"""Developer agent toolkit — file, shell, browser, and broker MCP tools."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from langchain_core.tools import tool
from langchain_community.agent_toolkits import FileManagementToolkit
from langchain_community.tools import ShellTool
from langchain_community.tools.file_management.read import ReadFileTool
from langchain_community.tools.file_management.utils import INVALID_PATH_TEMPLATE
from langchain_community.tools.playwright.utils import create_sync_playwright_browser
from langchain_community.tools.playwright import (
    ClickTool,
    ExtractTextTool,
    NavigateTool,
)

from agent_harness.broker import (
    emit,
    get_plan,
    post_cue,
    read_cues,
    ack_cue,
    reserve_migration,
    submit_handoff,
)
from agent_harness.swarm.agents.architect import run_architect


# ── Output caps (aligned with Kimi Code CLI) ──────────────────────────────
MAX_SHELL_OUTPUT = 32_000     # characters
MAX_FILE_READ_BYTES = 64_000  # characters — high cap for long-horizon work
MAX_LINE_LENGTH = 2_000       # truncate individual lines
MAX_FILE_WRITE_BYTES = 256_000  # prevent accidental multi-MB writes


class SafeShellTool(ShellTool):
    """ShellTool with output size limits to prevent checkpoint bloat."""

    def _run(self, commands, run_manager=None):
        result = super()._run(commands, run_manager=run_manager)
        if isinstance(result, str) and len(result) > MAX_SHELL_OUTPUT:
            truncated = result[:MAX_SHELL_OUTPUT]
            last_newline = truncated.rfind("\n")
            if last_newline > 0:
                truncated = truncated[:last_newline]
            result = (
                truncated
                + f"\n\n[TRUNCATED: output exceeded {MAX_SHELL_OUTPUT} characters]"
            )
        return result


def _project_root() -> Path:
    """Resolve the project root (parent of the agent-harness package)."""
    # toolkit.py lives at agent-harness/src/agent_harness/swarm/toolkit.py
    # Allow SWARM_SUBTREE env var to redirect all file operations into an
    # isolated subtree (e.g. for tech-debt lanes that must not touch live code).
    subtree = os.getenv("SWARM_SUBTREE")
    if subtree:
        return Path(subtree).resolve()
    return Path(__file__).parent.parent.parent.parent.parent.resolve()


def get_developer_tools(root_dir: str | None = None) -> list[Any]:
    """Return the full tool list for an ephemeral developer agent."""
    if root_dir is None:
        root_dir = str(_project_root())
    root_path = Path(root_dir).resolve()

    # ── File management (custom read + grep + langchain defaults) ─────────
    ftk = FileManagementToolkit(root_dir=root_dir)
    file_tools: list[Any] = []
    _write_file_tool = None
    for t in ftk.get_tools():
        if isinstance(t, ReadFileTool):
            continue  # Replaced by custom read_file below
        if getattr(t, "name", "") == "write_file":
            _write_file_tool = t  # Capture for wrapping below
            continue
        file_tools.append(t)

    # Wrapped write_file with sanity checks (but NOT aggressive rewrite blocking)
    if _write_file_tool is not None:
        _orig_write = _write_file_tool._run

        def _guarded_write_file(file_path: str, text: str, **kwargs) -> str:
            target = Path(file_path)
            if not target.is_absolute():
                target = root_path / target
            target = target.resolve()

            # Safety 1: cap write size
            if len(text) > MAX_FILE_WRITE_BYTES:
                return (
                    f"ERROR: Write too large. "
                    f"{len(text)} chars exceeds max {MAX_FILE_WRITE_BYTES}. "
                    f"Write in smaller chunks or use shell."
                )

            # Safety 2: warn on large deletions but DO NOT block
            # (agents legitimately refactor/delete code)
            warning = ""
            if target.exists() and target.is_file():
                try:
                    existing = target.read_text(encoding="utf-8", errors="replace")
                except Exception:
                    existing = ""
                if existing:
                    existing_lines = existing.count("\n") + 1
                    new_lines = text.count("\n") + 1
                    if new_lines < existing_lines * 0.3:
                        warning = (
                            f"\n[WARNING: This replaces {existing_lines} lines with {new_lines} lines. "
                            f"If this is intentional, proceed. If not, re-read the file first.]"
                        )

            result = _orig_write(file_path=file_path, text=text, **kwargs)
            return str(result) + warning

        from langchain_core.tools import StructuredTool
        if isinstance(_write_file_tool, StructuredTool):
            write_file = StructuredTool.from_function(
                func=_guarded_write_file,
                name="write_file",
                description=_write_file_tool.description,
                args_schema=_write_file_tool.args_schema,
            )
        else:
            # Fallback: create a simple tool wrapper
            @tool
            def write_file(file_path: str, text: str) -> str:
                """Write text to a file."""
                return _guarded_write_file(file_path, text)

        file_tools.append(write_file)

    @tool
    def read_file(file_path: str, line_offset: int = 1, n_lines: int = 1000) -> str:
        """Read a file from disk with optional line range.

        Args:
            file_path: Path to the file. Absolute paths required when reading
                outside the working directory.
            line_offset: Line number to start reading from (1-indexed).
                Use negative values to read from the end (e.g., -100 reads
                the last 100 lines). The absolute value cannot exceed 1000.
            n_lines: Maximum number of lines to read. Default 1000, max 1000.
                Set this when the file is too large to read at once.
        """
        target = Path(file_path)
        if not target.is_absolute():
            target = root_path / target
        target = target.resolve()

        if not target.exists():
            return f"Error: no such file or directory: {file_path}"
        if not target.is_file():
            return f"Error: not a file: {file_path}"

        # Binary guard: check for null bytes in first 8KB
        try:
            header = target.read_bytes()[:8192]
            if b"\x00" in header:
                return f"Error: {file_path} appears to be a binary file (contains null bytes). Cannot read as text."
        except Exception:
            pass

        # Safety: cap n_lines
        max_lines = min(n_lines, 1000)

        try:
            raw_text = target.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            return f"Error: failed to read {file_path}: {e}"

        all_lines = raw_text.splitlines(keepends=True)
        total_lines = len(all_lines)

        # Determine slice
        if line_offset < 0:
            tail_count = abs(line_offset)
            start = max(0, total_lines - tail_count)
            end = min(total_lines, start + max_lines)
        else:
            start = max(0, line_offset - 1)  # 1-indexed → 0-indexed
            end = min(total_lines, start + max_lines)

        selected = all_lines[start:end]

        # Truncate individual long lines and accumulate byte budget
        lines_out: list[str] = []
        bytes_out = 0
        max_bytes_reached = False
        truncated_line_nos: list[int] = []

        for i, line in enumerate(selected, start=start + 1):
            if len(line) > MAX_LINE_LENGTH:
                line = line[:MAX_LINE_LENGTH] + "\n"
                truncated_line_nos.append(i)
            line_bytes = len(line.encode("utf-8"))
            if bytes_out + line_bytes > MAX_FILE_READ_BYTES:
                max_bytes_reached = True
                break
            bytes_out += line_bytes
            lines_out.append(line)

        # Format with line numbers like `cat -n`
        formatted: list[str] = []
        for line_num, line in zip(range(start + 1, start + 1 + len(lines_out)), lines_out):
            formatted.append(f"{line_num:6d}\t{line}")

        msg = f"{len(lines_out)} lines read from file starting from line {start + 1}."
        msg += f" Total lines in file: {total_lines}."
        if max_bytes_reached:
            msg += f" Max {MAX_FILE_READ_BYTES} bytes reached."
        elif end < total_lines:
            msg += " End of range reached."
        else:
            msg += " End of file reached."
        if truncated_line_nos:
            msg += f" Lines {truncated_line_nos} were truncated."

        return msg + "\n" + "".join(formatted)

    @tool
    def grep(pattern: str, path: str = ".", glob: str = "*") -> str:
        """Search file contents for a pattern using ripgrep (rg) or grep.

        Args:
            pattern: Regex pattern to search for.
            path: Directory or file to search in. Default is current directory.
            glob: File glob pattern to filter (e.g., '*.ts', '*.py').
                Default '*' searches all files.
        """
        search_path = Path(path)
        if not search_path.is_absolute():
            search_path = root_path / search_path
        search_path = search_path.resolve()

        if not search_path.exists():
            return f"Error: path does not exist: {path}"

        # Try ripgrep first (fastest, respects .gitignore)
        rg_cmd = [
            "rg", "-n", "--max-count", "50", "--glob", glob,
            "-C", "2",  # 2 lines of context
            "--no-ignore-parent",  # respect .gitignore in cwd
            pattern, str(search_path),
        ]
        try:
            result = subprocess.run(
                rg_cmd,
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0 or result.stdout:
                lines = result.stdout.strip().splitlines()
                if len(lines) > 100:
                    return (
                        f"Found {len(lines)} matches (showing first 100):\n"
                        + "\n".join(lines[:100])
                        + f"\n\n[TRUNCATED: {len(lines) - 100} more matches]"
                    )
                return result.stdout
            if result.returncode == 1:
                return f"No matches for pattern '{pattern}' in {path}"
        except FileNotFoundError:
            pass  # rg not available, try grep
        except subprocess.TimeoutExpired:
            return f"Error: grep timed out after 15s searching for '{pattern}'"

        # Fallback to grep -r (also respect .gitignore-ish via --exclude-dir)
        grep_cmd = [
            "grep", "-rn", "-C", "2", "--include", glob,
            "--exclude-dir=node_modules",
            "--exclude-dir=.venv",
            "--exclude-dir=__pycache__",
            "--exclude-dir=.git",
            pattern, str(search_path),
        ]
        try:
            result = subprocess.run(
                grep_cmd,
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0 or result.stdout:
                lines = result.stdout.strip().splitlines()
                if len(lines) > 100:
                    return (
                        f"Found {len(lines)} matches (showing first 100):\n"
                        + "\n".join(lines[:100])
                        + f"\n\n[TRUNCATED: {len(lines) - 100} more matches]"
                    )
                return result.stdout
            if result.returncode == 1:
                return f"No matches for pattern '{pattern}' in {path}"
        except FileNotFoundError:
            pass
        except subprocess.TimeoutExpired:
            return f"Error: grep timed out after 15s searching for '{pattern}'"

        # Final fallback: Python os.walk — EXCLUDE known heavy dirs
        try:
            import re
            matches: list[str] = []
            SKIP_DIRS = {"node_modules", ".venv", "__pycache__", ".git", "dist", "build", ".vite"}
            compiled = re.compile(pattern)

            if search_path.is_file():
                files = [search_path]
            else:
                files = []
                for dirpath, dirnames, filenames in search_path.walk():
                    # Prune skip dirs
                    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                    for fn in filenames:
                        # Simple glob match
                        if glob == "*" or fn.endswith(glob.replace("*", "")):
                            files.append(Path(dirpath) / fn)

            for f in files:
                try:
                    text = f.read_text(encoding="utf-8", errors="replace")
                    for lineno, line in enumerate(text.splitlines(), 1):
                        if compiled.search(line):
                            matches.append(f"{f}:{lineno}:{line}")
                            if len(matches) >= 100:
                                return (
                                    f"Found 100+ matches:\n"
                                    + "\n".join(matches)
                                    + "\n\n[TRUNCATED: more matches]"
                                )
                except Exception:
                    continue

            if not matches:
                return f"No matches for pattern '{pattern}' in {path}"
            return f"Found {len(matches)} matches:\n" + "\n".join(matches)
        except Exception as e:
            return f"Error: grep failed: {e}"

    @tool
    def edit_file(file_path: str, old: str, new: str) -> str:
        """Replace a specific string in a file with another string.

        Use this for precise edits (change one function, one line, one import)
        rather than rewriting the entire file. The 'old' string must match
        exactly, including whitespace.

        Args:
            file_path: Path to the file.
            old: Exact string to replace. Can be multi-line.
            new: Replacement string. Can be multi-line.
        """
        target = Path(file_path)
        if not target.is_absolute():
            target = root_path / target
        target = target.resolve()

        if not target.exists():
            return f"Error: file does not exist: {file_path}"
        if not target.is_file():
            return f"Error: not a file: {file_path}"

        try:
            content = target.read_text(encoding="utf-8")
        except Exception as e:
            return f"Error: could not read {file_path}: {e}"

        if old not in content:
            return (
                f"Error: 'old' string not found in {file_path}. "
                f"The text must match exactly. Try grep first to find the exact text."
            )

        new_content = content.replace(old, new, 1)
        if new_content == content:
            return f"Error: replacement did not change {file_path}"

        try:
            target.write_text(new_content, encoding="utf-8")
        except Exception as e:
            return f"Error: could not write {file_path}: {e}"

        return f"Successfully replaced text in {file_path} ({len(old)} chars → {len(new)} chars)"

    @tool
    def check_types() -> str:
        """Run the TypeScript compiler to check for type errors.

        Runs `npx tsc --noEmit` from the project root.
        Use this after writing or editing TypeScript files to verify
        the code compiles before submitting a handoff.
        """
        try:
            result = subprocess.run(
                ["npx", "tsc", "--noEmit"],
                cwd=str(root_path),
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0:
                return "Type check passed: no errors found."
            stdout = result.stdout or ""
            stderr = result.stderr or ""
            combined = (stdout + "\n" + stderr).strip()
            if len(combined) > MAX_SHELL_OUTPUT:
                combined = combined[:MAX_SHELL_OUTPUT] + "\n\n[TRUNCATED]"
            return f"Type check FAILED (exit code {result.returncode}):\n{combined}"
        except subprocess.TimeoutExpired:
            return "Error: Type check timed out after 120s"
        except FileNotFoundError:
            return "Error: npx not found. Is Node.js installed?"
        except Exception as e:
            return f"Error running type check: {e}"

    @tool
    def run_tests(test_pattern: str = "") -> str:
        """Run the test suite or a subset of tests.

        Args:
            test_pattern: Optional pattern to filter tests (e.g., 'issueScorer',
            'routes/cron', '*.test.ts'). If empty, runs the full suite.
        """
        cmd = ["npx", "vitest", "run", "--reporter=verbose"]
        if test_pattern:
            cmd.append(test_pattern)
        try:
            result = subprocess.run(
                cmd,
                cwd=str(root_path),
                capture_output=True,
                text=True,
                timeout=300,
            )
            stdout = result.stdout or ""
            stderr = result.stderr or ""
            combined = (stdout + "\n" + stderr).strip()
            if len(combined) > MAX_SHELL_OUTPUT:
                combined = combined[:MAX_SHELL_OUTPUT] + "\n\n[TRUNCATED]"
            if result.returncode == 0:
                return f"Tests passed:\n{combined}"
            return f"Tests FAILED (exit code {result.returncode}):\n{combined}"
        except subprocess.TimeoutExpired:
            return "Error: Tests timed out after 300s"
        except FileNotFoundError:
            return "Error: vitest not found."
        except Exception as e:
            return f"Error running tests: {e}"

    file_tools.extend([read_file, grep, edit_file, check_types, run_tests])

    # Shell (with output limits)
    shell_tool = SafeShellTool()

    # Playwright browser (manual QA / smoke testing)
    try:
        browser = create_sync_playwright_browser()
        navigate_tool = NavigateTool.from_browser(sync_browser=browser)
        extract_text_tool = ExtractTextTool.from_browser(sync_browser=browser)
        click_tool = ClickTool.from_browser(sync_browser=browser)
        browser_tools = [navigate_tool, extract_text_tool, click_tool]
    except Exception as exc:
        import warnings
        warnings.warn(f"Playwright tools unavailable: {exc}")
        browser_tools = []

    # Broker tools — wrapped as LangChain @tool functions
    def _safe_json_loads(s: str, default: Any) -> Any:
        if not s or not s.strip():
            return default
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return default

    @tool
    def broker_submit_handoff_tool(
        plan_id: str,
        subtask_id: str,
        status: str,
        handoff_to: str,
        sequence: int = 0,
        done: str = "[]",
        next_actions: str = "[]",
        state_notes: str = "[]",
        files_touched: str = "[]",
        migrations_reserved: str = "[]",
        context_used: int = 0,
        dod_checklist: str = "[]",
    ) -> str:
        """Submit a developer handoff (required exit artifact).

        status: complete | context_exhausted | blocked
        handoff_to: next_dev | qa_deploy | supervisor_reroute
        dod_checklist: JSON list of {item: str, checked: bool, justification: str}
        """
        import sys
        print(f"[DEV-TOOL] broker_submit_handoff_tool called with plan_id='{plan_id}' subtask_id='{subtask_id}' status='{status}' handoff_to='{handoff_to}'", file=sys.stderr)
        if not plan_id:
            return json.dumps({"error": "plan_id is required and cannot be empty"}, indent=2)
        if not subtask_id:
            return json.dumps({"error": "subtask_id is required and cannot be empty"}, indent=2)
        record = submit_handoff(
            plan_id=plan_id,
            subtask_id=subtask_id,
            status=status,
            handoff_to=handoff_to,
            sequence=sequence or None,
            done=_safe_json_loads(done, []),
            next_actions=_safe_json_loads(next_actions, []),
            state_notes=_safe_json_loads(state_notes, []),
            files_touched=_safe_json_loads(files_touched, []),
            migrations_reserved=_safe_json_loads(migrations_reserved, []),
            context_used=context_used or None,
            dod_checklist=_safe_json_loads(dod_checklist, []),
        )
        return json.dumps({"submitted": record}, indent=2)

    @tool
    def broker_emit_event_tool(
        event_type: str,
        payload: str = "{}",
        plan_id: str = "",
        lane_id: str = "",
        agent_id: str = "",
    ) -> str:
        """Emit an event to the broker event bus."""
        event_id = emit(
            event_type=event_type,
            payload=json.loads(payload) if payload else None,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
            agent_id=agent_id or None,
        )
        return json.dumps({"event_id": event_id}, indent=2)

    @tool
    def broker_get_plan_tool(plan_id: str) -> str:
        """Get full plan content including subtasks and dependencies."""
        plan = get_plan(plan_id)
        if not plan:
            return json.dumps({"error": f"Plan not found: {plan_id}"})
        return json.dumps(plan, indent=2)

    @tool
    def broker_reserve_migration_tool(env: str, plan_id: str = "", lane_id: str = "") -> str:
        """Atomically reserve the next migration number for an environment."""
        num = reserve_migration(
            env=env,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
        )
        return json.dumps({"reserved": num, "env": env}, indent=2)

    @tool
    def broker_post_cue_tool(content: str, plan_id: str = "", lane_id: str = "") -> str:
        """Post a steering cue (deduped by content hash)."""
        result = post_cue(
            content=content,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
        )
        return json.dumps(result, indent=2)

    @tool
    def broker_read_cues_tool(plan_id: str = "", lane_id: str = "", since: float = 0.0) -> str:
        """Read pending (unacked) steering cues."""
        rows = read_cues(
            plan_id=plan_id or None,
            lane_id=lane_id or None,
            since=since,
        )
        return json.dumps({"count": len(rows), "cues": rows}, indent=2)

    @tool
    def broker_ack_cue_tool(cue_id: str) -> str:
        """Acknowledge a cue by ID."""
        ok = ack_cue(cue_id)
        return json.dumps({"acked": ok, "cue_id": cue_id}, indent=2)

    @tool
    def consult_architect_tool(
        plan_id: str,
        subtask_id: str,
        question: str,
        lane_id: str = "",
    ) -> str:
        """Consult the System Architect for deep architectural guidance.

        Use this when you encounter missing API contracts, schema ambiguity,
        integration questions, or uncertainty about how to structure a change.
        Returns a structured 8-point architecture spec.
        """
        result = run_architect(
            plan_id=plan_id,
            subtask_id=subtask_id or None,
            question=question,
            lane_id=lane_id,
        )
        return json.dumps(result, indent=2)

    broker_tools = [
        broker_submit_handoff_tool,
        broker_emit_event_tool,
        broker_get_plan_tool,
        broker_reserve_migration_tool,
        broker_post_cue_tool,
        broker_read_cues_tool,
        broker_ack_cue_tool,
        consult_architect_tool,
    ]

    return file_tools + [shell_tool] + browser_tools + broker_tools
