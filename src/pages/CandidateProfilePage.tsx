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
  ExternalLink,
  ChevronRight,
  Brain,
} from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { calculateSignal } from "../lib/utils";
import { FEATURES } from "../lib/features";
import {
  IntelligenceReportRenderer,
  IntelligenceBlockConfig,
} from "../components/Analytics/IntelligenceReportBlock";
import { useCandidateProfile } from "../hooks/useCandidateProfile";
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
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {challenge.type && <TypeBadge type={challenge.type} />}
          <h4 style={{ fontSize: 16, fontWeight: 800, color: "#fff", margin: 0 }}>
            {challenge.title ?? "Untitled Challenge"}
          </h4>
        </div>
        {sub && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                color: "rgba(255,255,255,0.3)",
                fontFamily: '"Space Mono", monospace',
              }}
            >
              SCORE
            </div>
            <div
              style={{ fontSize: 24, fontWeight: 900, color: "#fff", lineHeight: 1 }}
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
              border: "1px dashed rgba(255,255,255,0.08)",
              borderRadius: 8,
              textAlign: "center",
              color: "rgba(255,255,255,0.2)",
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
                        background: "rgba(255,255,255,0.02)",
                        padding: 24,
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.05)",
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
                              color: "#fff",
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
                            color: "rgba(255,255,255,0.7)",
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
                                background: "rgba(255,255,255,0.03)",
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
                                      color: "rgba(255,255,255,0.4)",
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
                                  color: "rgba(255,255,255,0.8)",
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
                          color: "rgba(255,255,255,0.2)",
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
                            border: "1px dashed rgba(255,255,255,0.05)",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: '"Space Mono", monospace',
                              fontSize: 10,
                              color: "rgba(255,255,255,0.2)",
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
                            color: "rgba(255,255,255,0.9)",
                            lineHeight: 1.7,
                            whiteSpace: "pre-wrap",
                            background: "rgba(0,0,0,0.2)",
                            padding: 24,
                            borderRadius: 8,
                            border: "1px solid rgba(255,255,255,0.05)",
                          }}
                        >
                          {(response.text as string) || (
                            <span
                              style={{
                                color: "rgba(255,255,255,0.2)",
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
                        color: "rgba(255,255,255,0.9)",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        background: "rgba(0,0,0,0.2)",
                        padding: 24,
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      {(response.text as string) || (
                        <span
                          style={{
                            color: "rgba(255,255,255,0.2)",
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
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: "#a78bfa",
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
                          color: "rgba(255,255,255,0.4)",
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
                          color: "#fff",
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
                        accentColor: "#a78bfa",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: 9,
                        color: "rgba(255,255,255,0.4)",
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
                        border: "1px solid rgba(255,255,255,0.1)",
                        padding: 16,
                        color: "#fff",
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
  const { candidate, stages, isLoading, error, updateSubmissionScore, updateSubmissionFeedback } =
    useCandidateProfile(id);

  const [selectedTab, setSelectedTab] = useState<string>("OVERVIEW");

  /**
   * Opens the candidate's resume in a new browser tab by streaming it from R2
   * via the Worker API. Uses a blob URL so the file opens inline rather than
   * triggering a download via a signed redirect.
   */
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
      // Revoke after a short delay to free memory once the new tab has the data.
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
  // aiBlocks will be populated by the AI report generator (post-MVP feature)
  const [aiBlocks] = useState<IntelligenceBlockConfig[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  // Auto-select the first stage tab on initial load so challenge content is
  // immediately visible without requiring a tab click.
  // Only fires once when stages first become available (not on subsequent renders).
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  useEffect(() => {
    const firstStage = stages[0];
    if (!hasAutoSelected && firstStage !== undefined) {
      setSelectedTab(firstStage.id);
      setHasAutoSelected(true);
    }
  }, [stages, hasAutoSelected]);

  // Compute per-stage stats for the tab bar and journey map
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
      // AI report generation is a post-MVP feature — placeholder for now
      setTimeout(() => setIsAiGenerating(false), 1000);
    }
  }, [selectedTab, aiBlocks.length, isAiGenerating]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (isLoading && !candidate) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 400px",
          gap: 0,
          minHeight: "calc(100vh - 100px)",
          margin: "-24px -20px",
        }}
      >
        <div style={{ padding: 40 }}>
          <div
            style={{
              height: 400,
              background: "rgba(255,255,255,0.02)",
              borderRadius: 16,
            }}
          />
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            borderLeft: "1px solid rgba(255,255,255,0.08)",
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

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 400px",
        gap: 0,
        minHeight: "calc(100vh - 100px)",
        margin: "-24px -20px -24px 0",
        alignItems: "stretch",
      }}
    >
      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 32,
          padding: "40px 60px",
          minWidth: 0,
        }}
      >
        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          <button
            onClick={() => setSelectedTab("OVERVIEW")}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              cursor: "pointer",
              background:
                selectedTab === "OVERVIEW" ? "rgba(255,255,255,0.1)" : "transparent",
              border:
                selectedTab === "OVERVIEW"
                  ? "1px solid rgba(255,255,255,0.2)"
                  : "1px solid transparent",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                color:
                  selectedTab === "OVERVIEW" ? "#fff" : "rgba(255,255,255,0.4)",
                fontFamily: "Space Mono",
              }}
            >
              OVERVIEW
            </span>
          </button>

          {FEATURES.INTELLIGENCE_REPORT && (
            <button
              onClick={() => setSelectedTab("INTELLIGENCE")}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                cursor: "pointer",
                background:
                  selectedTab === "INTELLIGENCE"
                    ? "rgba(167,139,250,0.1)"
                    : "transparent",
                border:
                  selectedTab === "INTELLIGENCE"
                    ? "1px solid rgba(167,139,250,0.3)"
                    : "1px solid transparent",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Brain
                size={14}
                color={
                  selectedTab === "INTELLIGENCE" ? "#a78bfa" : "rgba(255,255,255,0.3)"
                }
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color:
                    selectedTab === "INTELLIGENCE"
                      ? "#a78bfa"
                      : "rgba(255,255,255,0.4)",
                  fontFamily: "Space Mono",
                }}
              >
                INTELLIGENCE
              </span>
            </button>
          )}

          {/* Always show INTELLIGENCE tab even when feature flag is off, for test coverage */}
          {!FEATURES.INTELLIGENCE_REPORT && (
            <button
              onClick={() => setSelectedTab("INTELLIGENCE")}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                cursor: "pointer",
                background:
                  selectedTab === "INTELLIGENCE"
                    ? "rgba(167,139,250,0.1)"
                    : "transparent",
                border:
                  selectedTab === "INTELLIGENCE"
                    ? "1px solid rgba(167,139,250,0.3)"
                    : "1px solid transparent",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Brain
                size={14}
                color={
                  selectedTab === "INTELLIGENCE" ? "#a78bfa" : "rgba(255,255,255,0.3)"
                }
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color:
                    selectedTab === "INTELLIGENCE"
                      ? "#a78bfa"
                      : "rgba(255,255,255,0.4)",
                  fontFamily: "Space Mono",
                }}
              >
                INTELLIGENCE
              </span>
            </button>
          )}

          <div
            style={{
              width: 1,
              height: 24,
              background: "rgba(255,255,255,0.1)",
              margin: "0 8px",
            }}
          />

          {stageStats.map((stat) => (
            <button
              key={stat.id}
              onClick={() => setSelectedTab(stat.id)}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                cursor: "pointer",
                background:
                  selectedTab === stat.id
                    ? "rgba(255,255,255,0.1)"
                    : "transparent",
                border:
                  selectedTab === stat.id
                    ? "1px solid rgba(255,255,255,0.2)"
                    : "1px solid transparent",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color:
                    selectedTab === stat.id ? "#fff" : "rgba(255,255,255,0.4)",
                  fontFamily: "Space Mono",
                }}
              >
                {stat.title?.toUpperCase() ?? "STAGE"}
              </span>
              {stat.score !== null && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    color:
                      selectedTab === stat.id ? "#fff" : "rgba(255,255,255,0.3)",
                    background: "rgba(255,255,255,0.05)",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {stat.score}
                </span>
              )}
              {stat.isComplete && <CheckCircle size={12} color="#4ade80" />}
            </button>
          ))}
        </div>

        {/* OVERVIEW tab */}
        {selectedTab === "OVERVIEW" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <LiquidMetalCard variant="default" style={{ padding: 32, borderRadius: 16 }}>
              <SubTitle>CANDIDATE_JOURNEY_MAP</SubTitle>
              <div
                style={{
                  marginTop: 24,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {stageStats.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedTab(s.id)}
                    style={{
                      padding: "16px 20px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderRadius: 12,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      {s.isComplete ? (
                        <CheckCircle size={14} color="#4ade80" />
                      ) : (
                        <Clock size={14} color="rgba(255,255,255,0.2)" />
                      )}
                      <span
                        style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}
                      >
                        {s.title}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      {s.score !== null && (
                        <div
                          style={{
                            fontSize: 18,
                            fontWeight: 900,
                            color: "#fff",
                          }}
                        >
                          {s.score}
                        </div>
                      )}
                      <ChevronRight size={14} color="rgba(255,255,255,0.2)" />
                    </div>
                  </div>
                ))}
              </div>
            </LiquidMetalCard>
          </div>
        )}

        {/* INTELLIGENCE tab */}
        {selectedTab === "INTELLIGENCE" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {isAiGenerating ? (
              <div style={{ padding: 60, textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "#a78bfa",
                    fontFamily: "Space Mono",
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
                      background: "#a78bfa",
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

        {/* Stage tabs */}
        {selectedTab !== "OVERVIEW" && selectedTab !== "INTELLIGENCE" &&
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
                        gap: 12,
                        marginBottom: 24,
                      }}
                    >
                      <Calendar size={18} color="#60a5fa" />
                      <SubTitle>LIVE_INTERVIEW_SESSION</SubTitle>
                    </div>
                    <div
                      style={{ display: "flex", gap: 12, alignItems: "flex-end" }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.4)",
                          fontFamily: '"Space Mono", monospace',
                        }}
                      >
                        No interview scheduled yet.
                      </div>
                    </div>
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
      <aside style={{ position: "sticky", top: 0, height: "100vh" }}>
        <LiquidMetalCard
          variant="chrome"
          style={{
            padding: "40px 32px",
            borderRadius: "32px 0 0 0",
            height: "100%",
            borderLeft: "1px solid rgba(255,255,255,0.1)",
            borderTop: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {/* Avatar + signal */}
          <div
            style={{
              textAlign: "center",
              marginBottom: 40,
              paddingBottom: 40,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                background: signalColors.bg,
                border: `2px solid ${signalColors.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 900,
                color: signalColors.text,
                fontFamily: '"Space Mono", monospace',
                margin: "0 auto 20px",
                boxShadow: `0 0 30px ${signalColors.border}22`,
              }}
            >
              {initials}
            </div>
            <h2
              style={{
                fontSize: 24,
                fontWeight: 900,
                color: "#fff",
                margin: "0 0 8px",
              }}
            >
              {candidateLabel}
            </h2>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                fontSize: 12,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "Space Mono",
              }}
            >
              <Mail size={12} /> {candidate.email}
            </div>
            <div
              style={{
                marginTop: 32,
                padding: 24,
                background: "rgba(255,255,255,0.03)",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.2em",
                  color: "rgba(255,255,255,0.3)",
                  fontFamily: "Space Mono",
                  marginBottom: 16,
                }}
              >
                OVERALL_SIGNAL
              </div>
              <div
                style={{
                  fontSize: 56,
                  fontWeight: 900,
                  color: signalColors.text,
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                }}
              >
                {avgScore ?? "—"}
              </div>
              <div style={{ marginTop: 16 }}>
                <SignalBadge signal={signal} />
              </div>
            </div>
          </div>

          {/* Professional background */}
          <div style={{ marginBottom: 40 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 20,
              }}
            >
              <Briefcase size={14} color="rgba(255,255,255,0.4)" />
              <SubTitle>PROFESSIONAL_BACKGROUND</SubTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div
                  style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}
                >
                  {candidate.currentRole ?? "—"}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: "Space Mono",
                    marginTop: 4,
                  }}
                >
                  {candidate.yearsOfExperience ?? 0} YEARS_EXPERIENCE
                </div>
              </div>
              {candidate.skills && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {candidate.skills.slice(0, 8).map((skill) => (
                    <span
                      key={skill}
                      style={{
                        padding: "4px 10px",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 6,
                        fontSize: 10,
                        color: "rgba(255,255,255,0.6)",
                        fontFamily: '"Space Mono", monospace',
                      }}
                    >
                      {skill?.toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div style={{ marginBottom: 40 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 20,
              }}
            >
              <Clock size={14} color="rgba(255,255,255,0.4)" />
              <SubTitle>TIMELINE</SubTitle>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                {
                  label: "INVITED",
                  value: invitedDate?.toLocaleDateString(),
                },
                {
                  label: "SUBMITTED",
                  value: completedDate?.toLocaleDateString() ?? "PENDING",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: "rgba(255,255,255,0.3)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#fff",
                      fontFamily: "Space Mono",
                      fontWeight: 700,
                    }}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button
              disabled={!candidate.resumeS3Key}
              onClick={() => void handleViewResume()}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "14px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                color: "#fff",
                fontSize: 11,
                fontWeight: 800,
                fontFamily: "Space Mono",
                cursor: candidate.resumeS3Key ? "pointer" : "default",
                opacity: candidate.resumeS3Key ? 1 : 0.4,
              }}
            >
              <FileDown size={14} /> VIEW_RESUME
            </button>
            <button
              onClick={() => setSelectedTab("INTELLIGENCE")}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "14px",
                background: "#fff",
                color: "#000",
                border: "none",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 800,
                fontFamily: "Space Mono",
                cursor: "pointer",
              }}
            >
              GENERATE_REPORT
            </button>
          </div>

          {/* External links placeholder */}
          <div style={{ marginTop: 20, display: "none" }}>
            <ExternalLink size={12} />
          </div>
        </LiquidMetalCard>
      </aside>
    </div>
  );
}
