/**
 * Pass 2: Stack analysis
 *
 * Reads package manifests directly from the cloned repo to derive skills.
 * This is a self-contained implementation that doesn't require specfy/stack-analyser —
 * we parse package.json, requirements.txt, go.mod, Cargo.toml, Gemfile, and pom.xml.
 *
 * Returns raw dependency strings (not yet slugified).
 * The caller runs these through skillResolver.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface StackAnalysis {
  rawDeps: string[];
  detectedStackJson: string;
}

interface ManifestResult {
  file: string;
  deps: string[];
}

/**
 * Analyses the repo directory and returns all declared dependency names.
 */
export function analyseStack(repoDir: string, filePaths: string[]): StackAnalysis {
  const manifests: ManifestResult[] = [];

  // ── package.json (npm / yarn / pnpm) ─────────────────────────────────────
  const packageJsonPaths = filePaths
    .filter((f) => f.endsWith('package.json') && !f.includes('node_modules'))
    .slice(0, 5); // Handle monorepos — take up to 5 package.json files

  for (const rel of packageJsonPaths) {
    try {
      const raw = fs.readFileSync(path.join(repoDir, rel), 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const deps = [
        ...Object.keys((pkg['dependencies'] as Record<string, unknown>) ?? {}),
        ...Object.keys((pkg['devDependencies'] as Record<string, unknown>) ?? {}),
        ...Object.keys((pkg['peerDependencies'] as Record<string, unknown>) ?? {}),
      ];
      manifests.push({ file: rel, deps });
    } catch {
      // Malformed JSON — skip
    }
  }

  // ── requirements.txt / setup.cfg / pyproject.toml ────────────────────────
  const pyFiles = filePaths.filter((f) =>
    ['requirements.txt', 'requirements-dev.txt', 'requirements/base.txt', 'setup.cfg'].some(
      (name) => f.endsWith(name),
    ) ||
    (f.endsWith('pyproject.toml') && !f.includes('/test')),
  ).slice(0, 3);

  for (const rel of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(repoDir, rel), 'utf-8');
      const deps: string[] = [];

      if (rel.endsWith('.toml')) {
        // pyproject.toml — extract package names from dependencies array
        const matches = content.matchAll(/^\s*["']?(\w[\w.-]+)\s*[>=!~<]/gm);
        for (const m of matches) {
          if (m[1]) deps.push(m[1]);
        }
      } else {
        // requirements.txt — one package per line, strip version specifiers
        for (const line of content.split('\n')) {
          const trimmed = line.trim().replace(/[><=!~;#\s].*$/, '');
          if (trimmed && !trimmed.startsWith('-')) deps.push(trimmed);
        }
      }
      manifests.push({ file: rel, deps });
    } catch {
      // skip
    }
  }

  // ── go.mod ────────────────────────────────────────────────────────────────
  if (filePaths.includes('go.mod')) {
    try {
      const content = fs.readFileSync(path.join(repoDir, 'go.mod'), 'utf-8');
      const deps: string[] = [];
      // "require" block entries: "github.com/foo/bar v1.2.3"
      const matches = content.matchAll(/^\s+([\w./][\w./-]+)\s+v/gm);
      for (const m of matches) {
        if (m[1]) deps.push(m[1]);
      }
      manifests.push({ file: 'go.mod', deps });
    } catch {
      // skip
    }
  }

  // ── Cargo.toml ────────────────────────────────────────────────────────────
  const cargoFiles = filePaths.filter((f) => f.endsWith('Cargo.toml')).slice(0, 3);
  for (const rel of cargoFiles) {
    try {
      const content = fs.readFileSync(path.join(repoDir, rel), 'utf-8');
      const deps: string[] = [];
      const matches = content.matchAll(/^(\w[\w-]+)\s*=/gm);
      for (const m of matches) {
        if (m[1] && !['package', 'workspace', 'profile', 'lib', 'bin'].includes(m[1])) {
          deps.push(m[1]);
        }
      }
      manifests.push({ file: rel, deps });
    } catch {
      // skip
    }
  }

  // ── Gemfile ────────────────────────────────────────────────────────────────
  if (filePaths.includes('Gemfile')) {
    try {
      const content = fs.readFileSync(path.join(repoDir, 'Gemfile'), 'utf-8');
      const deps: string[] = [];
      const matches = content.matchAll(/^gem\s+['"](\w[\w-]+)['"]/gm);
      for (const m of matches) {
        if (m[1]) deps.push(m[1]);
      }
      manifests.push({ file: 'Gemfile', deps });
    } catch {
      // skip
    }
  }

  // ── pom.xml (Maven — extract artifactId) ─────────────────────────────────
  if (filePaths.includes('pom.xml')) {
    try {
      const content = fs.readFileSync(path.join(repoDir, 'pom.xml'), 'utf-8');
      const deps: string[] = [];
      const matches = content.matchAll(/<artifactId>([\w-]+)<\/artifactId>/g);
      for (const m of matches) {
        if (m[1]) deps.push(m[1]);
      }
      manifests.push({ file: 'pom.xml', deps });
    } catch {
      // skip
    }
  }

  // ── Deduplicate ───────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const rawDeps: string[] = [];
  for (const manifest of manifests) {
    for (const dep of manifest.deps) {
      const key = dep.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        rawDeps.push(dep);
      }
    }
  }

  const detectedStackJson = JSON.stringify({
    manifests: manifests.map((m) => ({ file: m.file, count: m.deps.length })),
    totalDeps: rawDeps.length,
  });

  return { rawDeps, detectedStackJson };
}
