# Win95 Desktop Room — Full Context Handoff

> **Purpose**: This document gives any AI agent (Kimi, Claude, GPT, etc.) complete context to continue building the Win95 Desktop Room feature for PIPE-OS. Read this entire document before starting work.

---

## 1. Project Vision

### What We're Building

The video room is being transformed from a traditional video call UI into a **Windows 95 desktop environment**. The core concept: **the room IS the desktop**. When a participant enters the room, they boot into a Win95-style desktop with a teal (`#008080`) background. Everything — video, code editor, chat, tasks — lives in draggable, minimizable, focusable windows on that desktop.

### Why Win95?

- **Nostalgic, playful aesthetic** — fits the PIPE brand personality
- **Window manager metaphor** — naturally supports multiple concurrent activities (video, code, chat, tasks)
- **AI-as-operator** — the Win95 desktop gives an AI agent a concrete UI to control. The AI can open windows, close them, type into chat, create ad-hoc windows (code snippets, quizzes, diagrams), just like a human host would
- **Fake VM concept** — the room feels like a virtual machine. The code-server container is "My Computer". The AI agent runs inside the container and can control the desktop

### The Big Picture

The ultimate goal is an **AI-proctored interview environment** where:

1. A host sets up a meeting by picking a repo and selecting issues/tasks
2. The candidate enters the room and sees a Win95 desktop
3. An AI agent (living inside the code-server container) can:
   - Watch the candidate's code changes in real-time
   - Send chat messages with hints, questions, or instructions
   - Open windows on the fly (code snippets, diagrams in MS Paint, quiz windows)
   - Run tests and report results
   - Write observations to a shared context graph
4. When no human host is present, the AI **proctors** the entire session
5. After the session, the AI (or host) reviews the candidate's diff, test results, and chat history to produce an assessment

### Key Design Principle

**Windows are not hardcoded.** The window manager is generic. Any window is just `{ id, type, title, content, position, size, zIndex, minimized, maximized }`. The AI can create new window types at runtime. The desktop shell renders whatever window type it receives.

---

## 2. Current State (As of June 26, 2026)

### What's Already Built

#### Video Room App (`apps/video-room/`)

- **React + Vite + TypeScript** app deployed to Cloudflare Pages
- **Prejoin screen** — camera preview, ENTER ROOM button, workspace launch UI for host
- **Video call** — WebRTC via `useRoomConnection` hook, remote + local streams
- **Recording** — MediaRecorder-based recording with transcription
- **Workspace panel** — code-server iframe in a React95 `Window` wrapper
  - Win95-styled window header with title, fullscreen toggle, close button
  - Loading overlay (teal background with spinner) while code-server loads
  - **Stays mounted when closed** (CSS visibility toggle, not conditional render) so the iframe doesn't reload on toggle
  - Fullscreen mode (CSS class `is-fullscreen`)
- **Prejoin workspace launch** — host can start a dev container before entering the room
  - Shows "Container ready" / "Starting container..." / launch button + repo URL input
  - Polls workspace status via `getRoomWorkspace` API

#### API Worker (`workers/api/`)

- **Cloudflare Worker** with D1 database, Durable Objects, and Containers
- **`DevContainerDO`** — Durable Object managing container lifecycle
  - Uses `codercom/code-server:4.22.1` public Docker image
  - **Entrypoint override**: clones repo to `/workspace`, starts code-server with `--auth none`
  - `PASSWORD: 'pipe'` env var (not needed with `--auth none` but kept as fallback)
  - Container states: LAUNCHING → READY → SLEEPING → STOPPED/EXPIRED/ERROR
  - TTL-based expiry (default 3600s), sleep after inactivity
  - Port monitoring (waits for port 8080 to be ready)
- **Meeting room workspace endpoints**:
  - `GET /api/v1/meeting-rooms/:token/workspace` — get workspace status
  - `POST /api/v1/meeting-rooms/:token/workspace/launch` — launch container with optional repoUrl
  - `POST /api/v1/meeting-rooms/:token/workspace/:sessionId/destroy` — destroy container
  - `GET /api/v1/meeting-rooms/:token/workspace/proxy/:sessionId/*` — proxy to code-server
- **Route ordering fix**: `meetingRooms` router must be mounted BEFORE `devContainerSessions` router, because `devContainerSessions` has a catch-all `authMiddleware` that intercepts all `/api/v1/*` routes

#### Repo Matching & Task Selection (exists but NOT yet connected to video room)

- **`autoStageBuilder`** (`workers/api/src/lib/match/autoStageBuilder.ts`) — matches repos to candidates based on role/skills/concepts
- **`pickImplementationIssue`** — picks a GitHub issue from the matched repo, scored by implementability and clarity
- **`pickReviewPr`** — picks a PR for code review stations
- **`matchRepos`** (`workers/api/src/lib/repoDiscovery/matchRepos.ts`) — scores repos by stack fit, domain, constructs, PR quality
- **`matchCandidateToReviewChallenge`** (`workers/api/src/lib/challengeMatching/d1Matcher.ts`) — aligns candidate evidence to challenge demands
- **`scheduled_interviews` table** — stores `matched_repo_id`, `github_repo_url`, `github_pr_number` but does NOT yet store `issue_number` or `issue_title`

#### Code Review Components (exist in `src/components/`, NOT yet integrated)

- `FileTreePanel.tsx` — file tree with changed files
- `DiffPanel.tsx` — PR diff with inline annotations
- `ReviewConversationPanel.tsx` — review submission, responses, verdicts
- `ReviewTabPanel.tsx` — tabbed interface for review
- `FileViewerPanel.tsx` — single file content viewer
- `ReviewLeftPanel.tsx` — brief + files tabs
- `ReviewCenterPanel.tsx` — switches between diff and file viewer
- `CodeReviewEditor.tsx` — editor integrating PR fetcher, diff panel, annotation editor

### What's NOT Built Yet

- Win95 desktop shell (teal background, taskbar, desktop icons, start menu)
- Window manager hook
- Chat window
- Tasks/goals window
- MS Paint window
- Browser (IE-style) window
- AI agent in container
- Shared context graph integration
- Post-meeting review flow
- Time limit / countdown
- Pre-room issue picker (host selecting issues from cockpit)
- `issue_number` / `issue_title` columns in `scheduled_interviews`

---

## 3. Architecture

### Stack

- **Frontend**: React 18 + Vite + TypeScript, deployed to Cloudflare Pages
- **Styling**: Plain CSS in `styles.css` + React95 library (`@react95.io/ui`) for Win95 components
- **Backend**: Cloudflare Worker (Hono router) with D1 database
- **Containers**: Cloudflare Containers (Durable Object managed) running `codercom/code-server:4.22.1`
- **Real-time**: WebRTC for video, WebSocket (future) for chat + AI agent communication

### Key Files

| File                                                 | Purpose              | Notes                                                                                                                     |
| ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/video-room/src/App.tsx`                        | Main React component | Contains Room component, prejoin screen, workspace panel. ~940 lines. This is where the desktop shell will be integrated. |
| `apps/video-room/src/styles.css`                     | All CSS              | ~1600 lines. Contains workspace, prejoin, and Win95 override styles.                                                      |
| `apps/video-room/src/lib/api.ts`                     | API client           | `getRoomWorkspace`, `launchRoomWorkspace`, `roomWorkspaceProxyUrl` functions. `API_BASE` = `window.location.origin`.      |
| `apps/video-room/src/types.ts`                       | TypeScript types     | `RoomWorkspace`, `RoomWorkspaceSession`, `RoomMetadata` interfaces.                                                       |
| `apps/video-room/public/_worker.js`                  | Pages worker         | Proxies `/api/v1/*` to API worker. Sets `X-Pipe-Dev-Proxy-Secret` header.                                                 |
| `workers/api/src/index.ts`                           | API entry point      | Hono app. Route mounting order matters (see gotchas).                                                                     |
| `workers/api/src/routes/meetingRooms.ts`             | Meeting room routes  | Workspace launch/destroy/status/proxy endpoints.                                                                          |
| `workers/api/src/durable-objects/DevContainerDO.ts`  | Container DO         | Manages container lifecycle. Entry point override clones repo + starts code-server.                                       |
| `workers/api/src/lib/match/autoStageBuilder.ts`      | Repo/issue matching  | `autoStageBuilder`, `pickImplementationIssue`, `pickReviewPr`.                                                            |
| `workers/api/src/lib/repoDiscovery/matchRepos.ts`    | Repo scoring         | SQL-based repo matching against `qualified_repos` table.                                                                  |
| `workers/api/src/lib/challengeMatching/d1Matcher.ts` | Challenge matching   | Aligns candidate evidence to review challenge demands.                                                                    |
| `workers/api/wrangler.jsonc`                         | Worker config        | Container image config, D1 bindings, DO bindings.                                                                         |

### Window Manager Architecture

The window manager is the core abstraction. It must be:

1. **Generic** — any window is `{ id, type, title, content, position, size, zIndex, minimized, maximized }`
2. **Externally controllable** — `openWindow()`, `closeWindow()`, `focusWindow()`, `minimizeWindow()`, `maximizeWindow()`, `updateWindowContent()` are all callable from:
   - User clicks (taskbar buttons, desktop icons, window controls)
   - WebSocket messages (for AI agent control)
3. **Content-agnostic** — a `renderWindowContent(type, content)` function renders the right component based on window type

```typescript
type WindowType =
  | "video" // video call (remote + local)
  | "workspace" // code-server iframe
  | "chat" // conversational UI
  | "tasks" // goals/issues
  | "browser" // embedded browser (IE-style)
  | "paint" // MS Paint
  | "snippet" // code snippet viewer (AI-created)
  | "quiz" // quiz/question (AI-created)
  | "custom" // arbitrary content from AI
  | string; // extensible for future types

interface ManagedWindow {
  id: string;
  type: WindowType;
  title: string;
  content: unknown; // type-specific payload
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
}

interface WindowManager {
  windows: ManagedWindow[];
  activeWindowId: string | null;
  openWindow: (type: WindowType, title: string, content?: unknown) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updateWindowContent: (id: string, content: unknown) => void;
  moveWindow: (id: string, position: { x: number; y: number }) => void;
}
```

### Desktop Layout

```
Win95Desktop (teal #008080, fills viewport, position: relative)
├── Desktop Icons (absolute positioned, double-click to open)
│   ├── My Computer (workspace)
│   ├── Video Call
│   ├── Chat
│   ├── Tasks
│   ├── Internet Explorer (future)
│   └── MS Paint (future)
├── Managed Windows (absolute positioned, zIndex stacked)
│   ├── Win95Window: Video Call
│   ├── Win95Window: Workspace (code-server)
│   ├── Win95Window: Chat
│   └── Win95Window: Tasks
└── Win95Taskbar (fixed bottom)
    ├── Start Button (opens Start menu)
    ├── Window Buttons (one per open window)
    └── System Tray (clock, recording indicator, network)
```

### Data Flow for AI Agent (Future)

```
AI Agent (in container)
  ↓ WebSocket via proxy
Room Worker (Cloudflare Pages)
  ↓ Broadcast to room participants
Video Room App (browser)
  ↓ useWindowManager.openWindow() / updateWindowContent()
Win95 Desktop renders the window
```

The AI sends JSON commands like:

```json
{
  "type": "open_window",
  "window": {
    "windowType": "snippet",
    "title": "Explain this function",
    "content": { "language": "typescript", "code": "function foo() {...}" }
  }
}
```

Or:

```json
{
  "type": "chat_message",
  "message": {
    "from": "ai",
    "text": "Try checking the error handler in utils.ts"
  }
}
```

---

## 4. Full Feature List

### Phase 1 — Desktop Shell (BUILD THIS FIRST)

| #   | Feature                  | Description                                                                                                             | Status                                                                |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1.1 | `useWindowManager` hook  | Generic window state management (open/close/focus/minimize/maximize/drag/move). Externally controllable.                | Not started                                                           |
| 1.2 | `Win95Desktop` component | Teal background fills viewport. Houses desktop icons, windows, and taskbar.                                             | Not started                                                           |
| 1.3 | `Win95Taskbar` component | Bottom bar with Start button, window buttons, system tray (clock, recording indicator).                                 | Not started                                                           |
| 1.4 | `Win95Window` wrapper    | Generic draggable window. Title bar with minimize/maximize/close buttons. Drag by title bar. z-index stacking on focus. | Not started                                                           |
| 1.5 | Desktop icons            | Double-clickable icons on desktop. Each opens a specific window type.                                                   | Not started                                                           |
| 1.6 | Video Call window        | Remote + local video in a Win95 window. Mute/camera toggles as Win95 buttons. "Waiting for guest" state.                | Not started                                                           |
| 1.7 | Workspace window         | Wrap existing code-server iframe in window manager. Maximize = fullscreen. Title shows repo URL.                        | Partially built (has Win95 styling, needs window manager integration) |
| 1.8 | Chat window (UI only)    | Win95-style chat UI. Message bubbles (host vs candidate vs AI styling). Text input + send. Local state only.            | Not started                                                           |
| 1.9 | Integrate into `App.tsx` | Replace `call-stage` with `Win95Desktop`. Convert video + workspace to managed windows. Prejoin stays as-is.            | Not started                                                           |

### Phase 2 — Tasks, Time, and Real Chat

| #   | Feature                       | Description                                                                                                                                   | Status      |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2.1 | Tasks/goals window            | Shows issue(s) to work on. Issue title, description, acceptance criteria. Links to files.                                                     | Not started |
| 2.2 | Pre-room setup (cockpit)      | Host picks repo + selects issues from matched repos. Sets time limit. Writes custom instructions.                                             | Not started |
| 2.3 | `scheduled_interviews` schema | Add `issue_number`, `issue_title`, `time_limit_minutes`, `custom_instructions` columns.                                                       | Not started |
| 2.4 | Time limit / countdown        | Taskbar clock shows remaining time. Warning at 5 min. Auto-submit at 0. Workspace locks.                                                      | Not started |
| 2.5 | Chat over WebSocket           | Real-time chat between host and candidate. Messages stored in D1. Typing indicators.                                                          | Not started |
| 2.6 | Pass issue info to workspace  | `RoomWorkspacePayload` includes issue number/title. Displayed in tasks window. Container clones repo + checks out issue branch if applicable. | Not started |

### Phase 3 — AI Agent and Advanced Windows

| #   | Feature                   | Description                                                                                                                        | Status      |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 3.1 | AI agent in container     | Background process in code-server container. WebSocket connection to room. Watches files, runs tests, sends chat messages.         | Not started |
| 3.2 | AI window control         | AI can open/close/focus windows, create ad-hoc windows (snippets, quizzes, diagrams). Uses same `useWindowManager` methods.        | Not started |
| 3.3 | AI proctor mode           | When no host is present, AI runs the entire session: instructions, hints, Q&A, time management, review.                            | Not started |
| 3.4 | MS Paint window           | Canvas-based drawing app. Pencil, eraser, fill, color palette. Both participants can draw. AI can draw diagrams.                   | Not started |
| 3.5 | Browser window (IE-style) | Embedded browser in Win95 IE chrome. Address bar, back/forward/refresh. For viewing GitHub issues, docs, etc.                      | Not started |
| 3.6 | Shared context graph      | Meeting is a living context node. Chat, code changes, drawings, AI observations, test results all feed in.                         | Not started |
| 3.7 | Post-meeting review       | AI/host collects diff, test results, chat history. Opens Review window with inline comments, pass/fail, assessment summary, score. | Not started |
| 3.8 | Code review integration   | Connect existing code review components (`DiffPanel`, `FileTreePanel`, etc.) into a Review window type.                            | Not started |

---

## 5. Build & Deploy Commands

### Video Room (Frontend)

```bash
cd apps/video-room
npm run build                    # Build to dist/
npx wrangler deploy              # Deploy to Cloudflare Pages (room-dev.hire-pipe.com)
```

### API Worker (Backend)

```bash
cd workers/api
npx wrangler deploy --env dev    # Deploy to Cloudflare Workers (pipe-api-dev)
```

### Important: CDN Caching

Cloudflare Pages CDN can serve stale JS bundles. After deploying, you may need to:

- Add `?cb=1` query param to force cache bust
- Or wait for CDN cache to expire (~几分钟)
- Check the script `src` attribute in the browser to verify the correct hash is being served

---

## 6. Gotchas and Critical Details

### Route Ordering (API)

`meetingRooms` router MUST be mounted BEFORE `devContainerSessions` router in `workers/api/src/index.ts`. The `devContainerSessions` router has `use('*', authMiddleware)` which intercepts ALL `/api/v1/*` routes if mounted first, causing 401 errors on meeting room endpoints.

### Container Entrypoint Override

The stock `codercom/code-server:4.22.1` image does NOT run our custom `entrypoint.sh`. We override the entrypoint via Cloudflare Containers' `startOptions.entrypoint` in `DevContainerDO.ts`:

```typescript
const entrypoint = payload.repoGitUrl
  ? [
      "sh",
      "-c",
      `git clone --depth 1 ${payload.repoGitUrl} /workspace 2>&1; exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace`,
    ]
  : [
      "sh",
      "-c",
      "exec code-server --auth none --bind-addr 0.0.0.0:8080 /home/coder",
    ];
```

This clones the repo to `/workspace` and opens code-server pointing at that directory with auth disabled.

### Workspace Panel Must Stay Mounted

The workspace iframe MUST NOT be conditionally rendered (no `{workspaceOpen && <iframe>}`). If it unmounts, the iframe reloads from scratch on next open, losing the code-server state. Instead, always render it and toggle visibility with CSS:

```css
.workspace-window-wrapper {
  visibility: hidden;
  pointer-events: none;
  opacity: 0;
}
.workspace-window-wrapper.is-open {
  visibility: visible;
  pointer-events: auto;
  opacity: 1;
}
```

### API Authentication (Dev)

Dev API requests require the `X-Pipe-Dev-Proxy-Secret: pipe-dev-proxy-secret-2026` header. The video room's `_worker.js` adds this automatically when proxying `/api/v1/*` requests.

### Prejoin Workspace Variables Scope

Workspace-derived variables (`workspaceSession`, `workspaceReady`, `workspaceUrl`, `canLaunchWorkspace`, `showWorkspacePanel`, `needsRepoUrl`, `hasActiveWorkspace`) must be declared BEFORE the `inLobby` check in `App.tsx`, because the prejoin UI (which renders when `inLobby` is true) needs access to them.

### React95 Integration

The app uses `@react95.io/ui` for Win95 components (`Window`, `WindowHeader`, `WindowContent`, `ThemeProvider`, `GlobalStyle`). A custom PIPE-infused theme (`pipeWin95Theme`) extends the flat theme with PIPE brand colors. The `Win95GlobalStyles` component applies global font and style overrides.

### Existing React95 Imports in App.tsx

```typescript
import {
  Window,
  WindowHeader,
  WindowContent,
  ThemeProvider,
  GlobalStyle as Win95GlobalStyles,
} from "@react95.io/ui";
import { pipeWin95Theme } from "../themes/win95Theme";
```

### Lint Warning (Pre-existing)

There is a pre-existing lint warning: `React Hook useEffect has a missing dependency: 'room'` at line ~308 of `App.tsx`. This is a known issue and should not block work.

---

## 7. Design Decisions Already Made

1. **No window resize library** — dragging is implemented with simple `mousedown`/`mousemove`/`mouseup` + `useState`. No `react-draggable` or similar dependency.
2. **Z-index stacking** — increment a counter on focus. Each focused window gets `zIndex = ++counter`.
3. **Prejoin screen stays as-is** — Win95 desktop only appears after entering the room. Prejoin can be Win95-styled later.
4. **Workspace iframe stays mounted** — CSS visibility toggle, never conditional render.
5. **Window manager is hook-based** — `useWindowManager()` returns state + actions. Can be called from React components or from a WebSocket message handler.
6. **AI agent runs inside the container** — not as a separate service. It has filesystem access, can watch files, run tests, and communicate via WebSocket through the proxy.
7. **Teal `#008080` desktop** — classic Win95. Blue/gray window chrome from React95. Both coexist.
8. **Chat is a first-class citizen** — not a sidebar or overlay. It's a window on the desktop, same as everything else.

---

## 8. What to Build First (Phase 1)

### Step 1: Create `useWindowManager` hook

File: `apps/video-room/src/hooks/useWindowManager.ts`

Implement the full `WindowManager` interface (see architecture section above). Use `useState` for windows array and z-index counter. All operations: open, close, focus, minimize, maximize, move, updateContent.

### Step 2: Create `Win95Desktop` component

File: `apps/video-room/src/components/Win95Desktop.tsx`

Renders the teal background, desktop icons, managed windows, and taskbar. Takes `useWindowManager` state as props (or uses context). Each managed window is rendered as a `Win95Window` with its content.

### Step 3: Create `Win95Taskbar` component

File: `apps/video-room/src/components/Win95Taskbar.tsx`

Bottom bar. Start button (opens a simple menu listing available window types). One button per open window (click to focus/minimize toggle). System tray with clock and recording indicator.

### Step 4: Create `Win95Window` wrapper

File: `apps/video-room/src/components/Win95Window.tsx`

Generic window wrapper. Uses React95 `Window` component. Title bar with minimize/maximize/close. Drag implementation via mouse events. Renders children content inside `WindowContent`.

### Step 5: Create `Win95ChatWindow` component

File: `apps/video-room/src/components/Win95ChatWindow.tsx`

Win95-style chat UI. Message list (scrollable). Different bubble styles for host/candidate/AI. Text input + send button. Local state only for now (no backend). Think MSN Messenger / WinPopup aesthetic.

### Step 6: Integrate into `App.tsx`

Replace the `<main className="call-stage">` section (when `!inLobby`) with `<Win95Desktop>`. Convert:

- Video feeds → Video Call window
- Workspace panel → Workspace window (already has Win95 styling, just wrap in window manager)
- Add Chat window (open by default)
- Add desktop icons

### Step 7: CSS

Add styles for desktop, taskbar, icons, chat window, and window manager to `styles.css`.

### Step 8: Build, deploy, verify

```bash
cd apps/video-room && npm run build && npx wrangler deploy
```

Open `https://room-dev.hire-pipe.com/room/92NfvuhN5xbgH-XGNyAPgN644TTmK5GtCR5PjAFTh5w?cb=1` and verify the desktop renders.

---

## 9. Environment Details

| Item                 | Value                                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| Video room URL       | `https://room-dev.hire-pipe.com/room/92NfvuhN5xbgH-XGNyAPgN644TTmK5GtCR5PjAFTh5w` |
| API URL              | `https://api-dev.hire-pipe.com`                                                   |
| Dev proxy secret     | `pipe-dev-proxy-secret-2026`                                                      |
| code-server password | `pipe` (not needed with `--auth none`)                                            |
| Docker image         | `docker.io/codercom/code-server:4.22.1`                                           |
| Wrangler env         | `dev`                                                                             |
| Cloudflare account   | `jorybraun25`                                                                     |
| D1 database          | `pipe-api-dev-db`                                                                 |
| Container DO         | `DevContainerDO`                                                                  |

---

## 10. The Living Context Graph (PIPE's Hypergraph)

> **This is the semantic foundation of PIPE-OS. The Win95 Desktop Room is a UI layer on top of this system. Understanding the graph is essential for building the AI agent, chat, tasks, and review features.**

### What Is the Living Context Graph?

PIPE-OS is built around a **living context graph** — a source-backed semantic hypergraph that connects people, roles, repositories, code, and match decisions through evidence-bearing records.

This is NOT a simple node-edge graph. It is a **hypergraph**: one context record can connect multiple entities, concepts, source spans, and match decisions simultaneously, preserving the full meaning of the evidence.

### Core Principles (from G-001 and ADR-043)

1. **No hard-coded semantics**: Skills, signals, domains, aliases, node types, and semantic edges are learned from evidence as open data. Unknown concepts must survive ingestion without code changes. (ADR-043)
2. **Source-backed everything**: Every user-visible conclusion must link to immutable source evidence (transcript paragraph, resume line, repo file/line, assessment response). No displayed conclusion is trusted without a source span, unless explicitly marked as a gap.
3. **One person graph**: Contacts and applicants share one underlying person. Resumes, meetings, interviews, messages, and assessments all add context to the same evolving person graph.
4. **Interaction vs accumulated evidence**: Interaction-level evidence (a specific meeting, a specific resume) stays separate from accumulated person evidence (the overall picture). This prevents laundering one interaction's claims into general truth.
5. **Deterministic matching**: Candidate-to-PR matching selects a specific reviewable PR challenge based on source-backed evidence. No fabricated seniority, no default evidence, no generic fallback, no embedding-only decisions.
6. **Explainable matches**: Every match shows aligned candidate evidence to code demand, links both sides to exact sources, and reports gaps and stretch areas explicitly.
7. **Rebuildable projections**: Neo4j, search indexes, and UI graph views are projections rebuildable from the persisted D1 source of truth. They are never the source of truth themselves.

### The Hypergraph Model

A normal graph edge says:

```
candidate -> knows -> Kafka
```

PIPE's source-backed hyperedge (context record) says:

```
context_record:
  scope: workspace_person/person-123
  predicate: described production incident recovery work
  source: transcript paragraph 14 (exact text preserved)
  entities:
    - person-123 as subject
    - meeting-456 as interaction
    - repo_challenge_packet-789 as later aligned demand
  concepts:
    - term:incident-recovery
    - term:kafka
  qualifiers:
    tense: past_work
    evidence_kind: self_reported_interview
  confidence: 0.85
  polarity: 1
  extraction_version: "v2"
  observed_at: 2026-06-20T14:30:00Z
```

One record connects multiple nodes, concepts, sources, and later match decisions without flattening meaning into disconnected binary edges.

### Graph Scopes

| Scope                   | What it represents                                                          |
| ----------------------- | --------------------------------------------------------------------------- |
| `role_context`          | What a hiring team means by the role (from JD, role conversations, rubrics) |
| `workspace_person`      | What PIPE knows about a person across all interactions                      |
| `repo`                  | Source-backed repository structure and behavior                             |
| `repo_challenge_packet` | A reviewable PR challenge derived from repo evidence                        |
| `match`                 | An evidence-backed decision connecting person, role, and challenge          |

### Key Data Entities

| Entity                    | Purpose                                                                             | Key Tables                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Person**                | Underlying person across contacts/applicants                                        | `people`, `workspace_people`                                                                          |
| **Interaction**           | A specific meeting, interview, message, or assessment                               | `interactions`                                                                                        |
| **Artifact**              | Immutable original content (transcript, resume, PR diff)                            | `artifacts`, `artifact_versions`                                                                      |
| **Source Span**           | Exact line/paragraph/byte range that supports an assertion                          | `source_spans`                                                                                        |
| **Context Record**        | The core hyperedge — one meaning-bearing assertion with sources, entities, concepts | `context_records`, `context_record_source_refs`, `context_record_entities`, `context_record_concepts` |
| **Semantic Assertion**    | Extracted assertion from source evidence                                            | `semantic_assertions`, `assertion_source_spans`, `assertion_concepts`                                 |
| **Concept**               | Open semantic term learned from evidence                                            | `concepts`, `concept_surfaces`, `concept_resolutions`, `concept_adjacencies`                          |
| **Signal**                | Accumulated evidence score for a person/concept                                     | `signal_evidence`, `signal_snapshots`                                                                 |
| **Episode**               | Narrative grouping of assertions                                                    | `episodes`                                                                                            |
| **Semantic Relationship** | Entity-to-entity relationship derived from assertions                               | `semantic_relationships`                                                                              |
| **Projection Outbox**     | Rebuildable projection jobs                                                         | `projection_outbox`                                                                                   |

### Key Files

| File                                                                   | Purpose                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/api/src/lib/livingContext/persistence.ts`                     | `LivingContextStore` class — upserts for all graph entities (people, interactions, artifacts, source spans, context records, assertions, concepts, signals, relationships, projections)                    |
| `workers/api/src/lib/livingContext/readModel.ts`                       | Read model assembly — queries D1 and assembles `LivingContextReadModel` with interactions, artifacts, context records, assertions, signals, relationships                                                  |
| `workers/api/src/lib/livingContext/conceptRegistry.ts`                 | `D1ConceptRegistry` — concept registration, resolution, adjacency, open-term backfill. Concepts are learned from evidence, never hard-coded                                                                |
| `workers/api/src/lib/livingContext/types.ts`                           | TypeScript interfaces for all graph entity inputs                                                                                                                                                          |
| `src/lib/api/types.ts`                                                 | Frontend TypeScript types: `LivingContextReadModel`, `LivingContextRecord`, `LivingContextAssertion`, `LivingContextSignal`, `LivingContextInteraction`, `LivingContextArtifact`, `LivingContextSourceRef` |
| `src/lib/livingContextTree.ts`                                         | Tree builder for graph visualization — organizes context into interaction branches and accumulated context                                                                                                 |
| `src/components/Candidate/LivingContextGraph.tsx`                      | React component rendering the living context graph with interaction branches, evidence cards, source spans, match bridge                                                                                   |
| `src/hooks/useLivingContext.ts`                                        | Hook for fetching living context from the API                                                                                                                                                              |
| `brain/goals/G-001-living-context-graph-and-deterministic-matching.md` | The master goal document with 8 acceptance criteria                                                                                                                                                        |
| `brain/plans/P-001-living-context-graph-and-deterministic-matching.md` | Execution plan with 7 phases, gates, and anti-fake invariants                                                                                                                                              |
| `docs/plans/scoped-living-context-graph-v1.md`                         | V1 scoped contract — the minimum useful loop (role + person + repo → match → visualization)                                                                                                                |
| `docs/plans/living-context-graph-tracker.md`                           | Acceptance tracker with per-criterion evidence and status                                                                                                                                                  |

### How the Graph Connects to the Win95 Desktop Room

The Win95 Desktop Room is a **new interaction surface** that feeds the graph:

1. **Video meeting as interaction**: When host and candidate enter the room, it creates an `interaction` of type `video_meeting`. Recording transcripts become `meeting_transcript` artifacts with exact source spans.

2. **Chat messages as evidence**: Chat messages in the Win95 chat window become source-backed context records. Each message is a source span. AI observations extracted from chat become assertions linked to those spans.

3. **Code changes as repo evidence**: When the candidate edits code in the code-server container, file saves and diffs become repo source spans. These feed back into the `repo` scope graph.

4. **AI agent as graph writer**: The AI agent (Phase 3) writes context records, assertions, and signals to the graph in real-time. It observes the candidate's work, conversation, and progress, and persists source-backed semantic evidence.

5. **Match decision as graph node**: When a repo and issue are selected for the interview, a `match` context record connects the role context, person context, and repo challenge packet. This is the "goals" the candidate sees in the Tasks window.

6. **Post-meeting review as graph evidence**: After the session, the candidate's diff, test results, and AI assessment become context records in the `match` scope, linked to the original repo source spans and the candidate's person graph.

### Data Flow: Room → Graph

```
Video Room (Win95 Desktop)
├── Video recording → transcript → meeting_transcript artifact → source spans → context records
├── Chat messages → message artifact → source spans → context records
├── Code changes (in container) → repo source spans → context records
├── AI observations → semantic assertions → signal evidence
└── Match decision → match context record (connects role + person + repo)

All of the above persist to D1 via LivingContextStore.
The graph read model (LivingContextReadModel) is queryable by scope.
Projections (Neo4j, search) are rebuildable from D1.
```

### Anti-Fake Invariants (Must Not Violate)

- Do NOT fabricate source evidence, confidence, seniority, role requirements, candidate strengths, repositories, PRs, labels, or match targets.
- Do NOT use embedding similarity as the final semantic decision without source-backed context records and provenance.
- Do NOT fill missing role evidence with synthesized defaults, persona defaults, fallback skill lists, or hard-coded non-negotiables.
- Do NOT convert unknown concepts into code-owned taxonomies, enums, aliases, or skill maps.
- Do NOT call the system production-ready before browser E2E, idempotent backfills, rebuildable projections, and expert-labelled evaluation pass.

### V1 Acceptance Checks (from scoped-living-context-graph-v1.md)

1. A role source appears in the graph with exact source text and open concepts.
2. A candidate or developer source appears in the graph with exact source text and open concepts.
3. A repo or PR source appears in the graph with exact file/line provenance and open concepts.
4. A match connects role, person, and repo context records without generic fallback.
5. The match explanation shows aligned evidence, missing evidence, and stretch areas.
6. The visualization renders source-backed context records as inspectable hyperedges.
7. Unknown concepts survive ingestion without code changes.
8. Projections can be deleted and rebuilt from artifacts, source spans, context records, concepts, and source refs.
9. The browser E2E proves the loop from input to graph to match overlay.
10. The evaluation gate uses expert-labelled examples with reviewer and source provenance.

### Current Graph Status (as of June 2026)

- **Strong partial proof** for criteria 1-7 (person graph, source preservation, dynamic semantics, repo decomposition, evidence-based matching, explainable matches, visualization)
- **In progress** for criterion 8 (production quality: E2E, idempotent backfills, expert-labelled evaluation)
- **Blocker**: GitHub Actions billing/spending-limit preventing remote E2E with live packets
- **Key achievement**: The recording-to-match loop is proven — host records a meeting, transcript is processed, candidate converges to person graph, deterministic matcher selects a source-backed PR packet, and recruiter CONTEXT renders the evidence bridge
- **Remote D1**: Has 2,883 qualified repos, 12,871 sample PRs, 622 eligible sample PRs, but missing review-graph tables (migrations pending)

---

## 11. Rules for AI Agents Working on This

1. **Do NOT close any Linear ticket without visual verification** using browser DevTools (screenshot, element inspection, or Lighthouse audit).
2. **Do NOT conditionally render the workspace iframe** — it must stay mounted with CSS visibility toggle.
3. **Do NOT change route mounting order** in `workers/api/src/index.ts` — `meetingRooms` before `devContainerSessions`.
4. **Do NOT remove the entrypoint override** in `DevContainerDO.ts` — without it, code-server opens `/home/coder` instead of `/workspace` and requires a password.
5. **Always add `?cb=1`** to the room URL when testing after deploy to bypass CDN cache.
6. **Always build before deploy** — `npm run build` then `npx wrangler deploy`.
7. **Keep changes minimal and focused** — don't refactor unrelated code.
8. **Follow existing code style** — no comments unless asked, no emojis, terse and direct.
9. **Test visually** — use chrome-devtools MCP to take screenshots and verify the desktop renders correctly.
10. **Update this document** when you complete a phase or make architectural decisions.
11. **Do NOT fabricate source evidence** — every graph assertion must link to a real source span. No fake confidence, seniority, or match targets.
12. **Do NOT hard-code semantics** — concepts, signals, aliases, and predicates are learned from evidence as open data. Unknown terms must survive ingestion.
13. **Do NOT use embedding similarity as the final decision** without source-backed context records and provenance.

---

## 12. Contact / Context

- **User**: Hans (jorybraun25 on GitHub)
- **Project**: PIPE-OS — an AI-powered technical interview platform
- **Repo**: `/Users/hans/Code/PIPE/PIPE-OS`
- **Current focus**: Phase 1 — Win95 Desktop Shell

If you're an AI agent picking this up: start with Step 1 in section 8. Build the `useWindowManager` hook first, then the desktop shell, then integrate into `App.tsx`. Deploy and verify visually before moving to the next step.
