import fs from 'fs';
import path from 'path';

const KNOWLEDGE_DIR = '/root/.openclaw/workspace/pipe.os/knowledge/plan';

/**
 * Sync tasks from /knowledge/plan documents into PM dashboard.
 *
 * Reads current.md for active tasks and blockers.
 * Optionally reads all strategy docs for long-term tasks.
 *
 * Returns an array of task objects ready to push into pmData.tasks.
 */
export function syncKnowledgePlan(pmData, opts = {}) {
  const { includeStrategyDocs = false } = opts;
  const newTasks = [];

  // ── current.md ──
  const currentPath = path.join(KNOWLEDGE_DIR, 'current.md');
  if (fs.existsSync(currentPath)) {
    const current = fs.readFileSync(currentPath, 'utf-8');

    // Active tasks
    const activeMatch = current.match(/## Active\n([\s\S]*?)(?=\n## |$)/);
    if (activeMatch) {
      const lines = activeMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
      for (const line of lines) {
        const title = line.replace(/^-\s*/, '').trim();
        if (!title) continue;
        const existing = pmData.tasks.find(t => t.title === title && t.source === 'knowledge');
        if (!existing) {
          newTasks.push({
            id: `K-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title,
            brief: `From knowledge/plan/current.md: ${title}`,
            priority: 'P1',
            status: 'todo',
            source: 'knowledge',
            tags: ['knowledge-plan'],
            featureId: null,
            subtasks: [],
          });
        }
      }
    }

    // Blockers
    const blockersMatch = current.match(/## Blockers\n([\s\S]*?)(?=\n## |$)/);
    if (blockersMatch) {
      const lines = blockersMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
      for (const line of lines) {
        const title = line.replace(/^-\s*/, '').trim();
        if (!title || title.toLowerCase() === 'none.') continue;
        const existing = pmData.tasks.find(t => t.title === title && t.source === 'knowledge');
        if (!existing) {
          newTasks.push({
            id: `K-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title,
            brief: `BLOCKER from knowledge/plan/current.md: ${title}`,
            priority: 'P0',
            status: 'blocked',
            source: 'knowledge',
            tags: ['knowledge-plan', 'blocker'],
            featureId: null,
            subtasks: [],
          });
        }
      }
    }
  }

  // ── Strategy docs (optional) ──
  if (includeStrategyDocs) {
    const strategyFiles = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.startsWith('pipe-strategy-v2-part'));
    for (const file of strategyFiles) {
      const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf-8');
      // Look for markdown checkboxes or numbered tasks
      const taskMatches = content.matchAll(/^\s*[-*]\s*(?:\[.\]\s*)?(.+)$/gm);
      for (const match of taskMatches) {
        const title = match[1].trim();
        if (!title || title.length < 5) continue;
        const existing = pmData.tasks.find(t => t.title === title && t.source === 'knowledge');
        if (!existing) {
          newTasks.push({
            id: `K-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title,
            brief: `From ${file}: ${title}`,
            priority: 'P2',
            status: 'todo',
            source: 'knowledge',
            tags: ['knowledge-plan', 'strategy'],
            featureId: null,
            subtasks: [],
          });
        }
      }
    }
  }

  return newTasks;
}

/**
 * Decompose a strategy document into dashboard tasks.
 */
export function decomposeStrategyDoc(docPath, pmData) {
  if (!fs.existsSync(docPath)) return [];
  const content = fs.readFileSync(docPath, 'utf-8');
  const tasks = [];

  // Match phase headers: "## Phase 0: Consumption cutover"
  const phaseMatches = content.matchAll(/##\s*Phase\s*(\d+)[:\s]+(.+)/g);
  for (const match of phaseMatches) {
    const phaseNum = match[1];
    const phaseTitle = match[2].trim();
    const phaseId = `phase-${phaseNum}`;

    // Check if this phase already exists as a task
    const existingPhase = pmData.tasks.find(t => t.id === phaseId && t.source === 'knowledge');
    if (!existingPhase) {
      tasks.push({
        id: phaseId,
        title: `Phase ${phaseNum}: ${phaseTitle}`,
        brief: `Strategy phase from knowledge plan`,
        priority: 'P1',
        status: 'todo',
        source: 'knowledge',
        tags: ['knowledge-plan', 'phase'],
        featureId: null,
        subtasks: [],
      });
    }

    // Find tasks within this phase (between this header and the next ##)
    const phaseStart = content.indexOf(match[0]);
    const nextHeader = content.indexOf('## ', phaseStart + match[0].length);
    const phaseContent = nextHeader > 0
      ? content.slice(phaseStart, nextHeader)
      : content.slice(phaseStart);

    const taskMatches = phaseContent.matchAll(/^\s*[-*]\s*(?:\[.\]\s*)?(.+)$/gm);
    for (const taskMatch of taskMatches) {
      const taskTitle = taskMatch[1].trim();
      if (!taskTitle || taskTitle.length < 5) continue;
      const fullTitle = `Phase ${phaseNum}.${tasks.length + 1}: ${taskTitle}`;
      const existing = pmData.tasks.find(t => t.title === fullTitle && t.source === 'knowledge');
      if (!existing) {
        tasks.push({
          id: `K-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: fullTitle,
          brief: `Task from Phase ${phaseNum} strategy doc`,
          priority: 'P2',
          status: 'todo',
          source: 'knowledge',
          tags: ['knowledge-plan', 'phase-task'],
          parentTaskId: phaseId,
          featureId: null,
          subtasks: [],
        });
      }
    }
  }

  return tasks;
}
