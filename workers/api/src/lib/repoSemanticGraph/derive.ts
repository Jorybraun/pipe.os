import {
  buildCodeEpisode,
  buildFacet,
  buildRepoSignal,
  buildSemanticAssertion,
} from './builders';
import type {
  ChallengePacket,
  CodeEpisode,
  Facet,
  NormalizedPullRequestInput,
  RepoSignal,
  SemanticAssertion,
  StructuralFact,
} from './model';

export interface DerivedRepoSemantics {
  episodes: CodeEpisode[];
  facets: Facet[];
  assertions: SemanticAssertion[];
  signals: RepoSignal[];
}

function conceptLabel(conceptKey: string): string {
  const value = conceptKey.includes(':')
    ? conceptKey.slice(conceptKey.indexOf(':') + 1)
    : conceptKey;
  return value.replace(/[-_]+/g, ' ').trim() || conceptKey;
}

function facetKind(conceptKey: string): string {
  const separator = conceptKey.indexOf(':');
  return separator > 0 ? conceptKey.slice(0, separator) : 'term';
}

export async function deriveRepoSemantics(input: {
  pullRequest: NormalizedPullRequestInput;
  packet: ChallengePacket;
  structuralFacts: StructuralFact[];
}): Promise<DerivedRepoSemantics> {
  const { pullRequest, packet, structuralFacts } = input;
  const allConcepts = [...new Set(
    packet.demands.flatMap((demand) => demand.conceptKeys),
  )].sort();
  const sourceSpanIds = [...new Set(packet.sourceSpanIds)].sort();
  const episode = await buildCodeEpisode({
    repoSnapshotId: pullRequest.repoSnapshot.id,
    title: `Pull request #${pullRequest.number}: ${pullRequest.title}`,
    narrative: pullRequest.body?.trim() || pullRequest.title,
    symbolIds: packet.changedSymbolIds,
    structuralFactIds: structuralFacts.map((fact) => fact.id),
    sourceSpanIds,
    conceptKeys: allConcepts,
  });

  const facets: Facet[] = [];
  const facetsByKey = new Map<string, Facet>();
  for (const conceptKey of allConcepts) {
    const demandSpans = packet.demands
      .filter((demand) => demand.conceptKeys.includes(conceptKey))
      .flatMap((demand) => demand.sourceSpanIds);
    const facet = await buildFacet({
      repoSnapshotId: pullRequest.repoSnapshot.id,
      kind: facetKind(conceptKey),
      key: conceptKey,
      label: conceptLabel(conceptKey),
      sourceSpanIds: [...new Set(demandSpans)].sort(),
      confidence: 1,
    });
    facets.push(facet);
    facetsByKey.set(conceptKey, facet);
  }

  const assertions: SemanticAssertion[] = [];
  for (const demand of packet.demands) {
    assertions.push(await buildSemanticAssertion({
      repoSnapshotId: pullRequest.repoSnapshot.id,
      episodeId: episode.id,
      subject: `pull_request:${pullRequest.number}`,
      predicate: `review_demand:${demand.family}`,
      object: demand.family,
      narrative: demand.narrative,
      qualifiers: {
        demandId: demand.id,
        weight: demand.weight,
      },
      facetIds: demand.conceptKeys
        .flatMap((key) => facetsByKey.get(key)?.id ?? [])
        .sort(),
      conceptKeys: demand.conceptKeys,
      sourceSpanIds: demand.sourceSpanIds,
      confidence: 1,
      extractor: packet.policyVersion,
    }));
  }

  const spanArtifacts = new Map(
    pullRequest.sourceSpans.map((span) => [span.id, span.artifactId]),
  );
  const signals: RepoSignal[] = [];
  for (const facet of facets) {
    const supportingAssertions = assertions.filter((assertion) =>
      assertion.facetIds.includes(facet.id)
    );
    if (supportingAssertions.length === 0) continue;
    const signalSpanIds = [...new Set(
      supportingAssertions.flatMap((assertion) => assertion.sourceSpanIds),
    )].sort();
    signals.push(await buildRepoSignal({
      repoSnapshotId: pullRequest.repoSnapshot.id,
      key: facet.key,
      narrative: supportingAssertions.map((assertion) => assertion.narrative).join(' '),
      assertionIds: supportingAssertions.map((assertion) => assertion.id),
      facetIds: [facet.id],
      sourceSpanIds: signalSpanIds,
      confidence: Math.min(
        ...supportingAssertions.map((assertion) => assertion.confidence),
      ),
      sourceDiversity: new Set(
        signalSpanIds.flatMap((spanId) => spanArtifacts.get(spanId) ?? []),
      ).size || 1,
    }));
  }

  return {
    episodes: [episode],
    facets,
    assertions,
    signals,
  };
}
