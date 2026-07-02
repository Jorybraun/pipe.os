import { AssessmentLayerStore, type AssessmentEvidenceEvent } from './persistence';
import { deterministicEntityId } from '../livingContext/persistence';

interface CandidateProfileRow {
  id: string;
  name: string | null;
  email: string | null;
  status: string | null;
  resume_s3_key: string | null;
}

interface AssessmentSessionProfileRow {
  id: string;
  interview_id: string | null;
  candidate_id: string | null;
  created_by: string | null;
}

interface ScheduledInterviewProfileRow {
  candidate_id: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
}

interface TableColumnRow {
  name: string;
}

export interface AssessmentCandidateProfileEvidenceInput {
  sessionId: string;
  candidateId?: string | null;
  actorId?: string | null;
  occurredAt?: string | null;
}

export async function recordAssessmentCandidateProfileEvidence(
  db: D1Database,
  input: AssessmentCandidateProfileEvidenceInput,
): Promise<AssessmentEvidenceEvent | null> {
  const session = await db.prepare(
    `SELECT id, interview_id, candidate_id, created_by
       FROM assessment_sessions
      WHERE id = ?1
      LIMIT 1`,
  ).bind(input.sessionId).first<AssessmentSessionProfileRow>();
  if (!session) return null;

  let interview: ScheduledInterviewProfileRow | null = null;
  if (session.interview_id) {
    interview = await db.prepare(
      `SELECT candidate_id, recipient_name, recipient_email
         FROM scheduled_interviews
        WHERE id = ?1
        LIMIT 1`,
    ).bind(session.interview_id).first<ScheduledInterviewProfileRow>();
  }

  const candidateId = input.candidateId ?? session.candidate_id ?? interview?.candidate_id ?? null;
  if (!candidateId) return null;

  const candidateColumns = await db.prepare(`PRAGMA table_info(candidates)`).all<TableColumnRow>();
  const hasResumeStorageKey = (candidateColumns.results ?? []).some((column) => column.name === 'resume_s3_key');
  const candidate = await db.prepare(
    `SELECT id, name, email, status, ${hasResumeStorageKey ? 'resume_s3_key' : 'NULL AS resume_s3_key'}
       FROM candidates
      WHERE id = ?1
      LIMIT 1`,
  ).bind(candidateId).first<CandidateProfileRow>();
  if (!candidate && !interview) return null;

  const profileName = candidate?.name ?? interview?.recipient_name ?? null;
  const profileEmail = candidate?.email ?? interview?.recipient_email ?? null;
  const exactText = [
    `Candidate ID: ${candidateId}`,
    ...(profileName ? [`Name: ${profileName}`] : []),
    ...(profileEmail ? [`Email: ${profileEmail}`] : []),
    ...(candidate?.status ? [`Status: ${candidate.status}`] : []),
    ...(candidate?.resume_s3_key ? [`Resume storage key: ${candidate.resume_s3_key}`] : []),
    ...(session.interview_id ? [`Scheduled interview ID: ${session.interview_id}`] : []),
  ].join('\n');
  if (!exactText.trim()) return null;

  const contentHash = await deterministicEntityId('content', exactText);
  const store = new AssessmentLayerStore(db);
  return store.recordAssessmentEvent({
    sessionId: session.id,
    ingestionKey: `assessment-event:${session.id}:candidate-profile:${contentHash}`,
    kind: 'candidate_profile',
    actorType: 'system',
    actorId: input.actorId ?? session.created_by ?? 'pipe-assessment',
    narrative: 'PIPE snapshotted candidate profile evidence for the assessment.',
    payload: {
      candidateId,
      hasName: Boolean(profileName),
      hasEmail: Boolean(profileEmail),
      hasResumeStorageKey: Boolean(candidate?.resume_s3_key),
      scheduledInterviewId: session.interview_id,
    },
    occurredAt: input.occurredAt ?? undefined,
    sourceRefs: [
      {
        sourceRefType: 'candidate_profile',
        sourceRefId: `candidate:${candidateId}:profile:${contentHash}`,
        evidenceRole: 'candidate_profile_snapshot',
        locator: {
          candidateId,
          scheduledInterviewId: session.interview_id,
          sourceTables: ['candidates', 'scheduled_interviews'],
        },
        exactText,
        contentHash,
        metadata: {
          schemaVersion: 'assessment-candidate-profile-v1',
          source: 'assessment_session_candidate_profile_snapshot',
        },
      },
    ],
  });
}
