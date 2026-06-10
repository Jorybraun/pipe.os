# Design Meeting with Designers in CEO-STUDIO Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Enable the CEO to initiate and conduct structured design meetings with specialized designer agents directly inside the CEO-STUDIO interface, allowing collaborative design discussions, feedback, and output generation while preserving transcripts and semantic graphs.

**Architecture:** Add a new "Design Meeting" mode to the existing CEO-STUDIO conversational interface. The mode will spawn or activate designer personas (e.g., UI Designer, UX Researcher, Visual Designer) as sub-agents or via the existing agent swarm. Meetings will be multi-turn conversations with explicit phases (briefing, ideation, critique, synthesis). All transcripts and derived semantic graphs are stored as first-class artifacts. The CEO remains the orchestrator.

**Tech Stack:** Hermes Agent runtime, Electron renderer (CEO-STUDIO), existing Kanban/domain system, agent personas (from devops/agent-personas skill), conversation analysis (from product/conversation-analysis-product-briefs skill), Mermaid for graph visualization.

---

### Task 1: Create the implementation plan directory and save this plan

**Objective:** Ensure the plan document exists in the canonical location.

**Files:**
- Create: `docs/plans/2026-06-05-design-meeting-ceo-studio.md`

**Step 1: Write the plan file**

Already performed by writing this document.

**Step 2: Commit**

```bash
git add docs/plans/2026-06-05-design-meeting-ceo-studio.md
git commit -m "docs: add implementation plan for design meeting feature in CEO-STUDIO"
```

### Task 2: Explore CEO-STUDIO codebase structure

**Objective:** Map all files, components, and entry points related to CEO-STUDIO and the conversational CEO interface.

**Files:**
- Test: (none yet)

**Step 1: Run discovery commands**

```bash
find /Users/hans/Code/PIPE/PIPE-OS -type d -name "*ceo*" -o -name "*studio*" 2>/dev/null | grep -v node_modules | grep -v .worktrees
ls -la /Users/hans/Code/PIPE/PIPE-OS/src/components/ | grep -i ceo
```

Expected: List of directories and files (currently only runtime/harness/brain/rooms/chan-board-ceo-studio and possible Electron renderer in a sibling or sub-package).

**Step 2: Read key configuration and entry files**

Read: `package.json` (scripts and dependencies for electron/renderer)
Read: Any `src/main.ts` or `src/renderer.tsx` if they exist for CEO-STUDIO
Read: `.hermes/config.yaml` or profile configs mentioning CEO_STUDIO

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: explore CEO-STUDIO file structure for design meeting feature"
```

### Task 3: Define designer personas and meeting phases

**Objective:** Create reusable designer agent personas and explicit meeting phase definitions that the CEO can load.

**Files:**
- Create: `knowledge/personas/designers/ui-designer.md`
- Create: `knowledge/personas/designers/ux-researcher.md`
- Create: `knowledge/personas/designers/visual-designer.md`
- Modify: `devops/agent-personas` skill (if it exists) or create new reference

**Step 1: Write UI Designer persona**

```markdown
# UI Designer Persona

**Role:** Senior Product UI Designer
**Expertise:** Component systems, visual hierarchy, accessibility (WCAG), Figma-to-code fidelity
**Meeting Behavior:** Speaks in concrete design language, references existing design systems, proposes specific component changes with rationale.
**Constraints:** Never implements code; only produces specs, mock descriptions, and critique.
```

**Step 2: Write similar files for UX Researcher and Visual Designer**

**Step 3: Run verification**

Manually review the three persona files for consistency with existing agent-personas skill.

**Step 4: Commit**

```bash
git add knowledge/personas/designers/
git commit -m "feat: add designer personas for CEO-STUDIO design meetings"
```

### Task 4: Add "Start Design Meeting" command / UI trigger in CEO-STUDIO

**Objective:** Provide the user (Hans) with an explicit way to start a design meeting from within the CEO conversation.

**Files:**
- Modify: CEO-STUDIO renderer component that handles slash commands or quick actions (exact path TBD from Task 2)
- Test: `src/test/design-meeting-trigger.test.tsx`

**Step 1: Write failing test for trigger**

```tsx
// src/test/design-meeting-trigger.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CEOStudio } from '../components/CEOStudio';

test('shows "Start Design Meeting" action when in CEO mode', () => {
  render(<CEOStudio mode="ceo" />);
  expect(screen.getByText(/start design meeting/i)).toBeInTheDocument();
});
```

**Step 2: Run test to verify failure**

```bash
npm test src/test/design-meeting-trigger.test.tsx -t "shows \"Start Design Meeting\""
```

Expected: FAIL — element not found (or component not implemented)

**Step 3: Implement minimal trigger UI**

Add a button or slash command `/design-meeting` that dispatches an event to start the meeting flow.

**Step 4: Run test to verify pass**

Expected: PASS

**Step 5: Commit**

```bash
git add src/components/CEOStudio.tsx src/test/design-meeting-trigger.test.tsx
git commit -m "feat: add design meeting trigger in CEO-STUDIO UI"
```

### Task 5: Implement meeting orchestrator that activates designer agents

**Objective:** When a design meeting is started, the CEO spawns/activates the required designer agents and manages turn-taking.

**Files:**
- Create: `src/ceo-studio/design-meeting/orchestrator.ts`
- Modify: existing agent activation / delegation code (path from exploration)

**Step 1: Write failing test**

```ts
test('orchestrator activates exactly 3 designer agents on start', async () => {
  const meeting = await startDesignMeeting({ topic: 'new dashboard' });
  expect(meeting.participants).toHaveLength(3);
});
```

**Step 2: Run test (expect failure)**

**Step 3: Minimal implementation using existing delegate_task or Hermes swarm primitives**

Use the existing delegation and persona system. Load the three designer personas.

**Step 4: Verify pass**

**Step 5: Commit**

### Task 6: Store raw transcripts + semantic graph for the meeting

**Objective:** Every design meeting produces a persistent transcript and a semantic node/edge graph (no summarization flattening).

**Files:**
- Create: `src/ceo-studio/design-meeting/transcript-store.ts`
- Create: `src/ceo-studio/design-meeting/semantic-graph.ts`

**Step 1-5:** Full TDD cycle for transcript storage and graph construction (use existing conversation-analysis-product-briefs patterns if present).

**Step 6: Commit**

### Task 7: Add visualization of the design meeting semantic graph

**Objective:** Render the conversation as an interactive node graph (Mermaid or similar) inside CEO-STUDIO after the meeting or live.

**Files:**
- Modify: CEO-STUDIO renderer to include graph view panel
- Test: visual regression or component test

Follow TDD.

**Commit after each sub-step.**

### Task 8: End-to-end verification and cleanup

**Objective:** Run full manual + automated verification that a complete design meeting can be started, conducted, and artifacts produced.

**Steps:**
1. Start CEO-STUDIO
2. Trigger `/design-meeting "Dashboard redesign"`
3. Observe 3 designers join
4. Conduct 4-5 turns of conversation
5. Verify transcript + graph saved
6. Verify no YAGNI features were added

**Commit:** "feat: complete design meeting flow in CEO-STUDIO"

---

**Plan complete and saved.** Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?