#!/usr/bin/env node

import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { scanCommits, getLastSyncTime } from './scanner.js';
import { analyzeCommitsBatch, analyzeFeatureStatus } from './claude-analyzer.js';
import {
  loadPMData,
  savePMData,
  findFeatureById,
  findFeatureByName,
  generateId,
  formatTimestamp,
  printTable,
  printBugs,
  printRequests
} from './utils.js';

const PM_FILE = process.env.PM_DATA_FILE || 'pm.json';
const REPO_PATH = process.env.GIT_REPO_PATH || '..';

const argv = yargs(hideBin(process.argv))
  .command(
    'sync',
    'Scan git commits and update feature status',
    {},
    commandSync
  )
  .command(
    'status',
    'Show current feature status',
    {},
    commandStatus
  )
  .command(
    'bug <featureId> <title>',
    'Log a bug on a feature',
    (yargs) =>
      yargs
        .positional('featureId', { describe: 'Feature ID', type: 'string' })
        .positional('title', { describe: 'Bug title', type: 'string' })
        .option('severity', { alias: 's', default: 'P2', describe: 'P0|P1|P2|P3' }),
    commandBug
  )
  .command(
    'request <featureId> <title>',
    'Log a feature request',
    (yargs) =>
      yargs
        .positional('featureId', { describe: 'Feature ID', type: 'string' })
        .positional('title', { describe: 'Request title', type: 'string' })
        .option('priority', { alias: 'p', default: 'P2', describe: 'P0|P1|P2|P3' }),
    commandRequest
  )
  .command(
    'init',
    'Initialize pm.json from CLAUDE.md',
    {},
    commandInit
  )
  .demandCommand(1)
  .help()
  .alias('help', 'h')
  .strict().argv;

// ─────────────────────────────────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────────────────────────────────

async function commandSync() {
  console.log(chalk.cyan('\n🔄 Starting sync...\n'));

  try {
    // Load current PM data
    let pmData = loadPMData(PM_FILE);
    if (!pmData) {
      console.log(chalk.yellow('⚠️  No pm.json found. Run "pm init" first.'));
      return;
    }

    const features = pmData.features || [];
    const featuresContext = features.map(f => f.name).join(', ');

    // Get commits since last sync
    const lastSync = getLastSyncTime(pmData);
    console.log(chalk.dim(`Scanning commits since ${lastSync}...\n`));

    const commits = await scanCommits(REPO_PATH, lastSync);

    if (commits.length === 0) {
      console.log(chalk.green('✓ No new commits since last sync'));
      console.log();
      return;
    }

    console.log(chalk.dim(`Found ${commits.length} commits\n`));

    // Analyze commits with Mistral
    console.log(chalk.dim('Analyzing with Mistral...\n'));
    const analyses = await analyzeCommitsBatch(commits, featuresContext);

    // Update features based on analyses
    console.log(chalk.dim('\nUpdating feature status...\n'));

    for (const analysis of analyses) {
      // Skip if Mistral couldn't analyze
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
          autoDetected: true,
          mistralAnalysis: {
            type: analysis.type,
            severity: analysis.severity
          }
        });

        // Update feature status based on bugs and commits
        const recentCommits = commits.filter(c => analysis.features.includes(findFeatureByName(features, featureName)?.name)).slice(-5);
        const statusAnalysis = await analyzeFeatureStatus(feature, recentCommits);
        feature.status = statusAnalysis.status;
        feature.lastChecked = formatTimestamp();

        console.log(
          `✓ Updated ${feature.name}: ${chalk.bold(feature.status)}`
        );
      }
    }

    // Save updated pm.json
    pmData.lastSync = formatTimestamp();
    savePMData(PM_FILE, pmData);

    console.log(chalk.green(`\n✓ Sync complete! ${analyses.length} commits analyzed.`));
    console.log();
  } catch (error) {
    console.error(chalk.red(`✗ Sync failed: ${error.message}`));
    process.exit(1);
  }
}

function commandStatus() {
  console.log();

  const pmData = loadPMData(PM_FILE);
  if (!pmData) {
    console.log(chalk.yellow('No pm.json found. Run "pm init" first.'));
    console.log();
    return;
  }

  const features = pmData.features || [];
  const lastSync = pmData.lastSync ? new Date(pmData.lastSync).toLocaleDateString() : 'Never';

  console.log(chalk.dim(`Last synced: ${lastSync}`));
  console.log();

  printTable(features);
  printBugs(features);
  printRequests(features);
}

function commandBug(argv) {
  const { featureId, title, severity } = argv;

  let pmData = loadPMData(PM_FILE);
  if (!pmData) {
    console.log(chalk.yellow('No pm.json found. Run "pm init" first.'));
    return;
  }

  const feature = findFeatureById(pmData.features, featureId);
  if (!feature) {
    console.log(chalk.red(`✗ Feature not found: ${featureId}`));
    return;
  }

  const bug = {
    id: generateId('bug'),
    title,
    status: 'open',
    severity,
    logged: new Date().toISOString().split('T')[0],
    notes: ''
  };

  feature.bugs = feature.bugs || [];
  feature.bugs.push(bug);

  savePMData(PM_FILE, pmData);
  console.log(
    chalk.green(`✓ Bug logged on ${feature.name}:`) +
    '\n  ' +
    getSeverityColor(severity)(`[${severity}]`) +
    ' ' +
    title
  );
  console.log();
}

function commandRequest(argv) {
  const { featureId, title, priority } = argv;

  let pmData = loadPMData(PM_FILE);
  if (!pmData) {
    console.log(chalk.yellow('No pm.json found. Run "pm init" first.'));
    return;
  }

  const feature = findFeatureById(pmData.features, featureId);
  if (!feature) {
    console.log(chalk.red(`✗ Feature not found: ${featureId}`));
    return;
  }

  const request = {
    id: generateId('req'),
    title,
    status: 'proposed',
    logged: new Date().toISOString().split('T')[0],
    priority
  };

  feature.requests = feature.requests || [];
  feature.requests.push(request);

  savePMData(PM_FILE, pmData);
  console.log(
    chalk.green(`✓ Request logged on ${feature.name}:`) +
    '\n  ' +
    title +
    ' ' +
    chalk.dim(`[${priority}]`)
  );
  console.log();
}

async function commandInit() {
  console.log(chalk.cyan('\n📋 Initializing pm.json...\n'));

  // Read CLAUDE.md to extract features
  // For now, create a template based on known features

  const pmData = {
    features: [
      {
        id: 'feat-listing',
        name: 'Pipeline Listing',
        route: '/',
        status: 'working',
        component: 'ListingPage.tsx',
        journeys: [
          {
            name: 'View all pipelines',
            status: 'working',
            bdd: 'Given a recruiter with pipelines\nWhen they load the listing page\nThen all pipelines render'
          }
        ],
        bugs: [],
        requests: []
      },
      {
        id: 'feat-overview',
        name: 'Pipeline Overview',
        route: '/pipeline/:id',
        status: 'working',
        component: 'OverviewPage.tsx',
        journeys: [
          {
            name: 'View pipeline Kanban',
            status: 'working',
            bdd: 'Given pipeline with stages\nWhen recruiter opens detail\nThen stage cards render'
          }
        ],
        bugs: [],
        requests: []
      },
      {
        id: 'feat-assessment',
        name: 'Candidate Assessment',
        route: '/assess/:token',
        status: 'working',
        component: 'CandidateAssessmentPage.tsx',
        journeys: [
          {
            name: 'CODE_REVIEW challenge',
            status: 'working',
            bdd: 'Given code review challenge\nWhen candidate submits\nThen score calculated'
          }
        ],
        bugs: [],
        requests: []
      },
      {
        id: 'feat-challenge-editor',
        name: 'Challenge Editor',
        route: '/pipeline/:id/challenges/:challengeId',
        status: 'partial',
        component: 'ChallengeEditorPage.tsx',
        journeys: [],
        bugs: [
          {
            id: 'bug-001',
            title: 'Blocked by serverConfig IAM',
            status: 'open',
            severity: 'P0',
            logged: new Date().toISOString().split('T')[0],
            notes: 'Feature flag gated pending IAM lock-down'
          }
        ],
        requests: []
      }
    ],
    workLog: [],
    lastSync: null
  };

  savePMData(PM_FILE, pmData);
  console.log(chalk.green(`✓ Created ${PM_FILE} with 4 seed features`));
  console.log(chalk.dim('\nNext: Run "pm sync" to scan commits and update status'));
  console.log();
}

// Helper from utils
function getSeverityColor(severity) {
  const colors = {
    P0: chalk.red,
    P1: chalk.red,
    P2: chalk.yellow,
    P3: chalk.dim
  };
  return (colors[severity] || chalk.dim)(severity);
}
