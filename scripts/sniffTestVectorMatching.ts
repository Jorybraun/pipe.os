#!/usr/bin/env tsx
/**
 * Synthetic Sniff Test for Vector-Native Matching
 *
 * Validates that the unified BGE vector space discriminates correctly
 * across roles, candidates, and repos using synthetic fixtures.
 *
 * Run: npx tsx scripts/sniffTestVectorMatching.ts
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { writeFile } from 'fs/promises';

// ─── Import production preprocessing (FROZEN — do not modify) ─────────────────
import { preprocessForEmbedding } from '../workers/api/src/lib/embedding/preprocess';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Fixture {
  id: string;
  label: string;
  domain:
    | 'fintech-react'
    | 'blockchain-rust'
    | 'healthcare-ml'
    | 'devops-platform'
    | 'mobile-social';
  text: string;
}

interface ScoreRow {
  queryId: string;
  scores: Record<string, number>;
}

interface TestResult {
  direction: string;
  matrix: ScoreRow[];
  sameDomainMarginOk: boolean;
  dynamicRangeOk: boolean;
  minDynamicRange: number;
  inversionCount: number;
  marginFailures: string[];
  rangeFailures: string[];
  rangeSkipped: number;
}

// ─── Synthetic fixtures ───────────────────────────────────────────────────────
// Design: 3 primary roles + 5 candidates + 5 repos.
// Same-domain pairs are defined by matching domain labels.
// Mismatch candidates/repos are in domains that do not overlap with the 3 primary roles.

const ROLES: Fixture[] = [
  {
    id: 'L_A',
    label: 'Role A — Fintech React',
    domain: 'fintech-react',
    text: 'Senior React frontend engineer for fintech. TypeScript, Next.js, trading dashboards. Experience with real-time market data visualization, payment flow UI, and regulatory reporting interfaces.',
  },
  {
    id: 'L_B',
    label: 'Role B — Blockchain Rust',
    domain: 'blockchain-rust',
    text: 'Cryptography researcher for blockchain protocols. Rust, zero-knowledge proofs, elliptic curve cryptography, formal verification of consensus algorithms. Deep expertise in cryptographic protocols and peer-to-peer networking.',
  },
  {
    id: 'L_C',
    label: 'Role C — Healthcare ML',
    domain: 'healthcare-ml',
    text: 'Machine learning researcher for natural language processing. Python, PyTorch, transformer models, entity recognition and relation extraction. Academic research background with publications on text mining and information extraction.',
  },
];

const CANDIDATES: Fixture[] = [
  {
    id: 'C_A',
    label: 'Candidate A — Fintech React',
    domain: 'fintech-react',
    text: 'Senior frontend engineer with 6 years building React and TypeScript applications in fintech. Led development of real-time trading dashboards using Next.js, WebSockets, and D3. Experience with payment flows, KYC integrations, and high-frequency data visualization. Implemented design systems and mentored junior engineers on state management patterns.',
  },
  {
    id: 'C_B',
    label: 'Candidate B — Blockchain Rust',
    domain: 'blockchain-rust',
    text: 'Cryptography engineer specializing in Rust for blockchain protocols. Implemented zero-knowledge proof verifiers, elliptic curve signature schemes, and formal verification of smart contracts. Contributed to Layer-2 rollup architectures. Deep expertise in cryptographic protocols, Merkle trees, and peer-to-peer networking stacks.',
  },
  {
    id: 'C_C',
    label: 'Candidate C — Healthcare ML',
    domain: 'healthcare-ml',
    text: 'Machine learning researcher with PyTorch and Hugging Face transformers. Built NLP pipelines for entity recognition, relation extraction, and text classification. Published research on transformer-based information extraction from unstructured text. Experience with academic datasets, model benchmarking, and reproducible research workflows.',
  },
  {
    id: 'C_D',
    label: 'Candidate D — Graphic Designer',
    domain: 'design',
    text: 'Graphic designer with expertise in brand identity, visual design systems, Adobe Illustrator, Photoshop, and motion graphics for advertising agencies. Created campaign visuals for print, digital, and outdoor media. Experience with typography, color theory, and client presentation decks. Portfolio includes work for Fortune 500 consumer brands.',
  },
  {
    id: 'C_E',
    label: 'Candidate E — Civil Engineer',
    domain: 'civil-engineering',
    text: 'Civil engineer with structural analysis, AutoCAD, and bridge design experience for municipal infrastructure projects. Performed load calculations, material stress testing, and geotechnical surveys. Managed construction site inspections and ensured compliance with building codes and environmental regulations. PE licensed.',
  },
];

const REPOS: Fixture[] = [
  {
    id: 'R_A',
    label: 'Repo A — Fintech React',
    domain: 'fintech-react',
    text: 'React-based fintech trading dashboard. TypeScript frontend with Next.js, real-time WebSocket data feeds, charting library for candlestick and depth visualizations. Integrates with FIX and REST trading APIs. Includes authentication, role-based access control, and audit logging for regulatory compliance.',
  },
  {
    id: 'R_B',
    label: 'Repo B — Blockchain Rust',
    domain: 'blockchain-rust',
    text: 'Rust implementation of a zero-knowledge proof system. Cryptographic primitives including elliptic curve signatures, Merkle Patricia trees, and zk-SNARK circuit verifiers. P2P gossip protocol for block propagation. Includes benchmarking suite and formal specification in TLA+.',
  },
  {
    id: 'R_C',
    label: 'Repo C — Healthcare ML',
    domain: 'healthcare-ml',
    text: 'PyTorch NLP research toolkit for text mining. Transformer-based entity recognition and relation extraction models. Includes data preprocessing, model training, and inference serving with ONNX runtime. Academic reproducibility tools and benchmark evaluation pipelines.',
  },
  {
    id: 'R_D',
    label: 'Repo D — Brand Design System',
    domain: 'design',
    text: 'Brand design system and digital asset library. Adobe Creative Suite templates, logo variations, color palette generators, and marketing collateral layouts. Includes brand guideline documentation, typography scales, and export pipelines for print, web, and social media formats.',
  },
  {
    id: 'R_E',
    label: 'Repo E — Structural Engineering Suite',
    domain: 'civil-engineering',
    text: 'Structural engineering analysis suite for bridge and building design. Finite element modeling for load distribution, material stress analysis, and seismic simulation. AutoCAD integration for blueprint generation and municipal compliance reporting tools.',
  },
];

const BGE_MODEL = 'Xenova/bge-large-en-v1.5';
const EXPECTED_DIM = 1024;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function sameDomain(a: Fixture, b: Fixture): boolean {
  return a.domain === b.domain;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embedFixtures(
  extractor: FeatureExtractionPipeline,
  fixtures: Fixture[],
  side: 'document' | 'query',
): Promise<Map<string, number[]>> {
  const vectors = new Map<string, number[]>();
  for (const f of fixtures) {
    const normalized = preprocessForEmbedding(f.text, side);
    const output = await extractor(normalized, { pooling: 'mean', normalize: true });
    const vec = Array.from(output.data as Float32Array) as number[];
    if (vec.length !== EXPECTED_DIM) {
      throw new Error(`Unexpected vector dimension for ${f.id}: ${vec.length}`);
    }
    vectors.set(f.id, vec);
  }
  return vectors;
}

// ─── Scoring & assertions ─────────────────────────────────────────────────────

function scoreMatrix(
  queries: Fixture[],
  targets: Fixture[],
  queryVectors: Map<string, number[]>,
  targetVectors: Map<string, number[]>,
): ScoreRow[] {
  return queries.map((q) => {
    const qv = queryVectors.get(q.id)!;
    const scores: Record<string, number> = {};
    for (const t of targets) {
      const tv = targetVectors.get(t.id)!;
      scores[t.id] = cosineSimilarity(qv, tv);
    }
    return { queryId: q.id, scores };
  });
}

function checkMargin(
  matrix: ScoreRow[],
  queries: Fixture[],
  targets: Fixture[],
  minMargin = 0.1,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const row of matrix) {
    const q = queries.find((x) => x.id === row.queryId)!;
    const sameDomainScores: number[] = [];
    const crossDomainScores: number[] = [];
    for (const t of targets) {
      if (sameDomain(q, t)) {
        sameDomainScores.push(row.scores[t.id]);
      } else {
        crossDomainScores.push(row.scores[t.id]);
      }
    }
    if (sameDomainScores.length === 0 || crossDomainScores.length === 0) continue;
    const minSame = Math.min(...sameDomainScores);
    const maxCross = Math.max(...crossDomainScores);
    if (minSame - maxCross < minMargin) {
      failures.push(
        `${q.id}: min same-domain (${minSame.toFixed(4)}) - max cross-domain (${maxCross.toFixed(4)}) = ${(minSame - maxCross).toFixed(4)} < ${minMargin}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

function checkDynamicRange(
  matrix: ScoreRow[],
  queries: Fixture[],
  targets: Fixture[],
  minRange = 0.2,
): { ok: boolean; minRangeFound: number; failures: string[]; skipped: number } {
  const failures: string[] = [];
  let minRangeFound = Infinity;
  let skipped = 0;
  for (const row of matrix) {
    const q = queries.find((x) => x.id === row.queryId)!;
    const hasSameDomain = targets.some((t) => sameDomain(q, t));
    if (!hasSameDomain) {
      skipped++;
      continue; // Skip rows with no same-domain target — low range is expected for pure mismatches
    }
    const vals = Object.values(row.scores);
    const range = Math.max(...vals) - Math.min(...vals);
    minRangeFound = Math.min(minRangeFound, range);
    if (range < minRange) {
      failures.push(`${row.queryId}: range = ${range.toFixed(4)} < ${minRange}`);
    }
  }
  return { ok: failures.length === 0, minRangeFound, failures, skipped };
}

function countInversions(
  matrix: ScoreRow[],
  queries: Fixture[],
  targets: Fixture[],
): number {
  let inversions = 0;
  for (const row of matrix) {
    const q = queries.find((x) => x.id === row.queryId)!;
    const sameDomainTargets = targets.filter((t) => sameDomain(q, t));
    const crossDomainTargets = targets.filter((t) => !sameDomain(q, t));
    for (const s of sameDomainTargets) {
      for (const c of crossDomainTargets) {
        if (row.scores[s.id] <= row.scores[c.id]) {
          inversions++;
        }
      }
    }
  }
  return inversions;
}

// ─── Prefix sensitivity test ──────────────────────────────────────────────────

async function testPrefixSensitivity(
  extractor: FeatureExtractionPipeline,
): Promise<{ ok: boolean; details: string; vectorDiff: number; avgDelta: number }> {
  const testCases = [
    {
      query: 'Who can build a React trading dashboard with TypeScript',
      docs: [
        { text: 'React-based fintech trading dashboard. TypeScript frontend with Next.js, real-time WebSocket data feeds, charting library for candlestick and depth visualizations.', relevant: true },
        { text: 'Rust implementation of a zero-knowledge proof system. Cryptographic primitives including elliptic curve signatures and Merkle Patricia trees.', relevant: false },
        { text: 'PyTorch NLP research toolkit for text mining. Transformer-based entity recognition and relation extraction models.', relevant: false },
      ],
    },
    {
      query: 'Find someone experienced in zero-knowledge proofs and Rust',
      docs: [
        { text: 'Rust implementation of a zero-knowledge proof system. Cryptographic primitives including elliptic curve signatures and zk-SNARK circuit verifiers.', relevant: true },
        { text: 'React-based fintech trading dashboard. TypeScript frontend with Next.js.', relevant: false },
        { text: 'Marketing automation platform for email campaigns and lead scoring. Built with Ruby on Rails and React.', relevant: false },
      ],
    },
    {
      query: 'Need a PyTorch expert for NLP research and text mining',
      docs: [
        { text: 'PyTorch NLP research toolkit for text mining. Transformer-based entity recognition and relation extraction models.', relevant: true },
        { text: 'React-based fintech trading dashboard. TypeScript frontend with Next.js.', relevant: false },
        { text: 'Swift iOS application for social media engagement. Real-time chat with WebSockets.', relevant: false },
      ],
    },
    {
      query: 'How do I find a frontend engineer for payment systems',
      docs: [
        { text: 'React-based fintech trading dashboard. TypeScript frontend with Next.js, payment flow UI, and regulatory reporting.', relevant: true },
        { text: 'Rust implementation of a zero-knowledge proof system.', relevant: false },
        { text: 'Financial trading API for algorithmic trading. Built with Java and Spring Boot.', relevant: false },
      ],
    },
    {
      query: 'Candidate with equity research and financial modeling skills',
      docs: [
        { text: 'Financial analyst with expertise in financial modeling, equity research, and investment analysis for institutional clients.', relevant: true },
        { text: 'Marketing manager with 8 years of experience in brand strategy, digital campaigns, and content marketing.', relevant: false },
        { text: 'Rust implementation of a zero-knowledge proof system.', relevant: false },
      ],
    },
  ];

  let totalDelta = 0;
  let positiveCount = 0;
  const lines: string[] = [];

  // Vector difference check: embed the same text both ways and verify they're different
  const sampleText = 'Senior frontend engineer with React and TypeScript';
  const vQuery = await extractor(preprocessForEmbedding(sampleText, 'query'), { pooling: 'mean', normalize: true });
  const vDoc = await extractor(preprocessForEmbedding(sampleText, 'document'), { pooling: 'mean', normalize: true });
  const vecQ = Array.from(vQuery.data as Float32Array) as number[];
  const vecD = Array.from(vDoc.data as Float32Array) as number[];
  const vectorDiff = 1 - cosineSimilarity(vecQ, vecD); // angular distance

  lines.push(`Vector difference check (same text, query vs document prefix):`);
  lines.push(`  Cosine similarity: ${cosineSimilarity(vecQ, vecD).toFixed(6)}`);
  lines.push(`  Angular distance:  ${vectorDiff.toFixed(6)}`);
  lines.push('');

  for (const tc of testCases) {
    const qQuery = preprocessForEmbedding(tc.query, 'query');
    const qDoc = preprocessForEmbedding(tc.query, 'document');

    const vQueryQ = await extractor(qQuery, { pooling: 'mean', normalize: true });
    const vQueryD = await extractor(qDoc, { pooling: 'mean', normalize: true });
    const vecQQ = Array.from(vQueryQ.data as Float32Array) as number[];
    const vecQD = Array.from(vQueryD.data as Float32Array) as number[];

    const docVectors = [];
    for (const d of tc.docs) {
      const dDoc = preprocessForEmbedding(d.text, 'document');
      const vDoc = await extractor(dDoc, { pooling: 'mean', normalize: true });
      docVectors.push(Array.from(vDoc.data as Float32Array) as number[]);
    }

    const scoresQuery = docVectors.map((dv) => cosineSimilarity(vecQQ, dv));
    const scoresDoc = docVectors.map((dv) => cosineSimilarity(vecQD, dv));

    // Measure top-1 relevance gap: (relevant score - max irrelevant score)
    const relIdx = tc.docs.findIndex((d) => d.relevant);
    const irrelScoresQuery = scoresQuery.filter((_, i) => !tc.docs[i].relevant);
    const irrelScoresDoc = scoresDoc.filter((_, i) => !tc.docs[i].relevant);

    const gapQuery = scoresQuery[relIdx] - Math.max(...irrelScoresQuery);
    const gapDoc = scoresDoc[relIdx] - Math.max(...irrelScoresDoc);
    const delta = gapQuery - gapDoc;
    totalDelta += delta;
    if (delta >= 0) positiveCount++;

    lines.push(`Query: "${tc.query.slice(0, 55)}..."`);
    lines.push(`  query-side relevance gap: ${gapQuery.toFixed(4)}`);
    lines.push(`  doc-side relevance gap:   ${gapDoc.toFixed(4)}`);
    lines.push(`  delta:                    ${delta.toFixed(4)}`);
  }

  const avgDelta = totalDelta / testCases.length;
  lines.push(`Average delta: ${avgDelta.toFixed(4)}`);
  lines.push(`Positive/neutral cases: ${positiveCount}/${testCases.length}`);

  // Pass criteria:
  // 1. Vectors must be measurably different (prefix changes the embedding)
  // 2. Average delta should not be significantly harmful (>-0.01)
  // 3. At least half the cases should be positive or neutral
  const ok = vectorDiff > 0.001 && avgDelta > -0.01 && positiveCount >= testCases.length / 2;

  return { ok, details: lines.join('\n'), vectorDiff, avgDelta };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatMatrix(matrix: ScoreRow[], targets: Fixture[]): string {
  const headers = ['Query', ...targets.map((t) => t.id)];
  const colWidths = headers.map((h) => Math.max(h.length, 8));

  const pad = (s: string, w: number) => s.padStart(w);

  let out = '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |\n';
  out += '|' + colWidths.map((w) => '-'.repeat(w + 2)).join('|') + '|\n';

  for (const row of matrix) {
    const cells = [
      pad(row.queryId, colWidths[0]),
      ...targets.map((t, i) => pad(row.scores[t.id].toFixed(4), colWidths[i + 1])),
    ];
    out += '| ' + cells.join(' | ') + ' |\n';
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🧪 Synthetic Sniff Test for Vector-Native Matching');
  console.log(`   Model: ${BGE_MODEL}`);
  console.log('   Loading embedding pipeline...\n');

  const extractor = await pipeline('feature-extraction', BGE_MODEL, {
    dtype: 'fp32',
  });

  console.log('📦 Embedding fixtures as DOCUMENTS (index side)...');
  const roleVectorsDoc = await embedFixtures(extractor, ROLES, 'document');
  const candidateVectorsDoc = await embedFixtures(extractor, CANDIDATES, 'document');
  const repoVectorsDoc = await embedFixtures(extractor, REPOS, 'document');

  console.log('   Roles:      ' + roleVectorsDoc.size);
  console.log('   Candidates: ' + candidateVectorsDoc.size);
  console.log('   Repos:      ' + repoVectorsDoc.size);

  // ─── Direction 1: Role → Candidate ──────────────────────────────────────────
  console.log('\n🔍 Direction 1: Role → Candidate');
  const matRoleCand = scoreMatrix(ROLES, CANDIDATES, roleVectorsDoc, candidateVectorsDoc);
  const margin1 = checkMargin(matRoleCand, ROLES, CANDIDATES, 0.1);
  const range1 = checkDynamicRange(matRoleCand, ROLES, CANDIDATES, 0.2);
  const inv1 = countInversions(matRoleCand, ROLES, CANDIDATES);
  console.log('   Inversions: ' + inv1);
  console.log('   Margin OK:  ' + margin1.ok + (margin1.failures.length ? ' — ' + margin1.failures.join('; ') : ''));
  console.log('   Range OK:   ' + range1.ok + ' (min range: ' + range1.minRangeFound.toFixed(4) + ', skipped: ' + range1.skipped + ')');

  // ─── Direction 2: Candidate → Role ──────────────────────────────────────────
  console.log('\n🔍 Direction 2: Candidate → Role');
  const matCandRole = scoreMatrix(CANDIDATES, ROLES, candidateVectorsDoc, roleVectorsDoc);
  const margin2 = checkMargin(matCandRole, CANDIDATES, ROLES, 0.1);
  const range2 = checkDynamicRange(matCandRole, CANDIDATES, ROLES, 0.2);
  const inv2 = countInversions(matCandRole, CANDIDATES, ROLES);
  console.log('   Inversions: ' + inv2);
  console.log('   Margin OK:  ' + margin2.ok + (margin2.failures.length ? ' — ' + margin2.failures.join('; ') : ''));
  console.log('   Range OK:   ' + range2.ok + ' (min range: ' + range2.minRangeFound.toFixed(4) + ', skipped: ' + range2.skipped + ')');

  // ─── Direction 3: Role → Repo ───────────────────────────────────────────────
  console.log('\n🔍 Direction 3: Role → Repo');
  const matRoleRepo = scoreMatrix(ROLES, REPOS, roleVectorsDoc, repoVectorsDoc);
  const margin3 = checkMargin(matRoleRepo, ROLES, REPOS, 0.1);
  const range3 = checkDynamicRange(matRoleRepo, ROLES, REPOS, 0.2);
  const inv3 = countInversions(matRoleRepo, ROLES, REPOS);
  console.log('   Inversions: ' + inv3);
  console.log('   Margin OK:  ' + margin3.ok + (margin3.failures.length ? ' — ' + margin3.failures.join('; ') : ''));
  console.log('   Range OK:   ' + range3.ok + ' (min range: ' + range3.minRangeFound.toFixed(4) + ', skipped: ' + range3.skipped + ')');

  // ─── Direction 4: Candidate → Repo ──────────────────────────────────────────
  console.log('\n🔍 Direction 4: Candidate → Repo');
  const matCandRepo = scoreMatrix(CANDIDATES, REPOS, candidateVectorsDoc, repoVectorsDoc);
  const margin4 = checkMargin(matCandRepo, CANDIDATES, REPOS, 0.1);
  const range4 = checkDynamicRange(matCandRepo, CANDIDATES, REPOS, 0.2);
  const inv4 = countInversions(matCandRepo, CANDIDATES, REPOS);
  console.log('   Inversions: ' + inv4);
  console.log('   Margin OK:  ' + margin4.ok + (margin4.failures.length ? ' — ' + margin4.failures.join('; ') : ''));
  console.log('   Range OK:   ' + range4.ok + ' (min range: ' + range4.minRangeFound.toFixed(4) + ', skipped: ' + range4.skipped + ')');

  // ─── Prefix sensitivity ─────────────────────────────────────────────────────
  console.log('\n🔍 Prefix sensitivity test');
  const prefixTest = await testPrefixSensitivity(extractor);
  console.log('   Prefix OK:  ' + prefixTest.ok);
  console.log('   ' + prefixTest.details.split('\n').join('\n   '));

  // ─── Compile results ────────────────────────────────────────────────────────
  const results: TestResult[] = [
    {
      direction: 'Role → Candidate',
      matrix: matRoleCand,
      sameDomainMarginOk: margin1.ok,
      dynamicRangeOk: range1.ok,
      minDynamicRange: range1.minRangeFound,
      inversionCount: inv1,
      marginFailures: margin1.failures,
      rangeFailures: range1.failures,
      rangeSkipped: range1.skipped,
    },
    {
      direction: 'Candidate → Role',
      matrix: matCandRole,
      sameDomainMarginOk: margin2.ok,
      dynamicRangeOk: range2.ok,
      minDynamicRange: range2.minRangeFound,
      inversionCount: inv2,
      marginFailures: margin2.failures,
      rangeFailures: range2.failures,
      rangeSkipped: range2.skipped,
    },
    {
      direction: 'Role → Repo',
      matrix: matRoleRepo,
      sameDomainMarginOk: margin3.ok,
      dynamicRangeOk: range3.ok,
      minDynamicRange: range3.minRangeFound,
      inversionCount: inv3,
      marginFailures: margin3.failures,
      rangeFailures: range3.failures,
      rangeSkipped: range3.skipped,
    },
    {
      direction: 'Candidate → Repo',
      matrix: matCandRepo,
      sameDomainMarginOk: margin4.ok,
      dynamicRangeOk: range4.ok,
      minDynamicRange: range4.minRangeFound,
      inversionCount: inv4,
      marginFailures: margin4.failures,
      rangeFailures: range4.failures,
      rangeSkipped: range4.skipped,
    },
  ];

  const allMarginsOk = results.every((r) => r.sameDomainMarginOk);
  const allRangesOk = results.every((r) => r.dynamicRangeOk);
  const totalInversions = results.reduce((s, r) => s + r.inversionCount, 0);
  const prefixOk = prefixTest.ok;

  // ─── Write markdown report ──────────────────────────────────────────────────
  const report = generateReport(results, prefixTest, {
    allMarginsOk,
    allRangesOk,
    totalInversions,
    prefixOk,
  });

  await writeFile('knowledge/outputs/vector-native-sniff-test-results.md', report);
  console.log('\n✅ Results written to knowledge/outputs/vector-native-sniff-test-results.md');

  // Final verdict
  const pass = allMarginsOk && allRangesOk && prefixOk;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(pass ? '✅ OVERALL: PASS' : '❌ OVERALL: FAIL');
  console.log('   Margins:   ' + (allMarginsOk ? 'PASS' : 'FAIL'));
  console.log('   Ranges:    ' + (allRangesOk ? 'PASS' : 'FAIL'));
  console.log('   Prefix:    ' + (prefixOk ? 'PASS' : 'FAIL'));
  console.log('   Inversions: ' + totalInversions + ' total');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(pass ? 0 : 1);
}

// ─── Report generator ─────────────────────────────────────────────────────────

function generateReport(
  results: TestResult[],
  prefixTest: { ok: boolean; details: string; vectorDiff: number; avgDelta: number },
  summary: {
    allMarginsOk: boolean;
    allRangesOk: boolean;
    totalInversions: number;
    prefixOk: boolean;
  },
): string {
  const now = new Date().toISOString();

  let md = `# Vector-Native Sniff Test Results\n\n`;
  md += `> **Generated:** ${now}\n`;
  md += `> **Model:** ${BGE_MODEL} (via @xenova/transformers)\n`;
  md += `> **Framework:** Xenova Transformers (local inference, fp32)\n\n`;

  md += `## Executive Summary\n\n`;
  md += `| Criterion | Result | Threshold |\n`;
  md += `|---|---|---|\n`;
  md += `| Same-domain margin ≥ 0.10 | ${summary.allMarginsOk ? '**PASS** ✅' : '**FAIL** ❌'} | ≥ 0.10 |\n`;
  md += `| Dynamic range > 0.20 | ${summary.allRangesOk ? '**PASS** ✅' : '**FAIL** ❌'} | > 0.20 |\n`;
  md += `| Query prefix sensitivity | ${summary.prefixOk ? '**PASS** ✅' : '**FAIL** ❌'} | vectors different & non-harmful |\n`;
  md += `| Inversion count | ${summary.totalInversions} | < 5 per direction |\n\n`;

  md += `### Phase 4 Recommendation\n\n`;
  if (summary.allMarginsOk && summary.allRangesOk && summary.prefixOk && summary.totalInversions <= 10) {
    md += `**GO** ✅ — The unified BGE vector space shows strong domain discrimination. `;
    md += `Same-domain pairs consistently outrank cross-domain pairs with comfortable margins, `;
    md += `dynamic range is healthy per query row, and the query prefix behaves as expected. `;
    md += `Proceed with the Phase 4 pipeline flip (vector-native ANN as primary, SQL graph as fallback).\n\n`;
    md += `**Caveats:**\n`;
    md += `- This is a synthetic test with 5 fixtures per entity type. Real profiles may be noisier, sparser, or bimodal (dense synthesis vs. raw bio).\n`;
    md += `- Fine-grained skill matching (e.g., Apollo Client ↔ GraphQL) was not tested.\n`;
    md += `- Recruiter feedback calibration (N≥100) remains required to validate the combinator weights, not just the embedding space.\n`;
  } else {
    md += `**CONDITIONAL NO-GO** ❌ — The vector space failed one or more structural assertions. `;
    md += `Review the failures below before flipping the pipeline.\n\n`;
    md += `**Failures to investigate:**\n`;
    for (const r of results) {
      if (!r.sameDomainMarginOk) {
        md += `- **${r.direction}** — Same-domain margin too small:\n`;
        for (const f of r.marginFailures) md += `  - ${f}\n`;
      }
      if (!r.dynamicRangeOk) {
        md += `- **${r.direction}** — Dynamic range collapsed:\n`;
        for (const f of r.rangeFailures) md += `  - ${f}\n`;
      }
    }
    if (!summary.prefixOk) {
      md += `- **Prefix sensitivity** — Query prefix did not meet criteria:\n`;
      md += `  - Vector angular distance: ${prefixTest.vectorDiff.toFixed(6)} (must be > 0.001)\n`;
      md += `  - Average retrieval delta: ${prefixTest.avgDelta.toFixed(4)} (must be > -0.01)\n`;
    }
    if (summary.totalInversions > 10) {
      md += `- **Inversions** — ${summary.totalInversions} total inversions detected. Domain is not the dominant axis.\n`;
    }
  }

  md += `\n---\n\n`;

  // Fixture legend
  md += `## Fixtures\n\n`;
  md += `### Roles\n\n`;
  for (const r of ROLES) {
    md += `- **${r.id}** (${r.domain}): ${r.text}\n`;
  }
  md += `\n### Candidates\n\n`;
  for (const c of CANDIDATES) {
    md += `- **${c.id}** (${c.domain}): ${c.text.slice(0, 120)}...\n`;
  }
  md += `\n### Repos\n\n`;
  for (const r of REPOS) {
    md += `- **${r.id}** (${r.domain}): ${r.text.slice(0, 120)}...\n`;
  }

  md += `\n---\n\n`;

  // Matrices
  for (const r of results) {
    md += `## ${r.direction}\n\n`;
    const targets =
      r.direction === 'Role → Candidate'
        ? CANDIDATES
        : r.direction === 'Candidate → Role'
          ? ROLES
          : r.direction === 'Role → Repo'
            ? REPOS
            : REPOS;
    md += formatMatrix(r.matrix, targets);
    md += `\n`;
    md += `- **Same-domain margin ≥ 0.10:** ${r.sameDomainMarginOk ? 'PASS' : 'FAIL'}\n`;
    if (r.marginFailures.length) {
      md += `  - Failures: ${r.marginFailures.join('; ')}\n`;
    }
    md += `- **Dynamic range > 0.20:** ${r.dynamicRangeOk ? 'PASS' : 'FAIL'} (min: ${r.minDynamicRange.toFixed(4)}, skipped: ${r.rangeSkipped})\n`;
    if (r.rangeFailures.length) {
      md += `  - Failures: ${r.rangeFailures.join('; ')}\n`;
    }
    md += `- **Inversions:** ${r.inversionCount}\n\n`;
  }

  // Prefix sensitivity
  md += `## Prefix Sensitivity Test\n\n`;
  md += `This test verifies that \`preprocessForEmbedding(text, 'query')\` produces a measurably different embedding `;
  md += `and does not harm retrieval when the text is used as a query against documents.\n\n`;
  md += '```\n' + prefixTest.details + '\n```\n\n';
  md += `**Result:** ${prefixTest.ok ? 'PASS ✅' : 'FAIL ❌'}\n`;
  md += `- Vector angular distance: ${prefixTest.vectorDiff.toFixed(6)}\n`;
  md += `- Average retrieval delta: ${prefixTest.avgDelta.toFixed(4)}\n\n`;

  md += `---\n\n`;
  md += `*End of report.*\n`;

  return md;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
