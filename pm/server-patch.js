// ─── SERVER.JS PATCH: Add after the existing route handlers ─────────────────
// Place these `else if` blocks inside the `http.createServer` callback,
// BEFORE the final `else { 404 }` block.
//
// Also add to the top of server.js:
//   import { HarnessBridge } from './harness-bridge.js';
//   import { syncKnowledgePlan } from './knowledge-sync.js';
//   const harnessBridge = new HarnessBridge();

// ──────────────────────────────────────────────────────────
// HARNESS API ENDPOINTS
// ──────────────────────────────────────────────────────────

else if (req.url === '/api/harness-run' && req.method === 'POST') {
  try {
    const body = await parseBody(req);
    const { taskId, taskType, description, featureId, autoApprove = true } = body;
    
    const desc = description || (body.title || 'Untitled task');
    const run = harnessBridge.startRun(taskId, desc, REPO_PATH, autoApprove);
    
    jsonRes(res, { 
      ok: true, 
      taskId, 
      harnessTaskId: run.taskId, 
      status: 'running',
      autoApprove,
    });
  } catch (e) { jsonRes(res, { error: e.message }, 500); }
}

else if (req.url?.startsWith('/api/harness-status/') && req.method === 'GET') {
  const harnessTaskId = req.url.split('/').pop();
  const status = harnessBridge.getRunStatus(harnessTaskId);
  if (!status) { jsonRes(res, { error: 'Run not found' }, 404); return; }
  jsonRes(res, status);
}

else if (req.url === '/api/harness-runs' && req.method === 'GET') {
  jsonRes(res, { runs: harnessBridge.getAllRuns() });
}

else if (req.url?.startsWith('/api/harness-stream/') && req.method === 'GET') {
  const harnessTaskId = req.url.split('/').pop();
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  
  const initial = harnessBridge.getRunStatus(harnessTaskId);
  if (!initial) { send({ type: 'error', text: 'Run not found' }); res.end(); return; }
  send({ type: 'status', ...initial });

  let lastEventCount = initial.events?.length || 0;
  
  const interval = setInterval(() => {
    const status = harnessBridge.getRunStatus(harnessTaskId);
    if (!status) { send({ type: 'error', text: 'Run lost' }); clearInterval(interval); res.end(); return; }
    
    const newEvents = status.events?.slice(lastEventCount) || [];
    lastEventCount = status.events?.length || 0;
    
    send({ type: 'status', ...status, newEvents });
    
    if (status.status === 'completed') {
      send({ type: 'complete', result: status.result });
      clearInterval(interval);
      res.end();
    }
  }, 3000);

  res.on('close', () => {
    clearInterval(interval);
    // Don't kill the harness on SSE disconnect — let it finish
  });
}

else if (req.url === '/api/harness-sync' && req.method === 'POST') {
  try {
    const body = await parseBody(req);
    const { taskId, harnessTaskId, taskType, featureId } = body;
    
    const status = harnessBridge.getRunStatus(harnessTaskId);
    if (!status || status.status !== 'completed') {
      jsonRes(res, { error: 'Harness run not complete' }, 400); return;
    }

    const pmData = loadPMData(PM_FILE);
    const result = status.result || {};
    const workflowStatus = result.workflow_status || 'unknown';
    
    const workEntry = {
      date: new Date().toISOString().split('T')[0],
      summary: `Harness ${workflowStatus} — ${status.phase} — ${result.changed_files?.length || 0} files`,
      agentRan: true,
      filesChanged: result.changed_files || [],
      harnessResult: result,
      harnessEvents: status.events?.slice(-20),
      harnessDuration: status.duration,
    };

    // Update the task or bug
    if (taskType === 'task') {
      const task = pmData.tasks.find(t => t.id === taskId);
      if (task) {
        task.workUpdates = task.workUpdates || [];
        task.workUpdates.push(workEntry);
        if (workflowStatus === 'complete') task.status = 'done';
        else if (workflowStatus.includes('rejected')) task.status = 'blocked';
        else if (workflowStatus.includes('failed')) task.status = 'blocked';
      }
    } else if (taskType === 'bug') {
      const feature = pmData.features.find(f => f.id === featureId);
      const bug = feature?.bugs?.find(b => b.id === taskId);
      if (bug) {
        bug.workUpdates = bug.workUpdates || [];
        bug.workUpdates.push(workEntry);
        if (workflowStatus === 'complete') bug.status = 'closed';
      }
    }

    pmData.workLog.push({
      date: workEntry.date,
      summary: workEntry.summary,
      tags: ['harness', taskType, status.phase],
      harnessTaskId,
      autoDetected: false,
    });

    savePMData(PM_FILE, pmData);
    jsonRes(res, { ok: true, workEntry });
  } catch (e) { jsonRes(res, { error: e.message }, 500); }
}

// ──────────────────────────────────────────────────────────
// KNOWLEDGE SYNC ENDPOINTS
// ──────────────────────────────────────────────────────────

else if (req.url === '/api/knowledge-sync' && req.method === 'POST') {
  try {
    const body = await parseBody(req);
    const { includeStrategyDocs = false } = body;
    const pmData = loadPMData(PM_FILE);
    
    const newTasks = syncKnowledgePlan(pmData, { includeStrategyDocs });
    if (newTasks.length > 0) {
      pmData.tasks = [...pmData.tasks, ...newTasks];
      savePMData(PM_FILE, pmData);
    }
    
    jsonRes(res, { ok: true, added: newTasks.length, tasks: newTasks });
  } catch (e) { jsonRes(res, { error: e.message }, 500); }
}

else if (req.url === '/api/knowledge-decompose' && req.method === 'POST') {
  try {
    const body = await parseBody(req);
    const { docPath } = body;
    const pmData = loadPMData(PM_FILE);
    
    const newTasks = decomposeStrategyDoc(docPath, pmData);
    if (newTasks.length > 0) {
      pmData.tasks = [...pmData.tasks, ...newTasks];
      savePMData(PM_FILE, pmData);
    }
    
    jsonRes(res, { ok: true, added: newTasks.length, tasks: newTasks });
  } catch (e) { jsonRes(res, { error: e.message }, 500); }
}
