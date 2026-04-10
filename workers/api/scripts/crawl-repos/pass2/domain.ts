/**
 * Pass 2: Domain inference — §3.4 of the plan.
 *
 * Assigns a detected_domain to a repo based on file tree + skills.
 * First-match-wins priority order. Returns domain + confidence.
 */

export interface DomainResult {
  domain: string;
  confidence: number;
}

export function inferDomain(
  filePaths: string[],
  skills: string[],
  rawDeps: string[],
  topics: string[],
): DomainResult {
  const topicStr = topics.join(' ').toLowerCase();
  const skillSet = new Set(skills);
  const depSet = new Set(rawDeps.map((d) => d.toLowerCase()));

  // ── Rule 1: Mobile ────────────────────────────────────────────────────────
  if (
    filePaths.some((f) => /^ios\/|^android\//.test(f)) ||
    filePaths.some((f) => /\.(swift|kt)$/.test(f)) ||
    depSet.has('react-native') ||
    depSet.has('@react-native-community/async-storage')
  ) {
    return { domain: 'mobile', confidence: 1.0 };
  }

  // ── Rule 2: ML ────────────────────────────────────────────────────────────
  if (
    skillSet.has('pytorch') || skillSet.has('tensorflow') || skillSet.has('scikit-learn') ||
    depSet.has('torch') || depSet.has('tensorflow') || depSet.has('jax') ||
    (filePaths.filter((f) => f.endsWith('.ipynb')).length > 3)
  ) {
    return { domain: 'ml', confidence: 1.0 };
  }

  // ── Rule 3: CLI ───────────────────────────────────────────────────────────
  if (
    (filePaths.some((f) => /^bin\//.test(f)) &&
      (depSet.has('commander') || depSet.has('yargs') || depSet.has('oclif'))) ||
    depSet.has('cobra') || depSet.has('clap')
  ) {
    return { domain: 'cli', confidence: 1.0 };
  }

  // ── Rule 4: Data pipeline ─────────────────────────────────────────────────
  if (
    depSet.has('airflow') || depSet.has('apache-airflow') ||
    depSet.has('dbt') || depSet.has('dbt-core') ||
    depSet.has('kafka') || depSet.has('confluent-kafka') ||
    depSet.has('pyspark') || depSet.has('apache-spark') ||
    depSet.has('prefect') || depSet.has('dagster')
  ) {
    return { domain: 'data-pipeline', confidence: 1.0 };
  }

  // ── Rule 5: Infra / IaC ───────────────────────────────────────────────────
  if (
    topicStr.includes('kubernetes') || topicStr.includes('terraform') ||
    topicStr.includes('iac') || topicStr.includes('infrastructure-as-code') ||
    skillSet.has('terraform') || skillSet.has('kubernetes') ||
    filePaths.some((f) => /\.tf$|\.hcl$/.test(f)) ||
    filePaths.some((f) => /helm\//i.test(f))
  ) {
    return { domain: 'infra', confidence: 0.9 };
  }

  // ── Rule 6: Web frontend ──────────────────────────────────────────────────
  const hasFrontend = skillSet.has('react') || skillSet.has('vue') ||
    skillSet.has('svelte') || skillSet.has('angular') ||
    skillSet.has('nextjs') || skillSet.has('nuxt');

  const hasServerFramework = skillSet.has('express') || skillSet.has('fastify') ||
    skillSet.has('nestjs') || skillSet.has('hono') ||
    skillSet.has('django') || skillSet.has('flask') || skillSet.has('fastapi') ||
    skillSet.has('rails') || skillSet.has('gin') || skillSet.has('echo');

  if (hasFrontend && !hasServerFramework) {
    return { domain: 'web-frontend', confidence: 0.8 };
  }

  // ── Rule 7: Web backend ───────────────────────────────────────────────────
  if (hasServerFramework) {
    return { domain: 'web-backend', confidence: 0.8 };
  }

  // ── Rule 8: Devtools ──────────────────────────────────────────────────────
  if (
    topicStr.includes('linter') || topicStr.includes('formatter') ||
    topicStr.includes('bundler') || topicStr.includes('cli-tool') ||
    topicStr.includes('developer-tool') || topicStr.includes('code-quality')
  ) {
    return { domain: 'devtools', confidence: 0.6 };
  }

  return { domain: 'other', confidence: 0 };
}

/**
 * Checks whether a repo's topics / description contain domain denylist keywords.
 * Used in pass-2 hard disqualifiers.
 */
export function isDomainDenylisted(topics: string[], description: string | null): boolean {
  const DENY = [
    'genomics', 'bioinformatics', 'physics-simulation', 'quant-finance',
    'quantitative-finance', 'high-frequency-trading', 'drug-discovery',
    'protein-folding', 'astronomy', 'seismology',
  ];
  const haystack = [...topics, description ?? ''].join(' ').toLowerCase();
  return DENY.some((kw) => haystack.includes(kw));
}
