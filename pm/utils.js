import fs from 'fs';
import chalk from 'chalk';

/**
 * Utilities for PM system
 */

export function loadPMData(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return migratePMData(parsed);
    }
  } catch (error) {
    console.error('Failed to load pm.json:', error.message);
  }
  return null;
}

/**
 * Migrate pm.json data to latest schema.
 * Backfills missing fields with defaults so the app never crashes on old data.
 */
export function migratePMData(data) {
  if (!data) return data;

  // Top-level arrays
  if (!data.entities) data.entities = [];
  if (!data.entityDiagram) data.entityDiagram = '';
  if (!data.dataFlowDiagrams) data.dataFlowDiagrams = {};
  if (!data.workLog) data.workLog = [];
  if (!data.tasks) data.tasks = [];
  if (!data.features) data.features = [];
  if (!data.lambdas) data.lambdas = [];

  // Migrate features
  for (const f of data.features) {
    if (!f.notes) f.notes = [];
    if (!f.bugs) f.bugs = [];
    if (!f.requests) f.requests = [];
    if (!f.journeys) f.journeys = [];
    if (!f.components) f.components = [];
    if (!f.apiCalls) f.apiCalls = [];
    if (!f.lambdas) f.lambdas = [];

    // Migrate journeys
    for (const j of f.journeys) {
      if (j.lastTestResult === undefined) j.lastTestResult = null;
      if (j.lastTestDate === undefined) j.lastTestDate = null;
    }

    // Migrate bugs
    for (const b of f.bugs) {
      if (!b.labels) b.labels = [];
      if (!b.description) b.description = '';
      if (!b.stepsToReproduce) b.stepsToReproduce = '';
    }

    // Migrate requests
    for (const r of f.requests) {
      if (r.bdd === undefined) r.bdd = null;
    }
  }

  // Migrate tasks
  for (const t of data.tasks) {
    if (t.featureId === undefined) t.featureId = null;
    if (!t.tags) t.tags = [];
    if (t.blockedBy === undefined) t.blockedBy = null;
    if (!t.subtasks) t.subtasks = [];
    if (t.dueDate === undefined) t.dueDate = null;
    if (t.notes === undefined) t.notes = '';
  }

  // Migrate lambdas
  for (const l of data.lambdas) {
    if (l.bdd === undefined) l.bdd = null;
    if (l.lastTestResult === undefined) l.lastTestResult = null;
    if (l.lastTestDate === undefined) l.lastTestDate = null;
    if (!l.errorHandling) l.errorHandling = [];
    if (l.security === undefined) l.security = '';
  }

  return data;
}

export function savePMData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(chalk.green(`✓ Saved: ${filePath}`));
    return true;
  } catch (error) {
    console.error(chalk.red(`✗ Failed to save pm.json: ${error.message}`));
    return false;
  }
}

export function findFeatureById(features, id) {
  return features.find(f => f.id === id);
}

export function findFeatureByName(features, name) {
  return features.find(f => f.name.toLowerCase() === name.toLowerCase());
}

export function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}`;
}

export function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

export function getStatusColor(status) {
  const colors = {
    working: chalk.green,
    partial: chalk.yellow,
    broken: chalk.red,
    missing: chalk.dim,
    blocked: chalk.red,
    in_progress: chalk.cyan,
    open: chalk.red,
    closed: chalk.green,
    proposed: chalk.yellow
  };
  return (colors[status] || chalk.dim)(status);
}

export function getSeverityColor(severity) {
  const colors = {
    P0: chalk.red,
    P1: chalk.red,
    P2: chalk.yellow,
    P3: chalk.dim
  };
  return (colors[severity] || chalk.dim)(severity);
}

export function printTable(features) {
  if (!features || features.length === 0) {
    console.log(chalk.dim('No features found'));
    return;
  }

  console.log('\n' + chalk.bold('FEATURES\n'));
  console.log(
    chalk.dim('Name') +
    ' | ' +
    chalk.dim('Route') +
    ' | ' +
    chalk.dim('Status') +
    ' | ' +
    chalk.dim('Bugs') +
    ' | ' +
    chalk.dim('Requests')
  );
  console.log(chalk.dim('─'.repeat(100)));

  for (const feature of features) {
    const bugCount = feature.bugs ? feature.bugs.filter(b => b.status === 'open').length : 0;
    const reqCount = feature.requests ? feature.requests.filter(r => r.status === 'proposed').length : 0;
    const status = feature.status || 'unknown';

    console.log(
      feature.name.padEnd(30) +
      ' | ' +
      (feature.route || '-').padEnd(30) +
      ' | ' +
      getStatusColor(status).padEnd(15) +
      ' | ' +
      chalk.red(String(bugCount).padEnd(4)) +
      ' | ' +
      chalk.yellow(String(reqCount))
    );
  }

  console.log();
}

export function printBugs(features) {
  console.log('\n' + chalk.bold('OPEN BUGS\n'));

  const allBugs = [];
  for (const feature of features) {
    if (feature.bugs) {
      for (const bug of feature.bugs) {
        if (bug.status === 'open') {
          allBugs.push({
            ...bug,
            feature: feature.name
          });
        }
      }
    }
  }

  if (allBugs.length === 0) {
    console.log(chalk.green('✓ No open bugs'));
    return;
  }

  // Sort by severity
  const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  allBugs.sort((a, b) => (severityOrder[a.severity] || 999) - (severityOrder[b.severity] || 999));

  for (const bug of allBugs) {
    console.log(
      getSeverityColor(bug.severity) +
      ' ' +
      bug.title +
      ' ' +
      chalk.dim(`(${bug.feature})`)
    );
  }

  console.log();
}

export function printRequests(features) {
  console.log('\n' + chalk.bold('FEATURE REQUESTS\n'));

  const allRequests = [];
  for (const feature of features) {
    if (feature.requests) {
      for (const req of feature.requests) {
        if (req.status === 'proposed') {
          allRequests.push({
            ...req,
            feature: feature.name
          });
        }
      }
    }
  }

  if (allRequests.length === 0) {
    console.log(chalk.dim('No pending requests'));
    return;
  }

  for (const req of allRequests) {
    console.log(
      req.title +
      ' ' +
      chalk.dim(`[${req.priority}]`) +
      ' ' +
      chalk.dim(`(${req.feature})`)
    );
  }

  console.log();
}
