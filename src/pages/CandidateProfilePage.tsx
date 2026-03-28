import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  Calendar,
  FileDown,
  CheckCircle,
  Briefcase,
  Mail,
  Clock,
  ExternalLink,
  ChevronRight,
  Brain,
} from "lucide-react";
import {
  resolveSchedulingProvider,
  ALL_PROVIDERS,
} from "../components/Scheduling/provider";
import { InterviewStatusBadge } from "../components/Scheduling/InterviewStatusBadge";
import type { InterviewStatus } from "../lib/scheduling/types";
import { LiquidMetalCard, SubTitle } from "../components";
import { useData, useStorage } from "../providers";
import { calculateSignal } from "../lib/utils";
import { FEATURES } from "../lib/features";
import { IntelligenceReportRenderer, IntelligenceBlockConfig } from "../components/Analytics/IntelligenceReportBlock";

// ============================================================================
// Local types
// ============================================================================

interface ChallengeRow {
  id: string;
  type?: string | null;
  title?: string | null;
  config?: unknown;
  instructions?: string | null;
}

interface StageRow {
  id: string;
  title?: string | null;
  order?: number | null;
  mode?: string | null;
  challenges?: ChallengeRow[] | null;
}

interface ScheduledInterviewRow {
  id: string;
  stageId?: string | null;
  status?: string | null;
  schedulingUrl?: string | null;
  meetingUrl?: string | null;
  scheduledAt?: string | null;
}

interface FollowUpAnswer {
  questionId: string;
  answer: string;
  answeredAt?: string;
}

interface FollowUpQuestionRecord {
  id: string;
  type: string;
  question: string;
  context?: string;
}

interface ParsedFollowUpJson {
  questions?: FollowUpQuestionRecord[];
  answers?: FollowUpAnswer[];
}

/** Now backed by ChallengeSubmission (ADR-023), not Assessment */
interface AssessmentRow {
  id: string;
  challengeId?: string | null;
  score?: number | null;
  submission?: unknown;
  feedback?: string | null;
  completedAt?: string | null;
  submittedAt?: string | null;
  followUpQuestionsJson?: string | number | boolean | object | unknown[] | null;
}

// ============================================================================
// Signal colour helpers
// ============================================================================

const SIGNAL_COLORS: Record<
  string,
  { text: string; bg: string; border: string }
> = {
  STRONG: {
    text: "#10b981",
    bg: "rgba(16,185,129,0.1)",
    border: "rgba(16,185,129,0.3)",
  },
  YES: {
    text: "#60a5fa",
    bg: "rgba(96,165,250,0.1)",
    border: "rgba(96,165,250,0.3)",
  },
  MAYBE: {
    text: "#fbbf24",
    bg: "rgba(251,191,36,0.1)",
    border: "rgba(251,191,36,0.3)",
  },
  NO: {
    text: "#f87171",
    bg: "rgba(248,113,113,0.1)",
    border: "rgba(248,113,113,0.3)",
  },
};

function getSignalColors(signal: string): {
  text: string;
  bg: string;
  border: string;
} {
  return (
    SIGNAL_COLORS[signal] ?? {
      text: "#fbbf24",
      bg: "rgba(251,191,36,0.1)",
      border: "rgba(251,191,36,0.3)",
    }
  );
}

const CHALLENGE_TYPE_COLORS: Record<string, string> = {
  CODE_REVIEW: "#60a5fa",
  CODE_IMPLEMENTATION: "#a78bfa",
  QUIZ_MCQ: "#4ade80",
  QUIZ_SHORT_ANSWER: "#fbbf24",
};

// ============================================================================
// Sub-components
// ============================================================================

function SignalBadge({ signal }: { signal: string }): JSX.Element {
  const colors = getSignalColors(signal);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        color: colors.text,
        letterSpacing: "0.1em",
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {signal}
    </span>
  );
}

function TypeBadge({ type }: { type: string }): JSX.Element {
  const color = CHALLENGE_TYPE_COLORS[type] ?? "rgba(255,255,255,0.3)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        background: `${color}14`,
        border: `1px solid ${color}40`,
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 700,
        color,
        letterSpacing: "0.08em",
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {type}
    </span>
  );
}

function FollowUpReadOnly({
  followUpQuestionsJson,
}: {
  followUpQuestionsJson?: string | number | boolean | object | unknown[] | null;
}): JSX.Element | null {
  if (!followUpQuestionsJson) return null;

  let parsed: ParsedFollowUpJson;
  try {
    parsed = (
      typeof followUpQuestionsJson === "string"
        ? JSON.parse(followUpQuestionsJson)
        : followUpQuestionsJson
    ) as ParsedFollowUpJson;
  } catch {
    return null;
  }

  const questions = parsed.questions ?? [];
  const answers = parsed.answers ?? [];

  if (questions.length === 0 && answers.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 24,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        paddingTop: 24,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <SubTitle>FOLLOW_UP_QUESTIONS</SubTitle>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {questions.map((q, idx) => {
          const answerRecord = answers.find((a) => a.questionId === q.id);
          return (
            <div key={q.id}>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.6)",
                  marginBottom: 8,
                  lineHeight: 1.5,
                }}
              >
                <span
                  style={{
                    color: "rgba(255,255,255,0.3)",
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 9,
                    marginRight: 8,
                  }}
                >
                  Q{idx + 1}
                </span>
                {q.question}
              </div>
              {answerRecord?.answer ? (
                <div
                  style={{
                    padding: "12px 16px",
                    background: "rgba(255,255,255,0.03)",
                    borderLeft: "2px solid rgba(255,255,255,0.1)",
                    fontSize: 13,
                    color: "rgba(255,255,255,0.8)",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {answerRecord.answer}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.2)",
                    fontFamily: '"Space Mono", monospace',
                    fontStyle: "italic",
                  }}
                >
                  NOT_ANSWERED
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuizMcqView({
  challenge,
  submission,
}: {
  challenge: ChallengeRow;
  submission: Record<string, unknown> | null;
}): JSX.Element {
  const config =
    typeof challenge.config === "string"
      ? (JSON.parse(challenge.config) as Record<string, unknown>)
      : ((challenge.config ?? {}) as Record<string, unknown>);
  const options = Array.isArray(config.options)
    ? (config.options as Array<{ id: string; text?: string; label?: string }>)
    : [];
  const answers = submission?.answers as Record<string, string> | undefined;
  const selectedId = answers?.["current"] ?? (submission?.selectedOptionId as string | undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          fontSize: 14,
          color: "#fff",
          fontWeight: 500,
          lineHeight: 1.5,
        }}
      >
        {(config.question as string | undefined) ?? "Question text missing"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((opt) => {
          const isSelected = selectedId === opt.id;
          const isCorrect =
            (config.correctOptionId as string | undefined) === opt.id ||
            (config.correct as string | undefined) === opt.id;
          return (
            <div
              key={opt.id}
              style={{
                padding: "12px 16px",
                background: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
                border: `1px solid ${isSelected ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: isSelected ? "#fff" : "rgba(255,255,255,0.5)",
                }}
              >
                {opt.text ?? opt.label ?? opt.id}
              </div>
              {isSelected && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: isCorrect ? "#10b981" : "#f87171",
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: "0.08em",
                  }}
                >
                  {isCorrect ? "CORRECT" : "INCORRECT"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChallengeCard({
  challenge,
  assessment,
  onScoreChange,
  onFeedbackChange,
}: {
  challenge: ChallengeRow;
  assessment: AssessmentRow | undefined;
  onScoreChange: (assessmentId: string, score: number) => void;
  onFeedbackChange: (assessmentId: string, feedback: string) => void;
}): JSX.Element {
  const challengeCardFactory = useData();
  const isManual = challenge.type === "QUIZ_SHORT_ANSWER" || challenge.type === "CODE_IMPLEMENTATION";
  const submission = assessment?.submission
    ? typeof assessment.submission === "string"
      ? (JSON.parse(assessment.submission) as Record<string, unknown>)
      : (assessment.submission as Record<string, unknown>)
    : null;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: '24px 32px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {challenge.type && <TypeBadge type={challenge.type} />}
          <h4 style={{ fontSize: 16, fontWeight: 800, color: "#fff", margin: 0 }}>
            {challenge.title ?? "Untitled Challenge"}
          </h4>
        </div>
        {assessment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
             <div style={{ fontSize: 9, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", fontFamily: '"Space Mono", monospace' }}>SCORE</div>
             <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{assessment.score}</div>
          </div>
        )}
      </div>

      <div style={{ padding: '32px' }}>
        {!assessment && (
          <div
            style={{
              padding: 40, border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 8,
              textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 11,
              fontFamily: '"Space Mono", monospace', letterSpacing: "0.1em",
            }}
          >
            NO_SUBMISSION_YET
          </div>
        )}

        {assessment && submission && (
          <div style={{ display: "grid", gridTemplateColumns: isManual ? "1fr 320px" : "1fr", gap: 40 }}>
            <div style={{ minWidth: 0 }}>
              {challenge.type === "CODE_REVIEW" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {(Boolean(submission.verdict) || Boolean(submission.summary)) && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: 24, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                      {Boolean(submission.verdict) && (
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                          <SubTitle>VERDICT</SubTitle>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", textTransform: "uppercase", fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em' }}>
                            {String(submission.verdict)}
                          </span>
                        </div>
                      )}
                      {Boolean(submission.summary) && (
                        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
                          {String(submission.summary)}
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <div style={{ marginBottom: 16 }}>
                      <SubTitle>CANDIDATE_ANNOTATIONS</SubTitle>
                    </div>
                    {Array.isArray(submission.annotations) && (submission.annotations as unknown[]).length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {(submission.annotations as Array<Record<string, unknown>>).map((ann, idx) => {
                          const sev = (ann.severity as string) ?? "minor";
                          const borderColor = sev === "critical" ? "#ef4444" : sev === "major" ? "#f59e0b" : "#60a5fa";
                          return (
                            <div key={idx} style={{ padding: "16px 20px", background: "rgba(255,255,255,0.03)", borderLeft: `3px solid ${borderColor}`, borderRadius: "0 4px 4px 0" }}>
                              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
                                {Boolean(ann.file) && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: '"Space Mono", monospace' }}>{String(ann.file).split("/").pop() ?? ""}:{String(ann.line ?? "")}</span>}
                                <span style={{ fontSize: 9, fontWeight: 800, color: borderColor, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: '"Space Mono", monospace' }}>{sev}</span>
                              </div>
                              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", lineHeight: 1.6 }}>{String(ann.comment ?? "")}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontStyle: "italic", fontFamily: '"Space Mono", monospace' }}>No annotations provided.</div>
                    )}
                  </div>
                  <FollowUpReadOnly followUpQuestionsJson={assessment.followUpQuestionsJson ?? null} />
                </div>
              )}

              {challenge.type === "QUIZ_MCQ" && <QuizMcqView challenge={challenge} submission={submission} />}

              {challenge.type === "QUIZ_SHORT_ANSWER" && (() => {
                const inputMode = (submission.inputMode as string | undefined) ?? 'text';
                if (inputMode === 'video') return <S3VideoPlayer s3Key={submission.videoS3Key as string ?? ''} label="CANDIDATE_VIDEO_RESPONSE" />;
                if (inputMode === 'voice') return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <SubTitle>VOICE_TRANSCRIPT</SubTitle>
                    <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                      {submission.text as string || <span style={{ color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>No transcript captured.</span>}
                    </div>
                    {Boolean(submission.audioS3Key) && <S3AudioPlayer s3Key={submission.audioS3Key as string} />}
                  </div>
                );
                return (
                  <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                    {(submission.text as string) || <span style={{ color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>No answer provided.</span>}
                  </div>
                );
              })()}

              {challenge.type === "CODE_IMPLEMENTATION" && (
                <div style={{ background: "#000", padding: 24, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }}>
                  <pre style={{ margin: 0, fontSize: 13, color: "#a78bfa", fontFamily: '"Space Mono", monospace', lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {(submission.code as string) || "// No code submitted"}
                  </pre>
                </div>
              )}
            </div>

            {isManual && (
              <div style={{ borderLeft: "1px solid rgba(255,255,255,0.05)", paddingLeft: 40 }}>
                <div style={{ marginBottom: 24 }}><SubTitle>RECRUITER_REVIEW</SubTitle></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                      <label style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: '"Space Mono", monospace', letterSpacing: "0.1em" }}>SCORE</label>
                      <span style={{ fontSize: 16, fontWeight: 900, color: "#fff", fontFamily: '"Space Mono", monospace' }}>{assessment.score}</span>
                    </div>
                    <input type="range" min="0" max="100" value={assessment.score ?? 0} onChange={async (e) => {
                      const newScore = parseInt(e.target.value, 10);
                      onScoreChange(assessment.id, newScore);
                      await challengeCardFactory.createClient().models.Assessment.update({ id: assessment.id, score: newScore });
                    }} style={{ width: "100%", cursor: "pointer", accentColor: "#a78bfa" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 12, fontFamily: '"Space Mono", monospace', letterSpacing: "0.1em" }}>FEEDBACK</label>
                    <textarea value={assessment.feedback ?? ""} onChange={async (e) => {
                      const newVal = e.target.value;
                      onFeedbackChange(assessment.id, newVal);
                      await challengeCardFactory.createClient().models.Assessment.update({ id: assessment.id, feedback: newVal });
                    }} placeholder="Add internal notes..." style={{ width: "100%", height: 200, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", padding: 16, color: "#fff", fontSize: 13, fontFamily: 'inherit', outline: "none", resize: "none", borderRadius: 8, boxSizing: "border-box", lineHeight: 1.6 }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </LiquidMetalCard>
  );
}

function S3AudioPlayer({ s3Key }: { s3Key: string }): JSX.Element {
  const storage = useStorage();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const result = await storage.getUrl({ path: s3Key, options: { expiresIn: 3600 } });
        setUrl(result.url.toString());
      } catch (err) { console.warn('[S3AudioPlayer] Failed to resolve URL:', err); }
    })();
  }, [s3Key, storage]);
  if (!url) return <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>LOADING_AUDIO...</span>;
  return <audio src={url} controls style={{ width: '100%', marginTop: 4 }} />;
}

function S3VideoPlayer({ s3Key, label = 'CANDIDATE_VIDEO_RESPONSE' }: { s3Key: string; label?: string }): JSX.Element {
  const storage = useStorage();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!s3Key) return;
    void (async () => {
      try {
        const result = await storage.getUrl({ path: s3Key, options: { expiresIn: 3600 } });
        setUrl(result.url.toString());
      } catch (err) { console.warn('[S3VideoPlayer] Failed to resolve URL:', err); }
    })();
  }, [s3Key, storage]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SubTitle>{label}</SubTitle>
      {url ? <video src={url} controls style={{ width: '100%', maxHeight: 400, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: '#000' }} /> : (
        <div style={{ padding: 40, textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.05)' }}>
          <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{s3Key ? 'LOADING_VIDEO...' : 'NO_VIDEO_SUBMITTED'}</span>
        </div>
      )}
    </div>
  );
}

interface CandidateRecord {
  id: string;
  name?: string | null;
  email?: string | null;
  pipelineId: string;
  status?: string | null;
  inviteToken?: string | null;
  currentStageId?: string | null;
  resumeS3Key?: string | null;
  score?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  currentRole?: string | null;
  yearsOfExperience?: number | null;
  skills?: string[] | null;
}

export default function CandidateProfilePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const dataFactory = useData();
  const storage = useStorage();
  const [candidate, setCandidate] = useState<CandidateRecord | null>(null);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>("OVERVIEW");
  const [scheduledInterview, setScheduledInterview] = useState<ScheduledInterviewRow | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteSaving, setInviteSaving] = useState(false);
  
  const [aiBlocks, setAiBlocks] = useState<IntelligenceBlockConfig[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    const client = dataFactory.createClient();
    try {
      setIsLoading(true);
      setError(null);
      const { data: cand } = await client.models.Candidate.get({ id });
      if (!cand) return;
      setCandidate(cand as unknown as CandidateRecord);
      const [candidateAssessments, stagesData] = await Promise.all([
        client.models.Assessment.list({ filter: { candidateId: { eq: id } } } as any),
        client.models.Stage.list({ filter: { pipelineId: { eq: cand.pipelineId } }, selectionSet: ["id", "title", "order", "mode", "challenges.*"] }),
      ]);

      // Fetch ChallengeSubmissions for each Assessment (ADR-023)
      const allSubmissions: AssessmentRow[] = [];
      for (const assessment of (candidateAssessments.data ?? [])) {
        if (!assessment?.id) continue;
        const { data: subs } = await client.models.ChallengeSubmission.list({
          filter: { assessmentId: { eq: assessment.id } },
        } as any);
        for (const sub of (subs ?? [])) {
          if (!sub) continue;
          const s = sub as Record<string, unknown>;
          if (!s['id']) continue;
          allSubmissions.push({
            id: s['id'] as string,
            challengeId: (s['challengeId'] as string | null) ?? null,
            score: (s['score'] as number | null) ?? null,
            submission: s['submission'] ?? null,
            feedback: (s['feedback'] as string | null) ?? null,
            completedAt: (s['scoredAt'] as string | null) ?? null,
            submittedAt: (s['submittedAt'] as string | null) ?? null,
            followUpQuestionsJson: s['followUpQuestionsJson'] ?? null,
          });
        }
      }
      setAssessments(allSubmissions);
      const sortedStages: StageRow[] = (stagesData.data as unknown as StageRow[]).filter((s): s is StageRow => s !== null).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setStages(sortedStages);
      if (sortedStages.length > 0 && selectedTab === "") setSelectedTab("OVERVIEW");
      const liveStage = sortedStages.find((s) => s.mode === "LIVE_VIDEO");
      if (liveStage) {
        try {
          const siList = await client.models.ScheduledInterview.list({ filter: { candidateId: { eq: id } } });
          const siData = siList.data as unknown as ScheduledInterviewRow[];
          const si = siData.find((s) => s.stageId === liveStage.id) ?? null;
          setScheduledInterview(si);
          if (si?.schedulingUrl) setInviteUrl(si.schedulingUrl as string);
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error("[CandidateProfilePage] Error fetching data:", err);
      setError(err instanceof Error ? err : new Error("Failed to load candidate profile"));
    } finally { setIsLoading(false); }
  }, [id, selectedTab, dataFactory]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateReport = async () => {
    if (!id) return;
    const client = dataFactory.createClient();
    setIsAiGenerating(true);
    try {
      const generateIntelligenceReport = client.mutations['generateIntelligenceReport'];
      if (!generateIntelligenceReport) throw new Error('generateIntelligenceReport mutation not available');
      const { data, errors } = await generateIntelligenceReport({ candidateId: id });
      if (errors) throw new Error(errors[0]?.message ?? 'Unknown error');
      setAiBlocks(JSON.parse(data as string));
    } catch (err) {
      console.error("[CandidateProfilePage] AI Error:", err);
    } finally { setIsAiGenerating(false); }
  };

  useEffect(() => {
    if (selectedTab === "INTELLIGENCE" && aiBlocks.length === 0 && !isAiGenerating) {
      generateReport();
    }
  }, [selectedTab]);

  const handleScoreChange = (submissionId: string, score: number) => {
    setAssessments((prev) => prev.map((a) => (a.id === submissionId ? { ...a, score } : a)));
    dataFactory.createClient().models.ChallengeSubmission.update({ id: submissionId, score } as any).catch(
      (err: unknown) => console.error('[CandidateProfilePage] Score update failed:', err)
    );
  };
  const handleFeedbackChange = (submissionId: string, feedback: string) => {
    setAssessments((prev) => prev.map((a) => (a.id === submissionId ? { ...a, feedback } : a)));
    dataFactory.createClient().models.ChallengeSubmission.update({ id: submissionId, feedback } as any).catch(
      (err: unknown) => console.error('[CandidateProfilePage] Feedback update failed:', err)
    );
  };
  const handleDownloadResume = async () => {
    if (!candidate?.resumeS3Key) return;
    try {
      const result = await storage.getUrl({ path: candidate.resumeS3Key, options: { expiresIn: 3600 } });
      window.open(result.url.toString(), "_blank");
    } catch (err) { console.error("[CandidateProfilePage] Failed to get resume URL:", err); }
  };

  const handleSendInvite = async () => {
    if (!id || !candidate || !inviteUrl) return;
    const liveStage = stages.find((s) => s.mode === "LIVE_VIDEO");
    if (!liveStage) return;
    const client = dataFactory.createClient();
    setInviteSaving(true);
    try {
      const provider = resolveSchedulingProvider(inviteUrl, ALL_PROVIDERS);
      const { data, errors } = await client.models.ScheduledInterview.create({
        candidateId: id, pipelineId: candidate.pipelineId, stageId: liveStage.id,
        status: "INVITED", schedulingUrl: inviteUrl, schedulingProvider: provider.type,
      });
      if (errors) throw new Error(errors[0]?.message ?? "Unknown error");
      setScheduledInterview(data as unknown as ScheduledInterviewRow);
    } catch (err) { console.error("[CandidateProfilePage] Failed to send invite:", err);
    } finally { setInviteSaving(false); }
  };

  if (isLoading && !candidate) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 0, minHeight: 'calc(100vh - 100px)', margin: '-24px -20px' }}>
        <div style={{ padding: 40 }}><div style={{ height: 400, background: 'rgba(255,255,255,0.02)', borderRadius: 16 }} /></div>
        <div style={{ background: 'rgba(255,255,255,0.02)', borderLeft: '1px solid rgba(255,255,255,0.08)' }} />
      </div>
    );
  }

  if (error || !candidate) return <div style={{ padding: 40, color: '#f87171' }}>{error?.message || 'Candidate not found.'}</div>;

  const stageStats = stages.map((stage) => {
    const challengeIds = (stage.challenges ?? []).map((c) => c.id);
    const stageAssessments = assessments.filter((a) => a.challengeId !== null && challengeIds.includes(a.challengeId ?? ""));
    const score = stageAssessments.length > 0 ? Math.round(stageAssessments.reduce((sum, a) => sum + (a.score ?? 0), 0) / stageAssessments.length) : null;
    return { id: stage.id, title: stage.title, score, isComplete: stageAssessments.length > 0 && stageAssessments.length === challengeIds.length };
  });

  const avgScore = stageStats.filter(s => s.score !== null).length > 0 ? Math.round(stageStats.filter(s => s.score !== null).reduce((sum, s) => sum + (s.score ?? 0), 0) / stageStats.filter(s => s.score !== null).length) : null;
  const signal = calculateSignal(avgScore);
  const signalColors = getSignalColors(signal);
  const candidateLabel = candidate.name && candidate.name !== candidate.email ? candidate.name : (candidate.email ?? "Candidate");
  const initials = candidateLabel.split(/[\s@]+/).map((w: string) => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
  const invitedDate = candidate.createdAt ? new Date(candidate.createdAt) : null;
  const completedDate = candidate.updatedAt && candidate.status === "COMPLETED" ? new Date(candidate.updatedAt) : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 0, minHeight: 'calc(100vh - 100px)', margin: '-24px -20px -24px 0', alignItems: "stretch" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 32, padding: '40px 60px', minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          <button onClick={() => setSelectedTab("OVERVIEW")} style={{ padding: "12px 24px", borderRadius: 8, cursor: "pointer", background: selectedTab === "OVERVIEW" ? 'rgba(255,255,255,0.1)' : 'transparent', border: selectedTab === "OVERVIEW" ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: selectedTab === "OVERVIEW" ? '#fff' : 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>OVERVIEW</span>
          </button>
          {FEATURES.INTELLIGENCE_REPORT && (
            <button onClick={() => setSelectedTab("INTELLIGENCE")} style={{ padding: "12px 24px", borderRadius: 8, cursor: "pointer", background: selectedTab === "INTELLIGENCE" ? 'rgba(167,139,250,0.1)' : 'transparent', border: selectedTab === "INTELLIGENCE" ? '1px solid rgba(167,139,250,0.3)' : '1px solid transparent', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Brain size={14} color={selectedTab === "INTELLIGENCE" ? "#a78bfa" : "rgba(255,255,255,0.3)"} />
              <span style={{ fontSize: 11, fontWeight: 800, color: selectedTab === "INTELLIGENCE" ? '#a78bfa' : 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>INTELLIGENCE</span>
            </button>
          )}
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />
          {stageStats.map((stat) => (
            <button key={stat.id} onClick={() => setSelectedTab(stat.id)} style={{ padding: "12px 24px", borderRadius: 8, cursor: "pointer", background: selectedTab === stat.id ? 'rgba(255,255,255,0.1)' : 'transparent', border: selectedTab === stat.id ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: selectedTab === stat.id ? '#fff' : 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>{stat.title?.toUpperCase() || 'STAGE'}</span>
              {stat.score !== null && <span style={{ fontSize: 10, fontWeight: 900, color: selectedTab === stat.id ? '#fff' : 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>{stat.score}</span>}
              {stat.isComplete && <CheckCircle size={12} color="#4ade80" />}
            </button>
          ))}
        </div>

        {selectedTab === "OVERVIEW" && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
               <SubTitle>CANDIDATE_JOURNEY_MAP</SubTitle>
               <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {stageStats.map(s => (
                    <div key={s.id} onClick={() => setSelectedTab(s.id)} style={{ padding: '16px 20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                       <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {s.isComplete ? <CheckCircle size={14} color="#4ade80" /> : <Clock size={14} color="rgba(255,255,255,0.2)" />}
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{s.title}</span>
                       </div>
                       <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          {s.score !== null && <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>{s.score}</div>}
                          <ChevronRight size={14} color="rgba(255,255,255,0.2)" />
                       </div>
                    </div>
                  ))}
               </div>
            </LiquidMetalCard>
          </div>
        )}

        {selectedTab === "INTELLIGENCE" && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {isAiGenerating ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                 <div style={{ fontSize: 11, color: '#a78bfa', fontFamily: 'Space Mono', letterSpacing: '0.2em', marginBottom: 16 }}>SYNTHESIZING_INTELLIGENCE...</div>
                 <div style={{ width: 200, height: 2, background: 'rgba(167,139,250,0.1)', margin: '0 auto', overflow: 'hidden' }}><div style={{ width: '40%', height: '100%', background: '#a78bfa', animation: 'slide 1.5s infinite ease-in-out' }} /></div>
                 <style>{`@keyframes slide { from { transform: translateX(-150%); } to { transform: translateX(250%); } }`}</style>
              </div>
            ) : <IntelligenceReportRenderer blocks={aiBlocks} />}
          </div>
        )}

        {selectedTab !== "OVERVIEW" && selectedTab !== "INTELLIGENCE" && (() => {
          const activeStage = stages.find(s => s.id === selectedTab);
          if (!activeStage) return null;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {activeStage.mode === 'LIVE_VIDEO' && (
                <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16, border: '1px solid rgba(96,165,250,0.2)' }}>
                   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Calendar size={18} color="#60a5fa" /><SubTitle>LIVE_INTERVIEW_SESSION</SubTitle></div>
                      {scheduledInterview && <InterviewStatusBadge status={(scheduledInterview.status ?? "INVITED") as InterviewStatus} />}
                   </div>
                   {scheduledInterview ? (
                     <div style={{ display: 'flex', gap: 40 }}>
                        {scheduledInterview.scheduledAt && <div><div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono', marginBottom: 4 }}>SCHEDULED_FOR</div><div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{new Date(scheduledInterview.scheduledAt).toLocaleString()}</div></div>}
                        {scheduledInterview.meetingUrl && <a href={scheduledInterview.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#60a5fa', color: '#000', padding: '12px 20px', borderRadius: 8, fontSize: 11, fontWeight: 800, textDecoration: 'none', fontFamily: 'Space Mono' }}>JOIN_MEETING <ExternalLink size={14} /></a>}
                     </div>
                   ) : (
                     <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}><div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono', marginBottom: 8 }}>SCHEDULING_LINK</div><input value={inviteUrl} onChange={e => setInviteUrl(e.target.value)} placeholder="Enter Calendly/Cal.com URL" style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 13 }} /></div>
                        <button onClick={handleSendInvite} disabled={inviteSaving || !inviteUrl} style={{ padding: '12px 24px', background: '#fff', color: '#000', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 800, fontFamily: 'Space Mono', cursor: 'pointer' }}>{inviteSaving ? 'SENDING...' : 'SEND_INVITE'}</button>
                     </div>
                   )}
                </LiquidMetalCard>
              )}
              {(activeStage.challenges ?? []).map(challenge => <ChallengeCard key={challenge.id} challenge={challenge} assessment={assessments.find(a => a.challengeId === challenge.id)} onScoreChange={handleScoreChange} onFeedbackChange={handleFeedbackChange} />)}
            </div>
          );
        })()}
      </div>

      <aside style={{ position: "sticky", top: 0, height: "100vh" }}>
        <LiquidMetalCard variant="chrome" style={{ padding: '40px 32px', borderRadius: '32px 0 0 0', height: '100%', borderLeft: '1px solid rgba(255,255,255,0.1)', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ textAlign: "center", marginBottom: 40, paddingBottom: 40, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: signalColors.bg, border: `2px solid ${signalColors.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 900, color: signalColors.text, fontFamily: '"Space Mono", monospace', margin: '0 auto 20px', boxShadow: `0 0 30px ${signalColors.border}22` }}>{initials}</div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>{candidateLabel}</h2>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}><Mail size={12} /> {candidate.email}</div>
            <div style={{ marginTop: 32, padding: 24, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
               <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono', marginBottom: 16 }}>OVERALL_SIGNAL</div>
               <div style={{ fontSize: 56, fontWeight: 900, color: signalColors.text, lineHeight: 1, letterSpacing: '-0.04em' }}>{avgScore ?? '—'}</div>
               <div style={{ marginTop: 16 }}><SignalBadge signal={signal} /></div>
            </div>
          </div>

          <div style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}><Briefcase size={14} color="rgba(255,255,255,0.4)" /><SubTitle>PROFESSIONAL_BACKGROUND</SubTitle></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
               <div><div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{candidate.currentRole || '—'}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono', marginTop: 4 }}>{candidate.yearsOfExperience || 0} YEARS_EXPERIENCE</div></div>
               {candidate.skills && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{candidate.skills.slice(0, 8).map(skill => <span key={skill} style={{ padding: "4px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: '"Space Mono", monospace' }}>{skill?.toUpperCase()}</span>)}</div>}
            </div>
          </div>

          <div style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}><Clock size={14} color="rgba(255,255,255,0.4)" /><SubTitle>TIMELINE</SubTitle></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
               {[{ label: 'INVITED', value: invitedDate?.toLocaleDateString() }, { label: 'SUBMITTED', value: completedDate?.toLocaleDateString() || 'PENDING' }].map(item => (
                 <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}><span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono' }}>{item.label}</span><span style={{ fontSize: 11, color: '#fff', fontFamily: 'Space Mono', fontWeight: 700 }}>{item.value}</span></div>
               ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={handleDownloadResume} disabled={!candidate.resumeS3Key} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 11, fontWeight: 800, fontFamily: 'Space Mono', cursor: 'pointer' }}><FileDown size={14} /> VIEW_RESUME</button>
            <button onClick={() => setSelectedTab("INTELLIGENCE")} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px', background: '#fff', color: '#000', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 800, fontFamily: 'Space Mono', cursor: 'pointer' }}>GENERATE_REPORT</button>
          </div>
        </LiquidMetalCard>
      </aside>
    </div>
  );
}
