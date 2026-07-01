# Research Task: Remote AI Agent Bridge Protocol

## Question

What is the best-practice remote agent architecture for a real agent bridge inside PIPE's live assessment room?

Evaluate whether Hermes, Devin, ACP, A2A, MCP, or a small PIPE-native bridge should own the assessment-room agent layer.

## Context

The current dev-container room needs a reliable VS Code/code-server workspace first. The earlier approach embedded a large Devin bridge script into the Cloudflare Container startup command, which pushed the startup payload near Cloudflare runtime value limits and caused container boot failures.

The assistant should feel integrated with the assessment workspace, but the implementation must not couple the interview room's critical editor/video path to any single agent CLI.

## Research Scope

- Compare ACP, A2A, MCP, Hermes, and Devin CLI integration for remote agent control.
- Define the boundary between:
  - room UI actions,
  - dev-container filesystem/terminal actions,
  - candidate-safe assistance,
  - recruiter/host controls,
  - transcript and context-graph evidence capture.
- Decide whether Hermes should be the persistent OS-agent layer, with Devin as one remote worker/tool behind it.
- Identify auth/session model for candidate no-sign-in links and recruiter Clerk sessions.
- Define a capability allowlist for actions like opening windows, reading files, proposing edits, running commands, and writing notes.
- Define how agent actions become immutable source-backed evidence in the living context graph.
- Propose a deployment shape for Cloudflare Containers, Durable Objects, WebSockets, and any external remote-agent service.

## Deliverable

A short architecture recommendation with:

- Preferred protocol/layer choice.
- Why alternatives were rejected or deferred.
- Sequence diagram for room UI, Durable Object, container, agent, and context graph.
- Security model and candidate-safe permissions.
- Migration plan from the current assistant prompt/action path.
- First implementation slice that cannot break VS Code startup.

## Acceptance Criteria

- VS Code/code-server startup remains independent of agent startup.
- Agent protocol supports reconnect/resume without losing room state.
- Every agent-visible source and every agent action can be linked to room/session evidence.
- Candidate-facing clients never receive hidden scoring rubrics, internal IDs, or planted answers.
- The design supports multiple future agents, not only Devin.
