import { describe, expect, it } from 'vitest';
import { buildChallengePacket, deriveRepoSemantics } from '../../../lib/repoSemanticGraph';
import { buildFixtureChallengeInput } from '../e2eSeed';

const NOW = '2026-06-21T18:00:00.000Z';

describe('standalone review E2E seed helpers', () => {
  it('builds production-ready review packets through normalized PR evidence', async () => {
    const conceptKey = 'term:unseen-e2e-context-edge';
    const seed = {
      candidateId: 'candidate-1',
      concepts: [{
        canonicalKey: conceptKey,
        namespace: 'term',
        label: 'unseen e2e context edge',
      }],
      candidateEvidence: [{
        exactText: 'Implemented unseen e2e context edge retry idempotency.',
        predicate: 'implemented',
        conceptKeys: [conceptKey],
        evidenceLevel: 'implemented' as const,
      }],
      repo: {
        githubUrl: 'https://github.com/pipe/e2e-context-edge',
        fullName: 'pipe/e2e-context-edge',
        primaryLanguage: 'TypeScript',
      },
      pullRequest: {
        number: 42,
        title: 'Review source-backed context edge idempotency',
        author: 'pipe-e2e',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headSha: 'dddddddddddddddddddddddddddddddddddddddd',
        mergedAt: NOW,
      },
      repoSpans: [
        {
          key: 'implementation',
          path: 'src/context-edge.ts',
          artifactType: 'source',
          lineStart: 10,
          exactText: [
            'export type ContextEdgeEvent = { id: string; key: string; attempt: number };',
            '',
            '// Implement unseen e2e context edge idempotency for reviewable retry events.',
            'export function buildContextEdgeEnvelope(event: ContextEdgeEvent) {',
            '  const idempotencyKey = `${event.key}:${event.attempt}`;',
            '  return {',
            '    id: event.id,',
            '    idempotencyKey,',
            '    shouldPublish: event.attempt > 0,',
            '  };',
            '}',
          ].join('\n'),
        },
        {
          key: 'publisher',
          path: 'src/context-edge-publisher.ts',
          artifactType: 'source',
          lineStart: 40,
          exactText: [
            "import { buildContextEdgeEnvelope, type ContextEdgeEvent } from './context-edge';",
            '',
            'export function publishContextEdge(event: ContextEdgeEvent, publish: (key: string) => void) {',
            '  const envelope = buildContextEdgeEnvelope(event);',
            "  if (!envelope.shouldPublish) return 'skipped';",
            '  publish(envelope.idempotencyKey);',
            "  return 'published';",
            '}',
          ].join('\n'),
        },
        {
          key: 'validation',
          path: 'src/context-edge.test.ts',
          artifactType: 'test',
          lineStart: 70,
          exactText: [
            "import { describe, expect, it } from 'vitest';",
            "import { buildContextEdgeEnvelope } from './context-edge';",
            '',
            "describe('unseen e2e context edge retry behavior', () => {",
            "  it('keeps retry acknowledgement idempotent', () => {",
            '    const envelope = buildContextEdgeEnvelope({ id: \'evt-1\', attempt: 2, key: \'retry\' });',
            "    expect(envelope.idempotencyKey).toBe('retry:2');",
            '    expect(envelope.shouldPublish).toBe(true);',
            '  });',
            '});',
          ].join('\n'),
        },
      ],
      demands: [
        {
          id: 'implementation-demand',
          family: 'source-backed:e2e-implementation',
          narrative: 'Review implemented unseen e2e context edge idempotency.',
          conceptKeys: [conceptKey],
          sourceSpanKeys: ['implementation', 'publisher'],
          weight: 0.75,
        },
        {
          id: 'validation-demand',
          family: 'source-backed:e2e-validation',
          narrative: 'Review validated unseen e2e context edge retry behavior.',
          conceptKeys: [conceptKey],
          sourceSpanKeys: ['validation'],
          weight: 0.25,
        },
      ],
    };

    const { challengeInput, structuralFacts } = await buildFixtureChallengeInput({
      fixtureId: 'fixture-production-ready-packet',
      seed,
      now: NOW,
    });
    const packet = await buildChallengePacket(challengeInput);
    const semantics = await deriveRepoSemantics({
      pullRequest: challengeInput,
      packet,
      structuralFacts,
    });

    expect(challengeInput.changedFiles).toHaveLength(3);
    expect(challengeInput.changedFiles.reduce((sum, file) => sum + file.additions + file.deletions, 0))
      .toBeGreaterThanOrEqual(20);
    expect(packet.quality.eligible).toBe(true);
    expect(packet.quality.gates.every((gate) => gate.passed)).toBe(true);
    expect(packet.demands.length).toBeGreaterThanOrEqual(2);
    expect(packet.demands.some((demand) => demand.conceptKeys.includes(conceptKey))).toBe(true);
    expect(packet.sourceSpanIds.every((spanId) =>
      challengeInput.sourceSpans.some((span) => span.id === spanId)
    )).toBe(true);
    expect(semantics.assertions).toHaveLength(packet.demands.length);
    expect(semantics.signals.some((signal) => signal.key === conceptKey)).toBe(true);
  });
});
