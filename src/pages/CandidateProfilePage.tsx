/**
 * CandidateProfilePage — Recruiter view of a single candidate's assessment results.
 *
 * Migrated from Amplify to Cloudflare Workers API.
 * Data is loaded via GET /api/v1/candidates/:id which returns the candidate
 * record with all stages, challenges, and submissions in one round-trip.
 */

import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/react";
import {
  Calendar,
  FileDown,
  CheckCircle,
  Briefcase,
  Mail,
  Clock,
  Brain,
  GraduationCap,
  Send,
  Phone,
  PhoneCall,
  Play,
  Edit3,
  Check,
  X as XIcon,
} from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { PhoneCallDrawer } from "../components/Phone/PhoneCallDrawer";
import { calculateSignal } from "../lib/utils";
import {
  IntelligenceReportRenderer,
  IntelligenceBlockConfig,
} from "../components/Analytics/IntelligenceReportBlock";
import { useCandidateProfile } from "../hooks/useCandidateProfile";
import { useApiClient } from "../hooks/useApiClient";
import type { ProfileChallenge } from "../lib/api/types";

// ============================================================================
// Local types
// ============================================================================

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

// ============================================================================
// Signal colour helpers
// ============================================================================

const SIGNAL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
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

function getSignalColors(signal: string): { text: string; bg: string; border: string } {
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
  CODE_IMPLEMENTATION: "var(--pipe-accent)",
  QUIZ_MCQ: "#4ade80",
  QUIZ_SHORT_ANSWER: "#fbbf24",
  AGENT_INTERVIEW: "#06b6d4",
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
  followUpQuestionsJson?: string | Record<string, unknown> | unknown[] | null;
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
        borderTop: "1px solid var(--pipe-border)",
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
                  color: "var(--pipe-text-muted)",
                  marginBottom: 8,
                  lineHeight: 1.5,
                }}
              >
                <span
                  style={{
                    color: "var(--pipe-text-dim)",
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
                    background: "var(--pipe-surface)",
                    borderLeft: "2px solid rgba(255,255,255,0.1)",
                    fontSize: 13,
                    color: "var(--pipe-text, #fff)",
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
                    color: "var(--pipe-text-dim)",
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
  challenge: ProfileChallenge;
  submission: Record<string, unknown> | null;
}): JSX.Element {
  const config = challenge.config ?? {};
  const options = Array.isArray(config.options)
    ? (config.options as Array<{ id: string; text?: string; label?: string }>)
    : [];
  const answers = submission?.answers as Record<string, string> | undefined;
  const selectedId =
    answers?.["current"] ?? (submission?.selectedOptionId as string | undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          fontSize: 14,
          color: "var(--pipe-text, #fff)",
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
                  color: isSelected ? "var(--pipe-text, #fff)" : "var(--pipe-text-muted)",
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

/**
 * ChallengeCard — displays one challenge with its submission and recruiter
 * review panel. Score / feedback changes are propagated via callbacks (no
 * Amplify dependency).
 */
function ChallengeCard({
  challenge,
  onScoreChange,
  onFeedbackChange,
}: {
  challenge: ProfileChallenge;
  onScoreChange: (submissionId: string, score: number) => void;
  onFeedbackChange: (submissionId: string, feedback: string) => void;
}): JSX.Element {
  const sub = challenge.submission;
  const isManual =
    challenge.type === "QUIZ_SHORT_ANSWER" || challenge.type === "CODE_IMPLEMENTATION";
  const response = sub?.response ?? null;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 0, borderRadius: 16 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "24px 32px",
          borderBottom: "1px solid var(--pipe-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {challenge.type && <TypeBadge type={challenge.type} />}
          <h4 style={{ fontSize: 16, fontWeight: 800, color: "var(--pipe-text, #fff)", margin: 0 }}>
            {challenge.title ?? "Untitled Challenge"}
          </h4>
        </div>
        {sub && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                color: "var(--pipe-text-dim)",
                fontFamily: '"Space Mono", monospace',
              }}
            >
              SCORE
            </div>
            <div
              style={{ fontSize: 24, fontWeight: 900, color: "var(--pipe-text, #fff)", lineHeight: 1 }}
            >
              {sub.score}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "32px" }}>
        {!sub && (
          <div
            style={{
              padding: 40,
              border: "1px dashed var(--pipe-border)",
              borderRadius: 8,
              textAlign: "center",
              color: "var(--pipe-text-dim)",
              fontSize: 11,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: "0.1em",
            }}
          >
            NO_SUBMISSION_YET
          </div>
        )}

        {sub && response && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isManual ? "1fr 320px" : "1fr",
              gap: 40,
            }}
          >
            {/* Submission content */}
            <div style={{ minWidth: 0 }}>
              {challenge.type === "CODE_REVIEW" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {(Boolean(response.verdict) || Boolean(response.summary)) && (
                    <div
                      style={{
                        background: "var(--pipe-surface)",
                        padding: 24,
                        borderRadius: 8,
                        border: "1px solid var(--pipe-border-light)",
                      }}
                    >
                      {Boolean(response.verdict) && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            marginBottom: 12,
                          }}
                        >
                          <SubTitle>VERDICT</SubTitle>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              color: "var(--pipe-text, #fff)",
                              textTransform: "uppercase",
                              fontFamily: '"Space Mono", monospace',
                              letterSpacing: "0.05em",
                            }}
                          >
                            {String(response.verdict)}
                          </span>
                        </div>
                      )}
                      {Boolean(response.summary) && (
                        <div
                          style={{
                            fontSize: 14,
                            color: "var(--pipe-text-muted)",
                            lineHeight: 1.6,
                          }}
                        >
                          {String(response.summary)}
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <div style={{ marginBottom: 16 }}>
                      <SubTitle>CANDIDATE_ANNOTATIONS</SubTitle>
                    </div>
                    {Array.isArray(response.annotations) &&
                    (response.annotations as unknown[]).length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {(
                          response.annotations as Array<Record<string, unknown>>
                        ).map((ann, idx) => {
                          const sev = (ann.severity as string) ?? "minor";
                          const borderColor =
                            sev === "critical"
                              ? "#ef4444"
                              : sev === "major"
                                ? "#f59e0b"
                                : "#60a5fa";
                          return (
                            <div
                              key={idx}
                              style={{
                                padding: "16px 20px",
                                background: "var(--pipe-surface)",
                                borderLeft: `3px solid ${borderColor}`,
                                borderRadius: "0 4px 4px 0",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: 12,
                                  alignItems: "center",
                                  marginBottom: 8,
                                }}
                              >
                                {Boolean(ann.file) && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "var(--pipe-text-dim)",
                                      fontFamily: '"Space Mono", monospace',
                                    }}
                                  >
                                    {String(ann.file).split("/").pop() ?? ""}:
                                    {String(ann.line ?? "")}
                                  </span>
                                )}
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 800,
                                    color: borderColor,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.1em",
                                    fontFamily: '"Space Mono", monospace',
                                  }}
                                >
                                  {sev}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: 13,
                                  color: "var(--pipe-text, #fff)",
                                  lineHeight: 1.6,
                                }}
                              >
                                {String(ann.comment ?? "")}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--pipe-text-dim)",
                          fontStyle: "italic",
                          fontFamily: '"Space Mono", monospace',
                        }}
                      >
                        No annotations provided.
                      </div>
                    )}
                  </div>
                  <FollowUpReadOnly
                    followUpQuestionsJson={
                      response.followUpQuestionsJson as
                        | string
                        | Record<string, unknown>
                        | null
                    }
                  />
                </div>
              )}

              {challenge.type === "QUIZ_MCQ" && (
                <QuizMcqView challenge={challenge} submission={response} />
              )}

              {challenge.type === "QUIZ_SHORT_ANSWER" &&
                (() => {
                  const inputMode =
                    (response.inputMode as string | undefined) ?? "text";
                  if (inputMode === "video")
                    return (
                      <div
                        style={{ display: "flex", flexDirection: "column", gap: 12 }}
                      >
                        <SubTitle>CANDIDATE_VIDEO_RESPONSE</SubTitle>
                        <div
                          style={{
                            padding: 40,
                            textAlign: "center",
                            background: "rgba(0,0,0,0.2)",
                            borderRadius: 12,
                            border: "1px dashed var(--pipe-border-light)",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: '"Space Mono", monospace',
                              fontSize: 10,
                              color: "var(--pipe-text-dim)",
                            }}
                          >
                            VIDEO_SUBMISSION
                          </span>
                        </div>
                      </div>
                    );
                  if (inputMode === "voice")
                    return (
                      <div
                        style={{ display: "flex", flexDirection: "column", gap: 12 }}
                      >
                        <SubTitle>VOICE_TRANSCRIPT</SubTitle>
                        <div
                          style={{
                            fontSize: 15,
                            color: "var(--pipe-text, #fff)",
                            lineHeight: 1.7,
                            whiteSpace: "pre-wrap",
                            background: "rgba(0,0,0,0.2)",
                            padding: 24,
                            borderRadius: 8,
                            border: "1px solid var(--pipe-border-light)",
                          }}
                        >
                          {(response.text as string) || (
                            <span
                              style={{
                                color: "var(--pipe-text-dim)",
                                fontStyle: "italic",
                              }}
                            >
                              No transcript captured.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  return (
                    <div
                      style={{
                        fontSize: 15,
                        color: "var(--pipe-text, #fff)",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        background: "rgba(0,0,0,0.2)",
                        padding: 24,
                        borderRadius: 8,
                        border: "1px solid var(--pipe-border-light)",
                      }}
                    >
                      {(response.text as string) || (
                        <span
                          style={{
                            color: "var(--pipe-text-dim)",
                            fontStyle: "italic",
                          }}
                        >
                          No answer provided.
                        </span>
                      )}
                    </div>
                  );
                })()}

              {challenge.type === "CODE_IMPLEMENTATION" && (
                <div
                  style={{
                    background: "#000",
                    padding: 24,
                    borderRadius: 8,
                    border: "1px solid var(--pipe-border)",
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: "var(--pipe-accent)",
                      fontFamily: '"Space Mono", monospace',
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {(response.code as string) || "// No code submitted"}
                  </pre>
                </div>
              )}
            </div>

            {/* Recruiter review panel */}
            {isManual && sub && (
              <div
                style={{
                  borderLeft: "1px solid rgba(255,255,255,0.05)",
                  paddingLeft: 40,
                }}
              >
                <div style={{ marginBottom: 24 }}>
                  <SubTitle>RECRUITER_REVIEW</SubTitle>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 9,
                          color: "var(--pipe-text-dim)",
                          fontFamily: '"Space Mono", monospace',
                          letterSpacing: "0.1em",
                        }}
                      >
                        SCORE
                      </label>
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 900,
                          color: "var(--pipe-text, #fff)",
                          fontFamily: '"Space Mono", monospace',
                        }}
                      >
                        {sub.score ?? 0}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sub.score ?? 0}
                      onChange={(e) => {
                        onScoreChange(sub.id, parseInt(e.target.value, 10));
                      }}
                      style={{
                        width: "100%",
                        cursor: "pointer",
                        accentColor: "var(--pipe-accent)",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: 9,
                        color: "var(--pipe-text-dim)",
                        marginBottom: 12,
                        fontFamily: '"Space Mono", monospace',
                        letterSpacing: "0.1em",
                      }}
                    >
                      FEEDBACK
                    </label>
                    <textarea
                      value={sub.feedback ?? ""}
                      onChange={(e) => {
                        onFeedbackChange(sub.id, e.target.value);
                      }}
                      placeholder="Add internal notes..."
                      style={{
                        width: "100%",
                        height: 200,
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid var(--pipe-border)",
                        padding: 16,
                        color: "var(--pipe-text, #fff)",
                        fontSize: 13,
                        fontFamily: "inherit",
                        outline: "none",
                        resize: "none",
                        borderRadius: 8,
                        boxSizing: "border-box",
                        lineHeight: 1.6,
                      }}
                    />
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

// ============================================================================
// Main page
// ============================================================================

export default function CandidateProfilePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useClerkAuth();
  const api = useApiClient();
  const { candidate, stages, phoneCalls, isLoading, error, refetch, updateSubmissionScore, updateSubmissionFeedback } =
    useCandidateProfile(id);

  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [showPhoneDrawer, setShowPhoneDrawer] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [resendingInvite, setResendingInvite] = useState(false);
  const [resendResult, setResendResult] = useState<'sent' | 'error' | null>(null);
  const [assessLink, setAssessLink] = useState<string | null>(null);

  const handleResendInvite = useCallback(async (): Promise<void> => {
    if (!id) return;
    setResendingInvite(true);
    setResendResult(null);
    try {
      await api.post(`/api/v1/candidates/${id}/send-invite`, {});
      setResendResult('sent');
      setTimeout(() => setResendResult(null), 3000);
    } catch (err) {
      console.error('[CandidateProfilePage] Resend invite failed:', err);
      setResendResult('error');
    } finally {
      setResendingInvite(false);
    }
  }, [id, api]);

  const handleSavePhone = useCallback(async (): Promise<void> => {
    if (!id) return;
    const trimmed = phoneInput.trim();
    try {
      await api.patch(`/api/v1/candidates/${id}`, {
        phoneNumber: trimmed || null,
      });
      setEditingPhone(false);
      void refetch();
    } catch (err) {
      console.error('[CandidateProfilePage] Save phone failed:', err);
    }
  }, [id, phoneInput, api, refetch]);

  const handleViewResume = useCallback(async (): Promise<void> => {
    if (!id) return;
    try {
      const token = await getToken();
      const baseUrl =
        typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
          ? import.meta.env.VITE_API_URL
          : "http://localhost:8787";

      const response = await fetch(`${baseUrl}/api/v1/candidates/${id}/resume`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        console.error("[CandidateProfilePage] Resume fetch failed:", response.status);
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const win = window.open(objectUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      if (!win) {
        console.warn("[CandidateProfilePage] Popup blocked — falling back to download.");
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = "resume";
        anchor.click();
      }
    } catch (err) {
      console.error("[CandidateProfilePage] Error opening resume:", err);
    }
  }, [id, getToken]);

  const [aiBlocks] = useState<IntelligenceBlockConfig[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  // Auto-select first stage on load
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  useEffect(() => {
    const firstStage = stages[0];
    if (!hasAutoSelected && firstStage !== undefined) {
      setSelectedTab(firstStage.id);
      setHasAutoSelected(true);
    }
  }, [stages, hasAutoSelected]);

  // Compute per-stage stats
  const stageStats = stages.map((stage) => {
    const scoredChallenges = stage.challenges.filter(
      (ch) => ch.submission?.score != null,
    );
    const score =
      scoredChallenges.length > 0
        ? Math.round(
            scoredChallenges.reduce(
              (sum, ch) => sum + (ch.submission?.score ?? 0),
              0,
            ) / scoredChallenges.length,
          )
        : null;
    const isComplete =
      stage.challenges.length > 0 &&
      stage.challenges.every((ch) => ch.submission !== null);
    return { id: stage.id, title: stage.title, score, isComplete };
  });

  const pipelineComplete =
    stageStats.length > 0 && stageStats.every((s) => s.isComplete);

  const avgScore =
    stageStats.filter((s) => s.score !== null).length > 0
      ? Math.round(
          stageStats
            .filter((s) => s.score !== null)
            .reduce((sum, s) => sum + (s.score ?? 0), 0) /
            stageStats.filter((s) => s.score !== null).length,
        )
      : null;

  const signal = calculateSignal(avgScore);
  const signalColors = getSignalColors(signal);

  useEffect(() => {
    if (selectedTab === "INTELLIGENCE" && aiBlocks.length === 0 && !isAiGenerating) {
      setIsAiGenerating(true);
      setTimeout(() => setIsAiGenerating(false), 1000);
    }
  }, [selectedTab, aiBlocks.length, isAiGenerating]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (isLoading && !candidate) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 0,
          height: "calc(100vh - 100px)",
          margin: "-24px -20px",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 40 }}>
          <div
            style={{
              height: 400,
              background: "var(--pipe-surface)",
              borderRadius: 16,
            }}
          />
        </div>
        <div
          style={{
            background: "var(--pipe-surface)",
            borderLeft: "1px solid var(--pipe-border)",
          }}
        />
      </div>
    );
  }

  // ── Error / not found ───────────────────────────────────────────────────────
  if (error || !candidate) {
    return (
      <div
        data-testid="candidate-not-found"
        style={{ padding: 40, color: "#f87171" }}
      >
        {error?.message ?? "Candidate not found."}
      </div>
    );
  }

  const candidateLabel =
    candidate.name && candidate.name !== candidate.email
      ? candidate.name
      : (candidate.email ?? "Candidate");
  const initials = candidateLabel
    .split(/[\s@]+/)
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
  const invitedDate = candidate.createdAt ? new Date(candidate.createdAt) : null;
  const completedDate =
    candidate.updatedAt && candidate.status === "COMPLETED"
      ? new Date(candidate.updatedAt)
      : null;
  const hasParsedProfile = !!(candidate.currentRole || candidate.skills?.length || candidate.yearsOfExperience);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 340px",
        gap: 0,
        height: "calc(100vh - 100px)",
        margin: "-24px 0 -24px 0",
        alignItems: "stretch",
        overflow: "hidden",
      }}
    >
      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          padding: "32px 48px",
          minWidth: 0,
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.15em",
              color: "var(--pipe-text-dim)",
              fontFamily: '"Space Mono", monospace',
              marginBottom: 8,
            }}
          >
            CANDIDATE_PROFILE / {candidate.status}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: signalColors.bg,
                border: `2px solid ${signalColors.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                fontWeight: 900,
                color: signalColors.text,
                fontFamily: '"Space Mono", monospace',
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div>
              <h1
                style={{
                  fontSize: 24,
                  fontWeight: 900,
                  color: "var(--pipe-text, #fff)",
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {candidateLabel}
              </h1>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 4,
                  fontSize: 12,
                  color: "var(--pipe-text-dim)",
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                <Mail size={11} /> {candidate.email}
                {candidate.currentRole && (
                  <>
                    <span style={{ color: "var(--pipe-text-dim)" }}>·</span>
                    <Briefcase size={11} /> {candidate.currentRole}
                  </>
                )}
                <span style={{ color: "var(--pipe-text-dim)" }}>·</span>
                {editingPhone ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Phone size={11} />
                    <input
                      autoFocus
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSavePhone();
                        if (e.key === 'Escape') setEditingPhone(false);
                      }}
                      placeholder="+1234567890"
                      style={{
                        width: 120,
                        padding: "2px 4px",
                        fontSize: 11,
                        fontFamily: '"Space Mono", monospace',
                        background: "transparent",
                        border: "1px solid var(--pipe-border)",
                        borderRadius: 3,
                        color: "var(--pipe-text)",
                        outline: "none",
                      }}
                    />
                    <button onClick={() => void handleSavePhone()} style={{ background: "none", border: "none", color: "#4ade80", cursor: "pointer", padding: 2 }}>
                      <Check size={11} />
                    </button>
                    <button onClick={() => setEditingPhone(false)} style={{ background: "none", border: "none", color: "var(--pipe-text-dim)", cursor: "pointer", padding: 2 }}>
                      <XIcon size={11} />
                    </button>
                  </span>
                ) : (
                  <span
                    onClick={() => { setPhoneInput(candidate.phoneNumber ?? ''); setEditingPhone(true); }}
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                    title="Click to edit phone number"
                  >
                    <Phone size={11} />
                    {candidate.phoneNumber ? (
                      <>{candidate.phoneNumber}</>
                    ) : (
                      <span style={{ opacity: 0.4, fontStyle: "italic" }}>add phone</span>
                    )}
                    <Edit3 size={9} style={{ opacity: 0.4 }} />
                  </span>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Stage tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 24,
            borderBottom: "1px solid var(--pipe-border)",
            paddingBottom: 0,
          }}
        >
          {stageStats.map((stat) => {
            const isActive = selectedTab === stat.id;
            return (
              <button
                key={stat.id}
                onClick={() => setSelectedTab(stat.id)}
                style={{
                  padding: "10px 20px",
                  cursor: "pointer",
                  background: "transparent",
                  border: "none",
                  borderBottom: isActive
                    ? "2px solid #fff"
                    : "2px solid transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: -1,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: isActive ? "var(--pipe-text, #fff)" : "rgba(255,255,255,0.35)",
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: "0.05em",
                  }}
                >
                  {stat.title?.toUpperCase() ?? "STAGE"}
                </span>
                {stat.score !== null && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 900,
                      color: isActive ? "var(--pipe-text, #fff)" : "rgba(255,255,255,0.25)",
                      background: isActive
                        ? "rgba(255,255,255,0.1)"
                        : "rgba(255,255,255,0.04)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {stat.score}
                  </span>
                )}
                {stat.isComplete && <CheckCircle size={11} color="#4ade80" />}
              </button>
            );
          })}

          <div
            style={{
              width: 1,
              height: 20,
              background: "var(--pipe-surface-hover)",
              alignSelf: "center",
              margin: "0 8px",
            }}
          />
          <button
            disabled={!pipelineComplete}
            onClick={() => pipelineComplete && setSelectedTab("INTELLIGENCE")}
            title={pipelineComplete ? undefined : "Complete all stages to unlock"}
            style={{
              padding: "10px 20px",
              cursor: pipelineComplete ? "pointer" : "default",
              background: "transparent",
              border: "none",
              borderBottom:
                selectedTab === "INTELLIGENCE"
                  ? "2px solid var(--pipe-accent)"
                  : "2px solid transparent",
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: -1,
              opacity: pipelineComplete ? 1 : 0.3,
            }}
          >
            <Brain
              size={12}
              color={
                selectedTab === "INTELLIGENCE"
                  ? "var(--pipe-accent)"
                  : "rgba(255,255,255,0.25)"
              }
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color:
                  selectedTab === "INTELLIGENCE"
                    ? "var(--pipe-accent)"
                    : "rgba(255,255,255,0.35)",
                fontFamily: '"Space Mono", monospace',
                letterSpacing: "0.05em",
              }}
            >
              INTELLIGENCE
            </span>
          </button>
        </div>

        {/* INTELLIGENCE tab */}
        {selectedTab === "INTELLIGENCE" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {isAiGenerating ? (
              <div style={{ padding: 60, textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--pipe-accent)",
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: "0.2em",
                    marginBottom: 16,
                  }}
                >
                  SYNTHESIZING_INTELLIGENCE...
                </div>
                <div
                  style={{
                    width: 200,
                    height: 2,
                    background: "rgba(167,139,250,0.1)",
                    margin: "0 auto",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "40%",
                      height: "100%",
                      background: "var(--pipe-accent)",
                      animation: "slide 1.5s infinite ease-in-out",
                    }}
                  />
                </div>
                <style>{`@keyframes slide { from { transform: translateX(-150%); } to { transform: translateX(250%); } }`}</style>
              </div>
            ) : (
              <IntelligenceReportRenderer blocks={aiBlocks} />
            )}
          </div>
        )}

        {/* Stage content */}
        {selectedTab !== "INTELLIGENCE" &&
          (() => {
            const activeStage = stages.find((s) => s.id === selectedTab);
            if (!activeStage) return null;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {activeStage.mode === "LIVE_VIDEO" && (
                  <LiquidMetalCard
                    variant="default"
                    style={{
                      padding: 32,
                      borderRadius: 16,
                      border: "1px solid rgba(96,165,250,0.2)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 24,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Calendar size={18} color="#60a5fa" />
                        <SubTitle>LIVE_INTERVIEW_SESSION</SubTitle>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => {
                            // Reset the interview back to INVITED and resend booking link
                            const interviewId = activeStage.scheduledInterview?.id;
                            if (interviewId) {
                              void api.patch(`/api/v1/scheduling/interviews/${interviewId}`, {
                                status: 'INVITED',
                                scheduledAt: null,
                                meetingUrl: null,
                              }).then(() => void handleResendInvite());
                            } else {
                              void handleResendInvite();
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 14px',
                            background: 'rgba(251,191,36,0.1)',
                            border: '1px solid rgba(251,191,36,0.25)',
                            borderRadius: 4,
                            color: '#fbbf24',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            fontFamily: '"Space Mono", monospace',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                        >
                          <Calendar size={10} />
                          RESCHEDULE
                        </button>
                        <button
                          onClick={() => {
                            // Reset invite token, show new link, and resend email
                            void api.post<{ inviteToken: string }>(`/api/v1/candidates/${id}/refresh-link`, {})
                              .then((res) => {
                                const baseUrl = window.location.origin;
                                setAssessLink(`${baseUrl}/assess/${res.inviteToken}`);
                                void handleResendInvite();
                              });
                          }}
                          disabled={resendingInvite}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 14px',
                            background: resendResult === 'sent'
                              ? 'rgba(74,222,128,0.1)'
                              : resendResult === 'error'
                                ? 'rgba(248,113,113,0.1)'
                                : 'rgba(96,165,250,0.1)',
                            border: resendResult === 'sent'
                              ? '1px solid rgba(74,222,128,0.25)'
                              : resendResult === 'error'
                                ? '1px solid rgba(248,113,113,0.25)'
                                : '1px solid rgba(96,165,250,0.25)',
                            borderRadius: 4,
                            color: resendResult === 'sent'
                              ? '#4ade80'
                              : resendResult === 'error'
                                ? '#f87171'
                                : '#60a5fa',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            fontFamily: '"Space Mono", monospace',
                            cursor: resendingInvite ? 'wait' : 'pointer',
                            opacity: resendingInvite ? 0.5 : 1,
                            transition: 'all 0.2s',
                          }}
                        >
                          <Send size={10} />
                          {resendingInvite ? 'SENDING...' : resendResult === 'sent' ? 'SENT' : resendResult === 'error' ? 'FAILED' : 'SEND_LINK'}
                        </button>
                      </div>
                    </div>
                    {activeStage.scheduledInterview?.scheduledAt ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                            fontFamily: '"Space Mono", monospace',
                            padding: '3px 8px', borderRadius: 3,
                            background: 'rgba(74,222,128,0.1)', color: '#4ade80',
                          }}>
                            {activeStage.scheduledInterview.status}
                          </span>
                        </div>
                        <div style={{
                          fontSize: 14, fontWeight: 600,
                          color: 'var(--pipe-text, #fff)',
                          fontFamily: '"Space Mono", monospace',
                        }}>
                          {new Date(activeStage.scheduledInterview.scheduledAt).toLocaleString(undefined, {
                            weekday: 'long', month: 'long', day: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </div>
                        {activeStage.scheduledInterview.meetingUrl && (
                          <a
                            href={activeStage.scheduledInterview.meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '8px 16px', width: 'fit-content',
                              background: 'rgba(96,165,250,0.1)',
                              border: '1px solid rgba(96,165,250,0.25)',
                              borderRadius: 4,
                              color: '#60a5fa',
                              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                              fontFamily: '"Space Mono", monospace',
                              textDecoration: 'none',
                            }}
                          >
                            JOIN MEETING →
                          </a>
                        )}
                      </div>
                    ) : (
                      <div style={{
                        fontSize: 12,
                        color: "var(--pipe-text-dim)",
                        fontFamily: '"Space Mono", monospace',
                      }}>
                        {activeStage.scheduledInterview
                          ? 'Awaiting candidate booking.'
                          : 'No interview scheduled yet.'}
                      </div>
                    )}
                    {assessLink && (
                      <div style={{
                        marginTop: 16,
                        padding: '10px 14px',
                        background: 'rgba(96,165,250,0.06)',
                        border: '1px solid rgba(96,165,250,0.15)',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}>
                        <input
                          readOnly
                          value={assessLink}
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                          style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            color: '#60a5fa',
                            fontSize: 11,
                            fontFamily: '"Space Mono", monospace',
                            outline: 'none',
                          }}
                        />
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(assessLink);
                          }}
                          style={{
                            padding: '4px 10px',
                            background: 'rgba(96,165,250,0.1)',
                            border: '1px solid rgba(96,165,250,0.25)',
                            borderRadius: 3,
                            color: '#60a5fa',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            fontFamily: '"Space Mono", monospace',
                            cursor: 'pointer',
                          }}
                        >
                          COPY
                        </button>
                      </div>
                    )}
                  </LiquidMetalCard>
                )}
                {activeStage.challenges.map((challenge) => (
                  <ChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    onScoreChange={(submissionId, score) => {
                      void updateSubmissionScore(submissionId, score);
                    }}
                    onFeedbackChange={(submissionId, feedback) => {
                      void updateSubmissionFeedback(submissionId, feedback);
                    }}
                  />
                ))}
              </div>
            );
          })()}
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside style={{ overflowY: "auto", marginBottom: 24 }}>
        <LiquidMetalCard
          variant="chrome"
          style={{
            padding: "32px 24px 24px",
            height: "100%",
            borderLeft: "1px solid var(--pipe-border)",
            borderRadius: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Signal score */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.2em",
                color: "var(--pipe-text-dim)",
                fontFamily: '"Space Mono", monospace',
                marginBottom: 16,
              }}
            >
              OVERALL_SIGNAL
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 900,
                  color: signalColors.text,
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                }}
              >
                {avgScore ?? "—"}
              </div>
              <SignalBadge signal={signal} />
            </div>

            {/* Per-stage breakdown */}
            {stageStats.length > 0 && (
              <div
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: "1px solid var(--pipe-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {stageStats.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        color: "var(--pipe-text-dim)",
                        fontFamily: '"Space Mono", monospace',
                      }}
                    >
                      {s.title?.toUpperCase()}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {s.isComplete && <CheckCircle size={10} color="#4ade80" />}
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          color: s.score != null ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
                          fontFamily: '"Space Mono", monospace',
                        }}
                      >
                        {s.score ?? "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Background — only when parsed data exists */}
          {hasParsedProfile && (
            <div
              style={{
                marginBottom: 28,
                paddingTop: 24,
                borderTop: "1px solid var(--pipe-border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <Briefcase size={12} color="var(--pipe-text-dim)" />
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.2em",
                    color: "var(--pipe-text-dim)",
                    fontFamily: '"Space Mono", monospace',
                  }}
                >
                  BACKGROUND
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {candidate.currentRole && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--pipe-text, #fff)" }}>
                      {candidate.currentRole}
                    </div>
                    {candidate.yearsOfExperience != null && candidate.yearsOfExperience > 0 && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--pipe-text-dim)",
                          fontFamily: '"Space Mono", monospace',
                          marginTop: 4,
                        }}
                      >
                        {candidate.yearsOfExperience} YRS
                      </div>
                    )}
                  </div>
                )}

                {candidate.skills && candidate.skills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {candidate.skills.slice(0, 10).map((skill) => (
                      <span
                        key={skill}
                        style={{
                          padding: "3px 8px",
                          background: "rgba(96,165,250,0.06)",
                          border: "1px solid rgba(96,165,250,0.12)",
                          borderRadius: 4,
                          fontSize: 9,
                          fontWeight: 700,
                          color: "rgba(96,165,250,0.7)",
                          fontFamily: '"Space Mono", monospace',
                        }}
                      >
                        {skill.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}

                {candidate.education && candidate.education.length > 0 && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 2 }}>
                    <GraduationCap size={11} color="var(--pipe-text-dim)" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div style={{ fontSize: 10, color: "var(--pipe-text-dim)", lineHeight: 1.5 }}>
                      {candidate.education.join(" · ")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div
            style={{
              paddingTop: 24,
              borderTop: "1px solid var(--pipe-border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <Clock size={12} color="var(--pipe-text-dim)" />
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.2em",
                  color: "var(--pipe-text-dim)",
                  fontFamily: '"Space Mono", monospace',
                }}
              >
                TIMELINE
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "INVITED", value: invitedDate?.toLocaleDateString() },
                { label: "SUBMITTED", value: completedDate?.toLocaleDateString() ?? "PENDING" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 0",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--pipe-text-dim)",
                      fontFamily: '"Space Mono", monospace',
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--pipe-text, #fff)",
                      fontFamily: '"Space Mono", monospace',
                      fontWeight: 700,
                    }}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Call Log */}
          {phoneCalls.length > 0 && (
            <div style={{ paddingTop: 20, borderTop: "1px solid var(--pipe-border)", marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <PhoneCall size={12} color="var(--pipe-text-dim)" />
                <span style={{ fontSize: 9, letterSpacing: "0.2em", color: "var(--pipe-text-dim)", fontFamily: '"Space Mono", monospace' }}>
                  CALL_LOG
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {phoneCalls.map((call) => {
                  const date = new Date(call.createdAt);
                  const dur = call.durationSeconds ?? 0;
                  const durStr = dur > 0 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : '—';
                  const statusColor = call.status === 'COMPLETED' ? '#4ade80' : call.status === 'FAILED' ? '#f87171' : '#fbbf24';
                  return (
                    <div key={call.id} style={{
                      padding: "8px 10px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid var(--pipe-border)",
                      borderRadius: 6,
                      fontFamily: '"Space Mono", monospace',
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 9, color: "var(--pipe-text-dim)" }}>
                          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span style={{ fontSize: 8, color: statusColor, letterSpacing: "0.1em" }}>
                          {call.status}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--pipe-text)" }}>
                          {durStr}
                        </span>
                        {call.recordingS3Key && (
                          <button
                            onClick={async () => {
                              try {
                                const token = await getToken();
                                const baseUrl = import.meta.env?.VITE_API_URL ?? 'http://localhost:8787';
                                const res = await fetch(`${baseUrl}/api/v1/phone/calls/${call.id}/recording`, {
                                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                                });
                                if (!res.ok) { console.error('[CandidateProfilePage] Recording fetch failed:', res.status); return; }
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const audio = new Audio(url);
                                void audio.play();
                                audio.addEventListener('ended', () => URL.revokeObjectURL(url));
                              } catch (err) {
                                console.error('[CandidateProfilePage] Error playing recording:', err);
                              }
                            }}
                            style={{
                              background: "none",
                              border: "1px solid var(--pipe-border)",
                              borderRadius: 4,
                              color: "var(--pipe-text-dim)",
                              cursor: "pointer",
                              padding: "3px 6px",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 8,
                              fontFamily: '"Space Mono", monospace',
                            }}
                          >
                            <Play size={9} /> PLAY
                          </button>
                        )}
                      </div>
                      {call.recruiterNotes && (
                        <div style={{ fontSize: 9, color: "var(--pipe-text-dim)", marginTop: 6, lineHeight: 1.4, opacity: 0.8 }}>
                          {call.recruiterNotes}
                        </div>
                      )}
                      {call.transcription && call.transcriptionStatus === 'COMPLETED' && (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ fontSize: 8, color: "var(--pipe-text-dim)", cursor: "pointer", letterSpacing: "0.1em" }}>
                            TRANSCRIPT
                          </summary>
                          <div style={{ fontSize: 9, color: "var(--pipe-text-dim)", marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>
                            {call.transcription}
                          </div>
                        </details>
                      )}
                      {call.transcriptionStatus === 'PROCESSING' && (
                        <div style={{ fontSize: 8, color: "#fbbf24", marginTop: 4, letterSpacing: "0.1em" }}>
                          TRANSCRIBING...
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions — pushed to bottom */}
          <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              disabled={!candidate.phoneNumber}
              onClick={() => setShowPhoneDrawer(true)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px",
                background: candidate.phoneNumber ? "rgba(74,222,128,0.08)" : "var(--pipe-surface)",
                border: candidate.phoneNumber ? "1px solid rgba(74,222,128,0.2)" : "1px solid var(--pipe-border)",
                borderRadius: 8,
                color: candidate.phoneNumber ? "#4ade80" : "var(--pipe-text, #fff)",
                fontSize: 10,
                fontWeight: 800,
                fontFamily: '"Space Mono", monospace',
                cursor: candidate.phoneNumber ? "pointer" : "default",
                opacity: candidate.phoneNumber ? 1 : 0.4,
              }}
            >
              <Phone size={13} /> CALL
            </button>
            <button
              disabled={!candidate.resumeS3Key}
              onClick={() => void handleViewResume()}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px",
                background: "var(--pipe-surface)",
                border: "1px solid var(--pipe-border)",
                borderRadius: 8,
                color: "var(--pipe-text, #fff)",
                fontSize: 10,
                fontWeight: 800,
                fontFamily: '"Space Mono", monospace',
                cursor: candidate.resumeS3Key ? "pointer" : "default",
                opacity: candidate.resumeS3Key ? 1 : 0.4,
              }}
            >
              <FileDown size={13} /> VIEW_RESUME
            </button>
          </div>
        </LiquidMetalCard>
      </aside>

      {/* Phone Call Drawer — fixed overlay */}
      {showPhoneDrawer && candidate.phoneNumber && (
        <div style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: 360,
          height: "100vh",
          background: "var(--pipe-bg, #0c0c0e)",
          borderLeft: "1px solid var(--pipe-border)",
          zIndex: 50,
          boxShadow: "-4px 0 24px rgba(0,0,0,0.4)",
        }}>
          <PhoneCallDrawer
            candidateId={candidate.id}
            candidateName={candidateLabel}
            phoneNumber={candidate.phoneNumber}
            pipelineId={candidate.pipelineId}
            onClose={() => setShowPhoneDrawer(false)}
            onCallComplete={() => void refetch()}
          />
        </div>
      )}
    </div>
  );
}
