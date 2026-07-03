export interface CodeReviewPacketHealthRow {
  packetId: string;
  repoId: string;
  repoUrl: string | null;
  prNumber: number;
  productionReady: boolean;
}

export interface CodeReviewMatchHealthRow {
  matchRunId: string;
  roleContextId: string | null;
  selectedPacketId: string | null;
  status: string;
  contrastScore: number | null;
  recalledPacketCount?: number | null;
}

export interface CodeReviewMatchHealthThresholds {
  minProductionReadyPackets: number;
  minProductionReadyRepos: number;
  minSelectedProductionReadyPackets: number;
  maxSelectedPacketShare: number;
  minCurrentBreadthMatchesForSkew: number;
}

export interface SelectedPacketHealthSummary {
  packetId: string;
  count: number;
  share: number;
}

export interface SelectedPacketHealthDistributionEntry extends SelectedPacketHealthSummary {
  repoId: string | null;
  repoUrl: string | null;
  prNumber: number | null;
  productionReady: boolean;
}

export interface ProductionReadyPacketHealthSummary {
  packetId: string;
  repoId: string;
  repoUrl: string | null;
  prNumber: number;
  productionReady: true;
}

export type CodeReviewMatchHealthNextAction =
  | 'demote_unsafe_role_backed_matches'
  | 'add_source_backed_challenge_packets'
  | 'rebalance_challenge_corpus'
  | 'run_labelled_evaluation';

export interface CodeReviewMatchHealthAudit {
  ok: boolean;
  productionReadyPacketCount: number;
  productionReadyRepoCount: number;
  selectedMatchCount: number;
  currentBreadthSelectedMatchCount: number;
  staleOrNarrowSelectedMatchCount: number;
  roleBackedUnsafeMatchCount: number;
  selectedPacketSkew: SelectedPacketHealthSummary | null;
  selectedPacketDistribution: SelectedPacketHealthDistributionEntry[];
  selectedProductionReadyPacketCount: number;
  unselectedProductionReadyPackets: ProductionReadyPacketHealthSummary[];
  failures: string[];
  warnings: string[];
  nextAction: CodeReviewMatchHealthNextAction;
  thresholds: CodeReviewMatchHealthThresholds;
}

const DEFAULT_THRESHOLDS: CodeReviewMatchHealthThresholds = {
  minProductionReadyPackets: 8,
  minProductionReadyRepos: 3,
  minSelectedProductionReadyPackets: 3,
  maxSelectedPacketShare: 0.75,
  minCurrentBreadthMatchesForSkew: 5,
};

function normalizeThresholds(
  thresholds: Partial<CodeReviewMatchHealthThresholds> | undefined,
): CodeReviewMatchHealthThresholds {
  return {
    minProductionReadyPackets: thresholds?.minProductionReadyPackets ?? DEFAULT_THRESHOLDS.minProductionReadyPackets,
    minProductionReadyRepos: thresholds?.minProductionReadyRepos ?? DEFAULT_THRESHOLDS.minProductionReadyRepos,
    minSelectedProductionReadyPackets: thresholds?.minSelectedProductionReadyPackets
      ?? DEFAULT_THRESHOLDS.minSelectedProductionReadyPackets,
    maxSelectedPacketShare: thresholds?.maxSelectedPacketShare ?? DEFAULT_THRESHOLDS.maxSelectedPacketShare,
    minCurrentBreadthMatchesForSkew: thresholds?.minCurrentBreadthMatchesForSkew
      ?? DEFAULT_THRESHOLDS.minCurrentBreadthMatchesForSkew,
  };
}

function selectedPacketDistribution(
  matches: CodeReviewMatchHealthRow[],
  packets: CodeReviewPacketHealthRow[],
): SelectedPacketHealthDistributionEntry[] {
  const selected = matches.filter((match) =>
    match.status === 'MATCHED' && match.selectedPacketId
  );
  if (selected.length === 0) return [];

  const packetById = new Map(packets.map((packet) => [packet.packetId, packet]));
  const counts = new Map<string, number>();
  for (const match of selected) {
    if (!match.selectedPacketId) continue;
    counts.set(match.selectedPacketId, (counts.get(match.selectedPacketId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([packetId, count]) => {
      const packet = packetById.get(packetId);
      return {
        packetId,
        count,
        share: count / selected.length,
        repoId: packet?.repoId ?? null,
        repoUrl: packet?.repoUrl ?? null,
        prNumber: packet?.prNumber ?? null,
        productionReady: packet?.productionReady ?? false,
      };
    });
}

function productionPacketSummary(
  packet: CodeReviewPacketHealthRow,
): ProductionReadyPacketHealthSummary {
  return {
    packetId: packet.packetId,
    repoId: packet.repoId,
    repoUrl: packet.repoUrl,
    prNumber: packet.prNumber,
    productionReady: true,
  };
}

export function auditCodeReviewMatchHealth(input: {
  packets: CodeReviewPacketHealthRow[];
  matches: CodeReviewMatchHealthRow[];
  thresholds?: Partial<CodeReviewMatchHealthThresholds>;
}): CodeReviewMatchHealthAudit {
  const thresholds = normalizeThresholds(input.thresholds);
  const productionReadyPackets = input.packets.filter((packet) => packet.productionReady);
  const productionReadyRepoCount = new Set(
    productionReadyPackets.map((packet) => packet.repoId),
  ).size;
  const selectedMatches = input.matches.filter((match) =>
    match.status === 'MATCHED' && match.selectedPacketId
  );
  const currentBreadthSelectedMatches = selectedMatches.filter((match) =>
    match.recalledPacketCount === undefined
      || match.recalledPacketCount === null
      || match.recalledPacketCount >= productionReadyPackets.length
  );
  const staleOrNarrowSelectedMatchCount = selectedMatches.length - currentBreadthSelectedMatches.length;
  const roleBackedUnsafeMatchCount = selectedMatches.filter((match) =>
    match.roleContextId !== null && (match.contrastScore ?? 0) <= 0
  ).length;
  const distribution = selectedPacketDistribution(currentBreadthSelectedMatches, input.packets);
  const selectedProductionReadyPacketIds = new Set(
    distribution
      .filter((entry) => entry.productionReady)
      .map((entry) => entry.packetId),
  );
  const selectedProductionReadyPacketCount = selectedProductionReadyPacketIds.size;
  const unselectedProductionReadyPackets = productionReadyPackets
    .filter((packet) => !selectedProductionReadyPacketIds.has(packet.packetId))
    .map(productionPacketSummary)
    .sort((left, right) =>
      left.repoId.localeCompare(right.repoId)
      || left.prNumber - right.prNumber
      || left.packetId.localeCompare(right.packetId)
    );
  const skew = distribution[0]
    ? {
      packetId: distribution[0].packetId,
      count: distribution[0].count,
      share: distribution[0].share,
    }
    : null;
  const failures: string[] = [];
  const warnings: string[] = [];

  if (roleBackedUnsafeMatchCount > 0) {
    failures.push(`${roleBackedUnsafeMatchCount} role-backed matched run(s) fail contrast separation.`);
  }
  if (productionReadyPackets.length < thresholds.minProductionReadyPackets) {
    failures.push(
      `Only ${productionReadyPackets.length} production-ready packet(s); need at least ${thresholds.minProductionReadyPackets}.`,
    );
  }
  if (productionReadyRepoCount < thresholds.minProductionReadyRepos) {
    failures.push(
      `Only ${productionReadyRepoCount} production-ready repo(s); need at least ${thresholds.minProductionReadyRepos}.`,
    );
  }
  if (
    currentBreadthSelectedMatches.length >= thresholds.minCurrentBreadthMatchesForSkew
    && skew
    && skew.share > thresholds.maxSelectedPacketShare
  ) {
    failures.push(
      `Selected packet ${skew.packetId} owns ${Math.round(skew.share * 100)}% of matched runs; max is ${Math.round(thresholds.maxSelectedPacketShare * 100)}%.`,
    );
  }
  if (
    currentBreadthSelectedMatches.length >= thresholds.minCurrentBreadthMatchesForSkew
    && selectedProductionReadyPacketCount < thresholds.minSelectedProductionReadyPackets
  ) {
    failures.push(
      `Only ${selectedProductionReadyPacketCount} production-ready packet(s) were selected by current-breadth matches; need at least ${thresholds.minSelectedProductionReadyPackets}.`,
    );
  }
  if (selectedMatches.length === 0) {
    warnings.push('No matched runs were available for selected-packet skew analysis.');
  }
  if (staleOrNarrowSelectedMatchCount > 0) {
    warnings.push(
      `${staleOrNarrowSelectedMatchCount} matched run(s) recalled fewer than the current ${productionReadyPackets.length} production-ready packet(s) and were excluded from selected-packet skew analysis.`,
    );
  }
  if (
    selectedMatches.length > 0
    && currentBreadthSelectedMatches.length < thresholds.minCurrentBreadthMatchesForSkew
  ) {
    warnings.push(
      `Only ${currentBreadthSelectedMatches.length} current-breadth matched run(s) were available for selected-packet skew analysis; need at least ${thresholds.minCurrentBreadthMatchesForSkew} to fail skew.`,
    );
  }

  const nextAction: CodeReviewMatchHealthNextAction = roleBackedUnsafeMatchCount > 0
    ? 'demote_unsafe_role_backed_matches'
    : productionReadyPackets.length < thresholds.minProductionReadyPackets
      || productionReadyRepoCount < thresholds.minProductionReadyRepos
      ? 'add_source_backed_challenge_packets'
      : currentBreadthSelectedMatches.length >= thresholds.minCurrentBreadthMatchesForSkew
        && skew
        && (
          skew.share > thresholds.maxSelectedPacketShare
          || selectedProductionReadyPacketCount < thresholds.minSelectedProductionReadyPackets
        )
        ? 'rebalance_challenge_corpus'
        : 'run_labelled_evaluation';

  return {
    ok: failures.length === 0,
    productionReadyPacketCount: productionReadyPackets.length,
    productionReadyRepoCount,
    selectedMatchCount: selectedMatches.length,
    currentBreadthSelectedMatchCount: currentBreadthSelectedMatches.length,
    staleOrNarrowSelectedMatchCount,
    roleBackedUnsafeMatchCount,
    selectedPacketSkew: skew,
    selectedPacketDistribution: distribution,
    selectedProductionReadyPacketCount,
    unselectedProductionReadyPackets,
    failures,
    warnings,
    nextAction,
    thresholds,
  };
}
