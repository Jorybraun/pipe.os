import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, spawn } from 'child_process';
import { loadPMData, savePMData } from './utils.js';
import { scanCommits, getLastSyncTime } from './scanner.js';
import { analyzeCommitsBatch, analyzeFeatureStatus, analyzeLambda, generateBDD, parseSchema, generateDataFlowDiagram } from './claude-analyzer.js';
import { findFeatureByName } from './utils.js';
import { HarnessBridge } from './harness-bridge.js';
import { syncKnowledgePlan, decomposeStrategyDoc } from './knowledge-sync.js';

const harnessBridge = new HarnessBridge();

/** Helper: parse JSON body from request */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** Helper: send JSON response */
function jsonRes(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Helper: route URL matching */
function matchRoute(url, pattern) {
  // pattern like /api/feature/:id
  const patternParts = pattern.split('/');
  const urlParts = url.split('?')[0].split('/');
  if (patternParts.length !== urlParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PM_FILE = process.env.PM_DATA_FILE || 'pm.json';
const REPO_PATH = process.env.GIT_REPO_PATH || '..';
const PORT = 3333;

// Track sync state
let isSyncing = false;

// Create server
const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-*', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Routes
  if (req.url === '/' && req.method === 'GET') {
    serveFile(res, path.join(__dirname, 'index.html'), 'text/html');
  } else if (req.url === '/api/data' && req.method === 'GET') {
    const pmData = loadPMData(PM_FILE);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pmData));
  } else if (req.url === '/api/sync' && req.method === 'POST') {
    if (isSyncing) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sync already in progress' }));
      return;
    }

    isSyncing = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });

    try {
      await syncAndUpdateData();
      res.end(JSON.stringify({ success: true, message: 'Sync complete' }));
    } catch (error) {
      res.end(JSON.stringify({ error: error.message }));
    } finally {
      isSyncing = false;
    }
  } else if (req.url === '/api/tasks' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const pmData = loadPMData(PM_FILE);
      if (pmData) { const {tasks} = JSON.parse(body); pmData.tasks = tasks; savePMData(PM_FILE, pmData); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } else if (req.url === '/api/features' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const pmData = loadPMData(PM_FILE);
      if (pmData) { const {features} = JSON.parse(body); pmData.features = features; savePMData(PM_FILE, pmData); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } else if (req.url === '/api/lambda-docs' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}');
        const pmData = loadPMData(PM_FILE);
        const targets = name
          ? pmData.lambdas.filter(l => l.name === name)
          : pmData.lambdas.filter(l => l.status !== 'stub');

        for (const lambda of targets) {
          const fnPath = path.resolve(__dirname, REPO_PATH, 'amplify/functions', lambda.name);
          if (!fs.existsSync(fnPath)) {
            console.log(`[lambda-docs] No source found for ${lambda.name}, skipping`);
            continue;
          }

          let code = '';
          for (const fname of ['handler.ts', 'types.ts', 'resource.ts']) {
            const fp = path.join(fnPath, fname);
            if (fs.existsSync(fp)) {
              const content = fs.readFileSync(fp, 'utf-8');
              code += `\n// === ${fname} ===\n${content.slice(0, 3000)}`;
            }
          }

          console.log(`[lambda-docs] Documenting ${lambda.name}...`);
          const docs = await analyzeLambda(lambda.name, code);
          if (docs) {
            lambda.docs = docs;
            lambda.docsUpdated = new Date().toISOString().split('T')[0];
          }
          // Small delay to avoid rate limiting
          await new Promise(r => setTimeout(r, 600));
        }

        savePMData(PM_FILE, pmData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: targets.length }));
      } catch (err) {
        console.error('[lambda-docs] Error:', err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.url === '/api/page-sync' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { featureId } = JSON.parse(body);
      const pmData = loadPMData(PM_FILE);
      const feature = pmData.features.find(f => f.id === featureId);
      if (!feature) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Feature not found' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

      const repoPath = path.resolve(__dirname, REPO_PATH);
      const prompt = buildFeaturePrompt(feature);

      console.log(`[page-sync] Streaming Claude assessment for: ${feature.name}`);
      send({ type: 'start', feature: feature.name });

      const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
        cwd: repoPath,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let accumulated = '';

      proc.stdout.on('data', chunk => {
        const text = chunk.toString();
        accumulated += text;
        send({ type: 'output', text });
      });

      proc.stderr.on('data', chunk => {
        send({ type: 'output', text: chunk.toString() });
      });

      proc.on('close', (code, signal) => {
        console.log(`[page-sync] Claude exited code=${code} signal=${signal}, output length: ${accumulated.length}`);
        if (accumulated.length > 0) console.log('[page-sync] First 200 chars:', accumulated.slice(0, 200));
        const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
        let assessment = null;
        if (jsonMatch) {
          try {
            assessment = JSON.parse(jsonMatch[0]);
            feature.status = assessment.status || feature.status;
            feature.syncNote = assessment.reason;
            feature.lastSync = new Date().toISOString().split('T')[0];
            if (assessment.journeys) {
              feature.journeys = feature.journeys || [];
              let newCount = 0;
              assessment.journeys.forEach(aj => {
                const existing = feature.journeys.find(j =>
                  j.name.toLowerCase() === aj.name.toLowerCase()
                );
                if (existing) {
                  existing.status = aj.status;
                  if (aj.note) existing.syncNote = aj.note;
                } else if (aj.discovered) {
                  // Add newly discovered journey
                  feature.journeys.push({
                    name: aj.name,
                    status: aj.status,
                    bdd: null,
                    syncNote: aj.note,
                    discovered: true
                  });
                  newCount++;
                }
              });
              if (newCount > 0) console.log(`[page-sync] Discovered ${newCount} new journey(s) for ${feature.name}`);
            }
            savePMData(PM_FILE, pmData);
          } catch (e) {
            send({ type: 'error', text: 'Failed to parse JSON from Claude output' });
          }
        } else {
          send({ type: 'error', text: 'No JSON assessment found in output' });
        }
        send({ type: 'done', ok: !!assessment, assessment });
        res.end();
      });

      // Kill Claude if the SSE client disconnects mid-stream
      res.on('close', () => proc.kill());
    });
  } else if (req.url === '/api/test' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { grep } = JSON.parse(body);
        const repoPath = path.resolve(__dirname, REPO_PATH);
        const result = spawnSync('npx', ['playwright', 'test', '--grep', grep, '--reporter=line'], {
          cwd: repoPath,
          timeout: 90000,
          encoding: 'utf-8',
          env: { ...process.env }
        });
        const output = (result.stdout || '') + (result.stderr || '');
        const passed = result.status === 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ passed, output: output.slice(-2000) }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ passed: false, output: err.message }));
      }
    });
  }
  // ──────────────────────────────────────────────────────────
  // NEW API ENDPOINTS
  // ──────────────────────────────────────────────────────────
  else if (req.url === '/api/feature' && req.method === 'POST') {
    try {
      const { feature } = await parseBody(req);
      const pmData = loadPMData(PM_FILE);
      const idx = pmData.features.findIndex(f => f.id === feature.id);
      if (idx >= 0) {
        pmData.features[idx] = { ...pmData.features[idx], ...feature };
      } else {
        pmData.features.push(feature);
      }
      savePMData(PM_FILE, pmData);
      jsonRes(res, { ok: true });
    } catch (e) { jsonRes(res, { error: e.message }, 400); }
  }
  else if (matchRoute(req.url, '/api/feature/:id') && req.method === 'DELETE') {
    const { id } = matchRoute(req.url, '/api/feature/:id');
    const pmData = loadPMData(PM_FILE);
    pmData.features = pmData.features.filter(f => f.id !== id);
    savePMData(PM_FILE, pmData);
    jsonRes(res, { ok: true });
  }
  else if (req.url === '/api/item' && req.method === 'POST') {
    try {
      const { type, featureId, data: itemData } = await parseBody(req);
      const pmData = loadPMData(PM_FILE);

      if (type === 'task') {
        const task = { id: `T-${Date.now()}`, status: 'todo', ...itemData, featureId };
        pmData.tasks.push(task);
      } else if (['bug', 'request', 'note'].includes(type)) {
        const feature = pmData.features.find(f => f.id === featureId);
        if (!feature) { jsonRes(res, { error: 'Feature not found' }, 404); return; }
        const listKey = type === 'bug' ? 'bugs' : type === 'request' ? 'requests' : 'notes';
        if (!feature[listKey]) feature[listKey] = [];
        const item = { id: `${type}-${Date.now()}`, ...itemData };
        if (type === 'bug') { item.status = item.status || 'open'; item.logged = item.logged || new Date().toISOString().split('T')[0]; }
        if (type === 'request') { item.status = item.status || 'draft'; item.logged = item.logged || new Date().toISOString().split('T')[0]; }
        if (type === 'note') { item.date = item.date || new Date().toISOString(); }
        feature[listKey].push(item);
      } else {
        jsonRes(res, { error: 'Unknown type: ' + type }, 400); return;
      }

      savePMData(PM_FILE, pmData);
      jsonRes(res, { ok: true });
    } catch (e) { jsonRes(res, { error: e.message }, 400); }
  }
  else if (req.url === '/api/item' && req.method === 'DELETE') {
    try {
      const { type, id, featureId } = await parseBody(req);
      const pmData = loadPMData(PM_FILE);

      if (type === 'task') {
        pmData.tasks = pmData.tasks.filter(t => t.id !== id);
      } else if (['bug', 'request', 'note'].includes(type)) {
        const feature = pmData.features.find(f => f.id === featureId);
        if (feature) {
          const listKey = type === 'bug' ? 'bugs' : type === 'request' ? 'requests' : 'notes';
          feature[listKey] = (feature[listKey] || []).filter(x => x.id !== id);
        }
      }

      savePMData(PM_FILE, pmData);
      jsonRes(res, { ok: true });
    } catch (e) { jsonRes(res, { error: e.message }, 400); }
  }
  else if (req.url === '/api/work-log' && req.method === 'POST') {
    try {
      const entry = await parseBody(req);
      const pmData = loadPMData(PM_FILE);
      pmData.workLog.push({
        date: new Date().toISOString().split('T')[0],
        ...entry,
        autoDetected: false,
      });
      savePMData(PM_FILE, pmData);
      jsonRes(res, { ok: true });
    } catch (e) { jsonRes(res, { error: e.message }, 400); }
  }
  else if (req.url?.startsWith('/api/search') && req.method === 'GET') {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const q = (urlObj.searchParams.get('q') || '').toLowerCase();
    if (!q) { jsonRes(res, { results: [] }); return; }
    const pmData = loadPMData(PM_FILE);
    const results = [];

    // Search features
    for (const f of pmData.features) {
      if (f.name.toLowerCase().includes(q) || f.route?.toLowerCase().includes(q)) {
        results.push({ type: 'feature', id: f.id, title: f.name, sub: f.route });
      }
      for (const j of (f.journeys || [])) {
        if (j.name.toLowerCase().includes(q)) results.push({ type: 'journey', id: f.id, title: j.name, sub: f.name });
      }
      for (const b of (f.bugs || [])) {
        if (b.title.toLowerCase().includes(q)) results.push({ type: 'bug', id: b.id, featureId: f.id, title: b.title, sub: f.name });
      }
      for (const r of (f.requests || [])) {
        if (r.title.toLowerCase().includes(q)) results.push({ type: 'request', id: r.id, featureId: f.id, title: r.title, sub: f.name });
      }
    }
    // Search tasks
    for (const t of pmData.tasks) {
      if (t.title.toLowerCase().includes(q) || t.brief?.toLowerCase().includes(q)) {
        results.push({ type: 'task', id: t.id, title: t.title, sub: t.priority });
      }
    }
    // Search lambdas
    for (const l of pmData.lambdas) {
      if (l.name.toLowerCase().includes(q) || l.desc?.toLowerCase().includes(q)) {
        results.push({ type: 'lambda', id: l.name, title: l.name, sub: l.category });
      }
    }
    // Search entities
    for (const e of pmData.entities) {
      if (e.name.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q)) {
        results.push({ type: 'entity', id: e.name, title: e.name, sub: e.description?.slice(0, 60) });
      }
    }

    jsonRes(res, { results: results.slice(0, 50) });
  }
  else if (req.url === '/api/generate-bdd' && req.method === 'POST') {
    try {
      const { featureId, journeyName, lambdaName } = await parseBody(req);
      console.log(`[generate-bdd] Generating BDD for ${lambdaName || journeyName}...`);
      const result = await generateBDD({ featureId, journeyName, lambdaName });
      jsonRes(res, { ok: true, result });
    } catch (e) { jsonRes(res, { error: e.message }, 500); }
  }
  else if (req.url === '/api/schema-sync' && req.method === 'POST') {
    try {
      console.log('[schema-sync] Parsing Amplify schema with Claude...');
      const result = await parseSchema();
      if (result) {
        const pmData = loadPMData(PM_FILE);
        if (result.entities) pmData.entities = result.entities;
        if (result.entityDiagram) pmData.entityDiagram = result.entityDiagram;

        // Cross-reference: which routes and lambdas use each entity
        for (const entity of pmData.entities) {
          entity.usedByRoutes = [];
          entity.usedByLambdas = [];
          for (const f of pmData.features) {
            if ((f.apiCalls || []).some(a => a.toLowerCase().includes(entity.name.toLowerCase()))) {
              entity.usedByRoutes.push(f.id);
            }
          }
          for (const l of pmData.lambdas) {
            if (l.docs?.dependencies?.some(d => d.toLowerCase().includes(entity.name.toLowerCase()))) {
              entity.usedByLambdas.push(l.name);
            }
          }
        }

        savePMData(PM_FILE, pmData);
        jsonRes(res, { ok: true, entityCount: pmData.entities.length });
      } else {
        jsonRes(res, { ok: false, error: 'Claude returned no data' });
      }
    } catch (e) { jsonRes(res, { error: e.message }, 500); }
  }
  else if (req.url === '/api/lambda-source' && req.method === 'POST') {
    try {
      const { name } = await parseBody(req);
      const fnPath = path.resolve(__dirname, REPO_PATH, 'amplify/functions', name);
      const files = {};
      for (const fname of ['handler.ts', 'types.ts', 'resource.ts', 'index.ts']) {
        const fp = path.join(fnPath, fname);
        if (fs.existsSync(fp)) {
          files[fname] = fs.readFileSync(fp, 'utf-8');
        }
      }
      jsonRes(res, { ok: true, files });
    } catch (e) { jsonRes(res, { error: e.message }, 500); }
  }
  else if (req.url === '/api/test-all' && req.method === 'POST') {
    try {
      const { featureId } = await parseBody(req);
      const pmData = loadPMData(PM_FILE);
      const feature = pmData.features.find(f => f.id === featureId);
      if (!feature) { jsonRes(res, { error: 'Feature not found' }, 404); return; }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

      const repoPath = path.resolve(__dirname, REPO_PATH);
      const journeys = feature.journeys || [];
      let passCount = 0, failCount = 0;

      for (let i = 0; i < journeys.length; i++) {
        const j = journeys[i];
        send({ type: 'testing', index: i, name: j.name });

        const result = spawnSync('npx', ['playwright', 'test', '--grep', j.name, '--reporter=line'], {
          cwd: repoPath,
          timeout: 90000,
          encoding: 'utf-8',
          env: { ...process.env },
        });

        const output = (result.stdout || '') + (result.stderr || '');
        const passed = result.status === 0;
        if (passed) passCount++; else failCount++;

        // Update journey test result in pm.json
        j.lastTestResult = passed ? 'pass' : 'fail';
        j.lastTestDate = new Date().toISOString().split('T')[0];

        send({ type: 'result', index: i, name: j.name, passed, output: output.slice(-500) });
      }

      savePMData(PM_FILE, pmData);
      send({ type: 'done', passCount, failCount, total: journeys.length });
      res.end();
    } catch (e) {
      jsonRes(res, { error: e.message }, 500);
    }
  }
  else if (req.url === '/api/generate-flow-diagram' && req.method === 'POST') {
    try {
      const { featureId } = await parseBody(req);
      const pmData = loadPMData(PM_FILE);
      const feature = pmData.features.find(f => f.id === featureId);
      if (!feature) { jsonRes(res, { error: 'Feature not found' }, 404); return; }

      console.log(`[flow-diagram] Generating data flow for ${feature.name}...`);
      const result = await generateDataFlowDiagram(feature);
      if (result?.diagram) {
        pmData.dataFlowDiagrams[featureId] = result.diagram;
        savePMData(PM_FILE, pmData);
      }
      jsonRes(res, { ok: true, diagram: result?.diagram });
    } catch (e) { jsonRes(res, { error: e.message }, 500); }
  }
  else if (req.url === '/api/agent-run' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { type, id, featureId } = JSON.parse(body || '{}');
      const pmData = loadPMData(PM_FILE);

      let item, feature;
      if (type === 'task') {
        item = pmData.tasks.find(t => t.id === id);
        feature = pmData.features.find(f => f.id === (item?.featureId || featureId));
      } else if (type === 'bug') {
        feature = pmData.features.find(f => f.id === featureId);
        item = (feature?.bugs || []).find(b => b.id === id);
      }

      if (!item) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Item not found' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const repoPath = path.resolve(__dirname, REPO_PATH);
      const prompt = buildAgentPrompt(item, type, feature);

      console.log(`[agent-run] Starting agent for ${type} "${item.title}"`);
      send({ type: 'start', title: item.title });

      const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
        cwd: repoPath,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let accumulated = '';

      proc.stdout.on('data', chunk => {
        const text = chunk.toString();
        accumulated += text;
        send({ type: 'output', text });
      });

      proc.stderr.on('data', chunk => {
        send({ type: 'output', text: chunk.toString() });
      });

      proc.on('close', () => {
        // Parse structured JSON from Claude's last output line
        const jsonMatch = accumulated.match(/\{[^{}]*"summary"[^{}]*\}/);
        let update = null;
        if (jsonMatch) {
          try { update = JSON.parse(jsonMatch[0]); } catch {}
        }

        const summary = update?.summary || 'Agent run completed.';
        const nextStatus = update?.nextStatus || null;
        const filesChanged = update?.filesChanged || [];

        const workEntry = {
          date: new Date().toISOString().split('T')[0],
          summary,
          agentRan: true,
          filesChanged,
          claudeOutput: accumulated.slice(0, 8000),
        };

        // Re-load fresh pm.json and patch the item
        const freshData = loadPMData(PM_FILE);
        if (type === 'task') {
          const task = freshData.tasks.find(t => t.id === id);
          if (task) {
            task.workUpdates = task.workUpdates || [];
            task.workUpdates.push(workEntry);
            if (nextStatus && ['todo', 'in_progress', 'blocked', 'done'].includes(nextStatus)) {
              task.status = nextStatus;
            }
          }
        } else if (type === 'bug') {
          const feat = freshData.features.find(f => f.id === featureId);
          const bug = (feat?.bugs || []).find(b => b.id === id);
          if (bug) {
            bug.workUpdates = bug.workUpdates || [];
            bug.workUpdates.push(workEntry);
            if (nextStatus === 'closed') bug.status = 'closed';
          }
        }

        savePMData(PM_FILE, freshData);
        console.log(`[agent-run] Done. summary="${summary}" nextStatus=${nextStatus}`);
        send({ type: 'done', ok: true, summary, nextStatus, filesChanged });
        res.end();
      });

      res.on('close', () => proc.kill());
    });
  }
  else if (req.url === '/api/upload' && req.method === 'POST') {
    try {
      const { filename, data } = await parseBody(req);
      const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const assetsDir = path.join(__dirname, 'assets');
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);
      const base64 = data.replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(path.join(assetsDir, safeName), Buffer.from(base64, 'base64'));
      jsonRes(res, { ok: true, path: `/assets/${safeName}` });
    } catch (e) { jsonRes(res, { error: e.message }, 400); }
  }
  else if (req.url?.startsWith('/assets/') && req.method === 'GET') {
    const filename = req.url.slice('/assets/'.length).split('?')[0];
    if (filename.includes('..')) { res.writeHead(403); res.end('Forbidden'); return; }
    const filePath = path.join(__dirname, 'assets', filename);
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filename).toLowerCase();
    const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml'};
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  }

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
      // Don't kill harness on disconnect — let it finish
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

  else {
    res.writeHead(404);
    res.end('Not found');
  }
});

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function syncAndUpdateData() {
  let pmData = loadPMData(PM_FILE);
  if (!pmData) {
    throw new Error('pm.json not found');
  }

  const features = pmData.features || [];
  const featuresContext = features.map(f => f.name).join(', ');

  // Scan commits
  const lastSync = getLastSyncTime(pmData);
  const commits = await scanCommits(REPO_PATH, lastSync);

  if (commits.length === 0) {
    return;
  }

  // Analyze with Mistral
  const analyses = await analyzeCommitsBatch(commits, featuresContext);

  // Update features
  for (const analysis of analyses) {
    if (!analysis.analyzed) continue;

    for (const featureName of analysis.features) {
      const feature = findFeatureByName(features, featureName);
      if (!feature) continue;

      // Add to work log
      pmData.workLog = pmData.workLog || [];
      pmData.workLog.push({
        date: new Date().toISOString().split('T')[0],
        commit: analysis.commit,
        summary: analysis.summary,
        tags: [analysis.type],
        featuresImpacted: [feature.id],
        autoDetected: true
      });

      // Update status
      const recentCommits = commits.slice(-5);
      const statusAnalysis = await analyzeFeatureStatus(feature, recentCommits);
      feature.status = statusAnalysis.status;
      feature.lastChecked = new Date().toISOString();
    }
  }

  pmData.lastSync = new Date().toISOString();
  savePMData(PM_FILE, pmData);
}

function buildAgentPrompt(item, type, feature) {
  const featureCtx = feature
    ? `\nFEATURE: ${feature.name}\nROUTE: ${feature.route}\nMAIN COMPONENT: src/pages/${feature.component}\nFEATURE STATUS: ${feature.status}\nSYNC NOTE: ${feature.syncNote || 'none'}`
    : '';
  const linkedDocs = (item.linkedDocs || [])
    .map(d => `  - [${d.type.toUpperCase()}] ${d.title}${d.url ? ' → ' + d.url : ''}`)
    .join('\n') || '  none';

  if (type === 'bug') {
    return `You are an expert engineer on the Pipe OS project (AWS Amplify Gen 2 + React + TypeScript, codebase is in the current working directory).
Your task is to INVESTIGATE and FIX the following bug.

BUG ID: ${item.id}
TITLE: ${item.title}
SEVERITY: ${item.severity || 'P2'}
DESCRIPTION: ${item.description || 'No description provided'}
STEPS TO REPRODUCE: ${item.stepsToReproduce || 'Not provided'}
LOGGED: ${item.logged || 'unknown'}${featureCtx}
LINKED DOCS:
${linkedDocs}

Instructions:
1. Read the relevant source files to understand the bug fully.
2. Identify the root cause.
3. Implement the fix.
4. Confirm the fix is correct and doesn't break related behaviour.

When finished, output ONLY this JSON object on its own line (no markdown fences, no extra text after it):
{"summary":"concise description of what you found and fixed","nextStatus":"open or closed","filesChanged":["path/to/file"]}`;
  }

  return `You are an expert engineer on the Pipe OS project (AWS Amplify Gen 2 + React + TypeScript, codebase is in the current working directory).
Your task is to IMPLEMENT the following task.

TASK ID: ${item.id}
TITLE: ${item.title}
PRIORITY: ${item.priority || 'P1'}
DESCRIPTION: ${item.brief || 'No description provided'}
BDD / ACCEPTANCE CRITERIA:
${item.bdd ? item.bdd.split('\\n').map(l => '  ' + l).join('\n') : '  Not defined'}
NOTES: ${item.notes || 'None'}${featureCtx}
LINKED DOCS:
${linkedDocs}

Instructions:
1. Read the relevant source files to understand existing patterns.
2. Implement the required changes, following those patterns.
3. Confirm the acceptance criteria are satisfied.

When finished, output ONLY this JSON object on its own line (no markdown fences, no extra text after it):
{"summary":"concise description of what you implemented","nextStatus":"todo|in_progress|blocked|done","filesChanged":["path/to/file"]}`;
}

function buildFeaturePrompt(feature) {
  const journeyList = (feature.journeys || []).map((j, i) =>
    `  ${i + 1}. "${j.name}" [currently: ${j.status}]\n     BDD: ${j.bdd || 'no steps defined'}`
  ).join('\n\n');

  return `You are assessing the implementation status of the "${feature.name}" feature in the Pipe OS project (AWS Amplify Gen 2 + React + TypeScript).

FEATURE: ${feature.name}
ROUTE: ${feature.route}
MAIN COMPONENT: src/pages/${feature.component}
ALL COMPONENTS: ${(feature.components || []).join(', ')}
API CALLS: ${(feature.apiCalls || []).join(', ') || 'none'}
LAMBDAS: ${(feature.lambdas || []).join(', ') || 'none'}

YOUR TASK:
1. Read the main component file and any related hooks/components.
2. Assess every journey already listed below.
3. Discover any user journeys that exist in the code but are NOT listed — add them to your response.

KNOWN JOURNEYS TO ASSESS:
${journeyList || '  (none defined yet)'}

FOR EACH JOURNEY (known or discovered):
- Does the code exist and is it wired up?
- Are API calls and hooks actually called?
- Is anything gated behind a feature flag? (check src/config/featureFlags.ts)
- Are there TypeScript errors, broken imports, or missing dependencies?

STATUS DEFINITIONS:
- working: fully implemented, no blockers
- partial: partially implemented or unverified end-to-end
- broken: blocked by a bug, feature flag, or missing dependency
- missing: not implemented at all

DISCOVERED JOURNEYS: Look at the component for user actions (button handlers, form submits, navigation calls, API mutations) that represent distinct things a user can do. If you find actions not covered by the known journeys list, include them as new journeys in your response.

Read the files, then respond with ONLY this JSON — no markdown, no preamble:
{
  "status": "working|partial|broken|blocked",
  "reason": "1-2 sentence summary of the overall feature state",
  "journeys": [
    {"name": "journey name", "status": "working|partial|broken|missing", "note": "what you found", "discovered": false}
  ]
}

Set "discovered": true on any journey you found in the code that was NOT in the known journeys list above.`;
}

server.listen(PORT, () => {
  console.log(`\n📊 PM Dashboard: http://localhost:${PORT}\n`);
});
