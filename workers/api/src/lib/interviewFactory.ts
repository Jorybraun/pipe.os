import { deterministicEntityId } from './livingContext/persistence';
import { RepoTaskInterviewSessionStore } from './repoTaskInterviewSession';
import { recordAssessmentCandidateProfileEvidence } from './assessmentLayer/candidateProfileEvidence';
import type { AssessmentEvidenceSourceRefInput } from './assessmentLayer/persistence';
import type { AssessmentProgressSnapshot } from './repoTaskInterviewSession';

interface ChallengeRow {
  id: string;
  type: string;
  title: string;
  instructions: string | null;
  config: string | null;
  server_config: string | null;
  dev_container_repo_url: string | null;
  dev_container_challenge_branch: string | null;
  dev_container_ttl_seconds: number | null;
}

interface CreateCustomContainerAssessmentInput {
  db: D1Database;
  userId: string;
  candidateId: string;
  interviewId: string;
  challengeId: string;
  createdAt: string;
}

interface CreateCustomContainerAssessmentResult {
  sessionId: string;
  progress: AssessmentProgressSnapshot;
}

function parseJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function arrayString(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function buildCustomContainerChallengeExactText(challenge: ChallengeRow): string {
  const config = parseJson(challenge.config);
  const serverConfig = parseJson(challenge.server_config);

  const repositoryUrl = challenge.dev_container_repo_url ?? '';
  const baseCommit = challenge.dev_container_challenge_branch ?? 'main';
  const verificationCommand = String(serverConfig.verificationCommand ?? 'npm test');

  const configSuccessCriteria = arrayString(config.successCriteria);
  const serverSuccessCriteria = arrayString(serverConfig.successCriteria);
  const successCriteria = serverSuccessCriteria.length > 0
    ? serverSuccessCriteria
    : (configSuccessCriteria.length > 0 ? configSuccessCriteria : ['Complete the challenge described in the instructions', 'Run the verification command and confirm success']);

  const configExpectedEvidence = arrayString(config.expectedEvidence);
  const serverExpectedEvidence = arrayString(serverConfig.expectedEvidence);
  const configExpectedArtifacts = arrayString(config.expectedArtifacts);
  const expectedEvidence = serverExpectedEvidence.length > 0
    ? serverExpectedEvidence
    : (configExpectedEvidence.length > 0 ? configExpectedEvidence : (configExpectedArtifacts.length > 0 ? configExpectedArtifacts : ['Required artifacts as described in the instructions']));

  const lines = [
    `Task: ${challenge.title}`,
    ...(challenge.instructions ? [`Instructions: ${challenge.instructions}`] : []),
    `Repo: ${repositoryUrl}`,
    `Base commit: ${baseCommit}`,
    `Verification command: ${verificationCommand}`,
    '',
    'Success criteria:',
    ...successCriteria.map((item) => `- ${item}`),
    '',
    'Expected evidence:',
    ...expectedEvidence.map((item) => `- ${item}`),
  ];

  return lines.join('\n');
}

export async function createCustomContainerAssessmentSession(
  input: CreateCustomContainerAssessmentInput,
): Promise<CreateCustomContainerAssessmentResult> {
  const { db, userId, candidateId, interviewId, challengeId, createdAt } = input;

  const challenge = await db
    .prepare(
      `SELECT id, type, title, instructions, config, server_config,
              dev_container_repo_url, dev_container_challenge_branch, dev_container_ttl_seconds
         FROM challenges
        WHERE id = ?1
        LIMIT 1`,
    )
    .bind(challengeId)
    .first<ChallengeRow>();

  if (!challenge) {
    throw new Error(`Challenge ${challengeId} not found`);
  }
  if (challenge.type !== 'CUSTOM_CONTAINER') {
    throw new Error(`Challenge ${challengeId} is not a CUSTOM_CONTAINER challenge`);
  }

  const exactText = buildCustomContainerChallengeExactText(challenge);
  const contentHash = await deterministicEntityId('content', exactText);

  const serverConfig = parseJson(challenge.server_config);
  const repositoryUrl = challenge.dev_container_repo_url ?? '';
  const baseCommit = challenge.dev_container_challenge_branch ?? 'main';
  const verificationCommand = String(serverConfig.verificationCommand ?? 'npm test');
  const containerImage = String(serverConfig.containerImage ?? '');

  const store = new RepoTaskInterviewSessionStore(db);

  const session = await store.createSession({
    ingestionKey: `assessment-session:${interviewId}:custom-container:${challengeId}`,
    interviewId,
    candidateId,
    mode: 'CUSTOM_CONTAINER',
    createdBy: userId,
    metadata: {
      challengeId,
      challengeTitle: challenge.title,
      verificationCommand,
      containerImage,
      challengeType: 'CUSTOM_CONTAINER',
    },
  });

  const sourceRef: AssessmentEvidenceSourceRefInput = {
    sourceRefType: 'challenge_packet',
    sourceRefId: `challenge:${challengeId}:custom-container:${contentHash}`,
    evidenceRole: 'assigned_challenge',
    locator: {
      challengeId,
      repositoryUrl,
      baseCommitSha: baseCommit,
      verificationCommand,
      challengeTitle: challenge.title,
    },
    exactText,
    contentHash,
    metadata: {
      schemaVersion: 'custom-container-challenge-packet-v1',
      source: 'challenge_library',
      challengeTitle: challenge.title,
      challengeType: 'CUSTOM_CONTAINER',
    },
  };

  await store.recordEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:${session.id}:custom-container-challenge:${contentHash}`,
    kind: 'recruiter_note',
    actorType: 'recruiter',
    actorId: userId,
    narrative: 'Recruiter assigned a custom container challenge from the challenge library.',
    payload: {
      challengeId,
      challengeTitle: challenge.title,
      repositoryUrl,
      baseCommitSha: baseCommit,
      verificationCommand,
      containerImage,
    },
    occurredAt: createdAt,
    sourceRefs: [sourceRef],
  });

  await recordAssessmentCandidateProfileEvidence(db, {
    sessionId: session.id,
    candidateId,
    actorId: userId,
    occurredAt: createdAt,
  });

  const progress = await store.loadProgress(session.id);
  return { sessionId: session.id, progress };
}
