import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Scanner: Reads git commits and extracts commit data for analysis
 */

export async function scanCommits(repoPath, since = null) {
  try {
    const args = [
      'log',
      '--pretty=format:%H|%s|%ai',
      '--name-only',
    ];

    if (since) {
      args.push(`--since=${since}`);
    } else {
      args.push('-n', '50');
    }

    const output = execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      env: { ...process.env },
    });

    const commits = parseGitLog(output);
    return commits;
  } catch (error) {
    console.error('Failed to scan commits:', error.message);
    return [];
  }
}

/**
 * Parse git log output into structured commit objects
 */
function parseGitLog(output) {
  const commits = [];
  const lines = output.trim().split('\n');

  let currentCommit = null;
  let currentFiles = [];

  for (const line of lines) {
    // Commit line format: HASH|MESSAGE|DATE
    if (line.includes('|')) {
      // Save previous commit if exists
      if (currentCommit) {
        currentCommit.files = currentFiles;
        commits.push(currentCommit);
      }

      const [hash, message, timestamp] = line.split('|');
      currentCommit = {
        hash: hash.trim(),
        message: message.trim(),
        timestamp: timestamp.trim(),
        files: []
      };
      currentFiles = [];
    }
    // File line (no pipes, not empty)
    else if (line.trim() && currentCommit && !line.includes('|')) {
      if (line.endsWith('.ts') || line.endsWith('.tsx') || line.endsWith('.js') || line.endsWith('.json')) {
        currentFiles.push(line.trim());
      }
    }
  }

  // Don't forget last commit
  if (currentCommit) {
    currentCommit.files = currentFiles;
    commits.push(currentCommit);
  }

  return commits;
}

/**
 * Get diff for a specific commit
 */
export async function getCommitDiff(repoPath, commitHash) {
  try {
    const diff = execFileSync('git', ['show', commitHash], {
      cwd: repoPath,
      encoding: 'utf-8',
      env: { ...process.env },
    });
    return diff;
  } catch (error) {
    console.error(`Failed to get diff for ${commitHash}:`, error.message);
    return '';
  }
}

/**
 * Get last sync timestamp from pm.json (if it exists)
 */
export function getLastSyncTime(pmData) {
  if (pmData && pmData.lastSync) {
    return new Date(pmData.lastSync).toISOString().split('T')[0];
  }
  // Default to 7 days ago
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().split('T')[0];
}
