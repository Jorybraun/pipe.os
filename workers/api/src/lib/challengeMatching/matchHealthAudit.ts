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
  maxSelectedPacketShare: number;
  minCurrentBreadthMatchesForSkew: number;
}

export interface SelectedPacketHealthSummary {
  packetId: string;
  count: number;
  share: number;
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
  failures: string[];
  warnings: string[];
  nextAction: CodeReviewMatchHealthNextAction;
  thresholds: CodeReviewMatchHealthThresholds;
}

const DEFAULT_THRESHOLDS: CodeReviewMatchHealthThresholds = {
  minProductionReadyPackets: 8,
  minProductionReadyRepos: 3,
  maxSelectedPacketShare: 0.75,
  minCurrentBreadthMatchesForSkew: 5,
};

function normalizeThresholds(
  thresholds: Partial<CodeReviewMatchHealthThresholds> | undefined,
): CodeReviewMatchHealthThresholds {
  return {
    minProductionReadyPackets: thresholds?.minProductionReadyPackets ?? DEFAULT_THRESHOLDS.minProductionReadyPackets,
    minProductionReadyRepos: thresholds?.minProductionReadyRepos ?? DEFAULT_THRESHOLDS.minProductionReadyRepos,
    maxSelectedPacketShare: thresholds?.maxSelectedPacketShare ?? DEFAULT_THRESHOLDS.maxSelectedPacketShare,
    minCurrentBreadthMatchesForSkew: thresholds?.minCurrentBreadthMatchesForSkew
      ?? DEFAULT_THRESHOLDS.minCurrentBreadthMatchesForSkew,
  };
}

function selectedPacketSkew(
  matches: CodeReviewMatchHealthRow[],
): SelectedPacketHealthSummary | null {
  const selected = matches.filter((match) =>
    match.status === 'MATCHED' && match.selectedPacketId
  );
  if (selected.length === 0) return null;

  const counts = new Map<string, number>();
  for (const match of selected) {
    if (!match.selectedPacketId) continue;
    counts.set(match.selectedPacketId, (counts.get(match.selectedPacketId) ?? 0) + 1);
  }

  const [packetId, count] = [...counts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0])
  )[0]!;

  return {
    packetId,
    count,
    share: count / selected.length,
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
  const skew = selectedPacketSkew(currentBreadthSelectedMatches);
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
        && skew.share > thresholds.maxSelectedPacketShare
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
    failures,
    warnings,
    nextAction,
    thresholds,
  };
}
