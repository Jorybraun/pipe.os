import { type CSSProperties } from "react";
import {
  Eye,
  AlertTriangle,
  Clock,
  Check,
  X,
  ChevronDown,
  Crosshair,
  Code2,
  FileQuestion,
  ListChecks,
} from "lucide-react";
import { LiquidMetalCard, SubTitle } from "../components";
import { MetalScoreRing } from "../components/MetalScoreRing";
import {
  COLORS,
  TYPOGRAPHY,
  EFFECTS,
  SPACING_NUM,
} from "../lib/designTokens";

// ─── Static Data ──────────────────────────────────────────────────────────────

const CANDIDATE = {
  name: "Sarah Chen",
  email: "sarah.chen@example.com",
  pipeline: "Senior Frontend Engineer",
  submittedAt: "2026-03-12T14:32:00Z",
  overallScore: 82,
};

const BEHAVIORAL_SIGNALS = [
  { label: "BUG DETECTION", value: "4/5", description: "Found 4 of 5 planted bugs across all challenges" },
  { label: "SEVERITY ACCURACY", value: "3/4", description: "Correctly identified severity on 3 of 4 flagged issues" },
  { label: "FALSE POSITIVES", value: "1", description: "Flagged 1 non-issue as a bug", isWarning: true },
];

const AGENT_ASSESSMENT = `Sarah demonstrates strong pattern recognition in code review, consistently identifying logic errors and edge cases. Her severity assessments are mostly accurate, though she overweighted a minor style issue as a potential security concern. Fix suggestions are practical and implementation-ready. Overall approach suggests someone who reviews code methodically rather than scanning — a positive signal for production-level review responsibilities.`;

const CODE_REVIEW_CHALLENGE = {
  type: "CODE_REVIEW" as const,
  title: "Authentication Flow — Race Condition",
  difficulty: "HARD",
  timeLimit: "25 min",
  timeUsed: "18:42",
  annotationCount: 6,
  score: 85,
  bugs: [
    { line: 23, label: "Race condition in token refresh", severity: "critical", found: true },
    { line: 47, label: "Missing null check on session", severity: "major", found: true },
    { line: 68, label: "Unhandled promise rejection", severity: "major", found: true },
    { line: 91, label: "Memory leak in event listener", severity: "minor", found: false },
    { line: 112, label: "Hardcoded timeout value", severity: "minor", found: true },
  ],
  qualityMeters: [
    { label: "Severity Accuracy", value: 75 },
    { label: "Comment Quality", value: 90 },
    { label: "Noise Ratio", value: 85 },
  ],
  annotations: [
    {
      variant: "match" as const,
      line: 23,
      candidateNote: "This is a race condition — if two tabs refresh the token simultaneously, both will invalidate the other's session. Should use a mutex or single-flight pattern.",
      groundTruth: "Race condition: concurrent token refresh can invalidate valid sessions.",
      severity: "critical",
    },
    {
      variant: "mismatch" as const,
      line: 47,
      candidateNote: "Missing null check — if getSession() returns undefined this will throw at runtime.",
      groundTruth: "Null check needed, but severity is major not critical — the outer try/catch prevents a crash.",
      severity: "major",
      candidateSeverity: "critical",
    },
    {
      variant: "false-positive" as const,
      line: 55,
      candidateNote: "This string concatenation for the auth header could be a security issue if user input reaches it.",
      explanation: "The value is always a server-issued JWT — no user input reaches this path.",
    },
    {
      variant: "missed" as const,
      line: 91,
      groundTruth: "Event listener attached in useEffect without cleanup — causes memory leak on unmount.",
      severity: "minor",
    },
  ],
  scoreBreakdown: [
    { label: "DETECTION", value: 80, weight: "50%" },
    { label: "SEVERITY", value: 75, weight: "25%" },
    { label: "FIX QUALITY", value: 90, weight: "25%" },
    { label: "PENALTIES", value: -5, weight: "—" },
  ],
  candidateSummary: "Strong detection skills with methodical review approach. Minor tendency to over-classify severity on edge cases.",
};

const COLLAPSED_CHALLENGES = [
  { type: "CODE_IMPLEMENTATION" as const, title: "Build a Debounced Search", score: 78, subtitle: "WRITE_FUNCTION" },
  { type: "QUIZ_MCQ" as const, title: "JavaScript Fundamentals", score: 92, subtitle: "10 QUESTIONS" },
  { type: "QUIZ_SHORT_ANSWER" as const, title: "System Design Reasoning", score: 71, subtitle: "3 QUESTIONS" },
];

// ─── Style Helpers ────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  CODE_REVIEW: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", text: "#60a5fa" },
  CODE_IMPLEMENTATION: { bg: "var(--pipe-accent-surface)", border: "var(--pipe-accent-border)", text: "var(--pipe-accent)" },
  QUIZ_MCQ: { bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.3)", text: "#34d399" },
  QUIZ_SHORT_ANSWER: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", text: "#fbbf24" },
};

const TYPE_ICONS: Record<string, JSX.Element> = {
  CODE_REVIEW: <Eye size={12} />,
  CODE_IMPLEMENTATION: <Code2 size={12} />,
  QUIZ_MCQ: <ListChecks size={12} />,
  QUIZ_SHORT_ANSWER: <FileQuestion size={12} />,
};

const ANNOTATION_COLORS: Record<string, { border: string; bg: string; icon: string }> = {
  match: { border: "rgba(16,185,129,0.4)", bg: "rgba(16,185,129,0.06)", icon: "#10b981" },
  mismatch: { border: "rgba(245,158,11,0.4)", bg: "rgba(245,158,11,0.06)", icon: "#f59e0b" },
  "false-positive": { border: "rgba(239,68,68,0.4)", bg: "rgba(239,68,68,0.06)", icon: "#ef4444" },
  missed: { border: "rgba(255,255,255,0.1)", bg: "rgba(255,255,255,0.02)", icon: "var(--pipe-text-dim)" },
};

const sectionGap = SPACING_NUM["3xl"];
const innerGap = SPACING_NUM.lg;
const mono: CSSProperties = { fontFamily: TYPOGRAPHY.FONT_FAMILY.PRIMARY };
const display: CSSProperties = { fontFamily: TYPOGRAPHY.FONT_FAMILY.DISPLAY };

const FALLBACK_TYPE_COLOR = { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", text: "#60a5fa" };
const FALLBACK_ANNOTATION_COLOR = { border: "rgba(16,185,129,0.4)", bg: "rgba(16,185,129,0.06)", icon: "#10b981" };

function getTypeColor(type: string): { bg: string; border: string; text: string } {
  return TYPE_COLORS[type] ?? FALLBACK_TYPE_COLOR;
}

function getAnnotationColor(variant: string): { border: string; bg: string; icon: string } {
  return ANNOTATION_COLORS[variant] ?? FALLBACK_ANNOTATION_COLOR;
}

function TypeBadge({ type }: { type: string }): JSX.Element {
  const c = getTypeColor(type);
  return (
    <span
      style={{
        ...mono,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: TYPOGRAPHY.SIZES.CAPTION,
        letterSpacing: TYPOGRAPHY.LETTER_SPACING.MEDIUM,
        color: c.text,
        background: c.bg,
        border: `1px solid ${c.border}`,
        padding: "4px 10px",
        borderRadius: 0,
      }}
    >
      {TYPE_ICONS[type]}
      {type.replace(/_/g, " ")}
    </span>
  );
}

function MeterBar({ value, label }: { value: number; label: string }): JSX.Element {
  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          ...mono,
          fontSize: TYPOGRAPHY.SIZES.TINY,
          letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE,
          color: COLORS.TEXT.TERTIARY,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          height: 4,
          background: COLORS.BORDER.SUBTLE,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${value}%`,
            background: value >= 80
              ? "linear-gradient(90deg, rgba(16,185,129,0.6), rgba(16,185,129,0.9))"
              : value >= 60
                ? "linear-gradient(90deg, rgba(245,158,11,0.6), rgba(245,158,11,0.9))"
                : "linear-gradient(90deg, rgba(239,68,68,0.6), rgba(239,68,68,0.9))",
            borderRadius: 2,
            transition: `width ${EFFECTS.TRANSITION.SLOWER} ${EFFECTS.EASING.SMOOTH}`,
          }}
        />
      </div>
      <div
        style={{
          ...mono,
          fontSize: TYPOGRAPHY.SIZES.SMALL,
          color: COLORS.TEXT.SECONDARY,
          marginTop: 6,
          textAlign: "right",
        }}
      >
        {value}%
      </div>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

/**
 * CandidateReportPrototype — Static prototype of the candidate scouting report.
 * No state, no data fetching. Uses existing design primitives.
 */
export default function CandidateReportPrototype(): JSX.Element {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: sectionGap, display: "flex", flexDirection: "column", gap: sectionGap }}>

      {/* ── Candidate Header ─────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.CAPTION, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.TEXT.TERTIARY, marginBottom: 8 }}>
            SCOUTING REPORT
          </div>
          <div style={{ ...display, fontSize: 32, fontWeight: TYPOGRAPHY.WEIGHT.DISPLAY, color: COLORS.TEXT.PRIMARY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.TIGHT }}>
            {CANDIDATE.name}
          </div>
          <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.SMALL, color: COLORS.TEXT.TERTIARY, marginTop: 6 }}>
            {CANDIDATE.pipeline} — submitted {new Date(CANDIDATE.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
        <MetalScoreRing value={CANDIDATE.overallScore} size={100} label="OVERALL" />
      </div>

      {/* ── Behavioral Signals ───────────────────────────────────── */}
      <section>
        <SubTitle>BEHAVIORAL_SIGNALS</SubTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: innerGap, marginTop: innerGap }}>
          {BEHAVIORAL_SIGNALS.map((s) => (
            <LiquidMetalCard key={s.label} variant="chrome" style={{ padding: SPACING_NUM["2xl"], borderRadius: 0 }}>
              <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.TEXT.TERTIARY, marginBottom: 12 }}>
                {s.label}
              </div>
              <div
                style={{
                  ...display,
                  fontSize: 28,
                  fontWeight: TYPOGRAPHY.WEIGHT.DISPLAY,
                  background: s.isWarning
                    ? "linear-gradient(180deg, #f59e0b 0%, rgba(245,158,11,0.6) 100%)"
                    : "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  letterSpacing: TYPOGRAPHY.LETTER_SPACING.TIGHT,
                }}
              >
                {s.value}
              </div>
              <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.CAPTION, color: COLORS.TEXT.TERTIARY, marginTop: 8, lineHeight: TYPOGRAPHY.LINE_HEIGHT.RELAXED }}>
                {s.description}
              </div>
            </LiquidMetalCard>
          ))}
        </div>
      </section>

      {/* ── Agent Assessment ──────────────────────────────────────── */}
      <section>
        <SubTitle>AGENT_ASSESSMENT</SubTitle>
        <LiquidMetalCard variant="mercury" style={{ padding: SPACING_NUM["3xl"], marginTop: innerGap, borderRadius: EFFECTS.BORDER.RADIUS_CARD }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: SPACING_NUM.xl }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.AI.PRIMARY, boxShadow: `0 0 12px ${COLORS.AI.GLOW}` }} />
            <span style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.AI.SECONDARY }}>
              AI EVALUATOR
            </span>
          </div>
          <p style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.BODY, color: COLORS.TEXT.SECONDARY, lineHeight: TYPOGRAPHY.LINE_HEIGHT.RELAXED, margin: 0 }}>
            {AGENT_ASSESSMENT}
          </p>
        </LiquidMetalCard>
      </section>

      {/* ── Challenge Detail: CODE_REVIEW ─────────────────────────── */}
      <section>
        <SubTitle>CHALLENGE_DETAIL</SubTitle>

        <LiquidMetalCard variant="dark" style={{ marginTop: innerGap, borderRadius: 0, overflow: "visible" }}>

          {/* Challenge Header */}
          <div style={{ padding: `${SPACING_NUM["2xl"]}px`, borderBottom: `1px solid ${COLORS.BORDER.SUBTLE}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <TypeBadge type="CODE_REVIEW" />
              <span style={{ ...display, fontSize: TYPOGRAPHY.SIZES.H3, fontWeight: TYPOGRAPHY.WEIGHT.BOLD, color: COLORS.TEXT.PRIMARY }}>
                {CODE_REVIEW_CHALLENGE.title}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <span style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.CAPTION, letterSpacing: TYPOGRAPHY.LETTER_SPACING.MEDIUM, color: COLORS.TEXT.TERTIARY }}>
                {CODE_REVIEW_CHALLENGE.difficulty}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, ...mono, fontSize: TYPOGRAPHY.SIZES.CAPTION, color: COLORS.TEXT.TERTIARY }}>
                <Clock size={10} />
                {CODE_REVIEW_CHALLENGE.timeUsed} / {CODE_REVIEW_CHALLENGE.timeLimit}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, ...mono, fontSize: TYPOGRAPHY.SIZES.CAPTION, color: COLORS.TEXT.TERTIARY }}>
                <Crosshair size={10} />
                {CODE_REVIEW_CHALLENGE.annotationCount} annotations
              </div>
            </div>
          </div>

          {/* Detection Map */}
          <div style={{ padding: `${SPACING_NUM["2xl"]}px`, borderBottom: `1px solid ${COLORS.BORDER.SUBTLE}` }}>
            <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.TEXT.TERTIARY, marginBottom: SPACING_NUM.lg }}>
              DETECTION MAP
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {CODE_REVIEW_CHALLENGE.bugs.map((bug) => (
                <div
                  key={bug.line}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: bug.found ? "rgba(16,185,129,0.04)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${bug.found ? "rgba(16,185,129,0.15)" : COLORS.BORDER.SUBTLE}`,
                    borderRadius: 0,
                  }}
                >
                  <div style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {bug.found ? (
                      <Check size={12} style={{ color: "#10b981" }} />
                    ) : (
                      <X size={12} style={{ color: "var(--pipe-text-dim)" }} />
                    )}
                  </div>
                  <span style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: COLORS.TEXT.TERTIARY, width: 36 }}>
                    L{bug.line}
                  </span>
                  <span style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.SMALL, color: bug.found ? COLORS.TEXT.SECONDARY : COLORS.TEXT.TERTIARY, flex: 1 }}>
                    {bug.label}
                  </span>
                  <span
                    style={{
                      ...mono,
                      fontSize: TYPOGRAPHY.SIZES.TINY,
                      letterSpacing: TYPOGRAPHY.LETTER_SPACING.MEDIUM,
                      color: bug.severity === "critical" ? "#ef4444" : bug.severity === "major" ? "#f59e0b" : COLORS.TEXT.TERTIARY,
                      textTransform: "uppercase",
                    }}
                  >
                    {bug.severity}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quality Meters */}
          <div style={{ padding: `${SPACING_NUM["2xl"]}px`, borderBottom: `1px solid ${COLORS.BORDER.SUBTLE}` }}>
            <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.TEXT.TERTIARY, marginBottom: SPACING_NUM.lg }}>
              QUALITY METRICS
            </div>
            <div style={{ display: "flex", gap: SPACING_NUM["3xl"] }}>
              {CODE_REVIEW_CHALLENGE.qualityMeters.map((m) => (
                <MeterBar key={m.label} label={m.label.toUpperCase()} value={m.value} />
              ))}
            </div>
          </div>

          {/* Annotations */}
          <div style={{ padding: `${SPACING_NUM["2xl"]}px`, borderBottom: `1px solid ${COLORS.BORDER.SUBTLE}` }}>
            <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.TEXT.TERTIARY, marginBottom: SPACING_NUM.lg }}>
              ANNOTATIONS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {CODE_REVIEW_CHALLENGE.annotations.map((a, i) => {
                const ac = getAnnotationColor(a.variant);
                return (
                  <div
                    key={i}
                    style={{
                      borderLeft: `3px solid ${ac.border}`,
                      background: ac.bg,
                      padding: SPACING_NUM.xl,
                      borderRadius: "0 8px 8px 0",
                    }}
                  >
                    {/* Annotation Header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span
                        style={{
                          ...mono,
                          fontSize: TYPOGRAPHY.SIZES.TINY,
                          letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE,
                          color: ac.icon,
                          textTransform: "uppercase",
                        }}
                      >
                        {a.variant === "match" && "MATCH"}
                        {a.variant === "mismatch" && "SEVERITY MISMATCH"}
                        {a.variant === "false-positive" && "FALSE POSITIVE"}
                        {a.variant === "missed" && "MISSED"}
                      </span>
                      {"line" in a && (
                        <span style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: COLORS.TEXT.TERTIARY }}>
                          Line {a.line}
                        </span>
                      )}
                      {"severity" in a && a.severity && (
                        <span
                          style={{
                            ...mono,
                            fontSize: TYPOGRAPHY.SIZES.TINY,
                            letterSpacing: TYPOGRAPHY.LETTER_SPACING.MEDIUM,
                            color: a.severity === "critical" ? "#ef4444" : a.severity === "major" ? "#f59e0b" : COLORS.TEXT.TERTIARY,
                            textTransform: "uppercase",
                          }}
                        >
                          {a.severity}
                        </span>
                      )}
                    </div>

                    {/* Candidate's note */}
                    {"candidateNote" in a && a.candidateNote && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: COLORS.TEXT.TERTIARY, marginBottom: 4 }}>CANDIDATE</div>
                        <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.SMALL, color: COLORS.TEXT.SECONDARY, lineHeight: TYPOGRAPHY.LINE_HEIGHT.RELAXED }}>
                          &ldquo;{a.candidateNote}&rdquo;
                        </div>
                      </div>
                    )}

                    {/* Ground truth */}
                    {"groundTruth" in a && a.groundTruth && (
                      <div>
                        <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: COLORS.TEXT.TERTIARY, marginBottom: 4 }}>GROUND TRUTH</div>
                        <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.SMALL, color: COLORS.TEXT.TERTIARY, lineHeight: TYPOGRAPHY.LINE_HEIGHT.RELAXED }}>
                          {a.groundTruth}
                        </div>
                      </div>
                    )}

                    {/* False positive explanation */}
                    {"explanation" in a && a.explanation && (
                      <div>
                        <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: COLORS.TEXT.TERTIARY, marginBottom: 4 }}>WHY FALSE</div>
                        <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.SMALL, color: COLORS.TEXT.TERTIARY, lineHeight: TYPOGRAPHY.LINE_HEIGHT.RELAXED }}>
                          {a.explanation}
                        </div>
                      </div>
                    )}

                    {/* Severity mismatch callout */}
                    {"candidateSeverity" in a && a.candidateSeverity && (
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <AlertTriangle size={10} style={{ color: "#f59e0b" }} />
                        <span style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: "#f59e0b" }}>
                          Candidate marked as {a.candidateSeverity}, actual: {a.severity}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Challenge Footer — Score Breakdown */}
          <div style={{ padding: `${SPACING_NUM["2xl"]}px` }}>
            <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.SMALL, color: COLORS.TEXT.TERTIARY, marginBottom: SPACING_NUM.xl, lineHeight: TYPOGRAPHY.LINE_HEIGHT.RELAXED }}>
              {CODE_REVIEW_CHALLENGE.candidateSummary}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: SPACING_NUM.lg, alignItems: "end" }}>
              {CODE_REVIEW_CHALLENGE.scoreBreakdown.map((s) => (
                <div key={s.label}>
                  <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.TEXT.TERTIARY, marginBottom: 6 }}>
                    {s.label}
                  </div>
                  <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: COLORS.TEXT.TERTIARY, marginBottom: 4 }}>
                    {s.weight}
                  </div>
                  <div
                    style={{
                      ...display,
                      fontSize: 22,
                      fontWeight: TYPOGRAPHY.WEIGHT.BOLD,
                      color: s.value < 0 ? "#ef4444" : COLORS.TEXT.PRIMARY,
                    }}
                  >
                    {s.value < 0 ? s.value : s.value}
                  </div>
                </div>
              ))}
              {/* Total */}
              <div style={{ borderLeft: `1px solid ${COLORS.BORDER.SUBTLE}`, paddingLeft: SPACING_NUM.xl }}>
                <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, letterSpacing: TYPOGRAPHY.LETTER_SPACING.WIDE, color: COLORS.TEXT.TERTIARY, marginBottom: 10 }}>
                  TOTAL
                </div>
                <div
                  style={{
                    ...display,
                    fontSize: 32,
                    fontWeight: TYPOGRAPHY.WEIGHT.DISPLAY,
                    background: "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {CODE_REVIEW_CHALLENGE.score}
                </div>
              </div>
            </div>
          </div>
        </LiquidMetalCard>
      </section>

      {/* ── Collapsed Challenges ──────────────────────────────────── */}
      <section>
        <SubTitle>OTHER_CHALLENGES</SubTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: innerGap }}>
          {COLLAPSED_CHALLENGES.map((ch) => (
            <LiquidMetalCard
              key={ch.title}
              style={{
                padding: `${SPACING_NUM.lg}px ${SPACING_NUM["2xl"]}px`,
                borderRadius: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <TypeBadge type={ch.type} />
                <div>
                  <div style={{ ...display, fontSize: TYPOGRAPHY.SIZES.BODY, fontWeight: TYPOGRAPHY.WEIGHT.BOLD, color: COLORS.TEXT.PRIMARY }}>
                    {ch.title}
                  </div>
                  <div style={{ ...mono, fontSize: TYPOGRAPHY.SIZES.TINY, color: COLORS.TEXT.TERTIARY, marginTop: 2, letterSpacing: TYPOGRAPHY.LETTER_SPACING.MEDIUM }}>
                    {ch.subtitle}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span
                  style={{
                    ...display,
                    fontSize: TYPOGRAPHY.SIZES.H3,
                    fontWeight: TYPOGRAPHY.WEIGHT.DISPLAY,
                    background: "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {ch.score}
                </span>
                <ChevronDown size={14} style={{ color: COLORS.TEXT.TERTIARY }} />
              </div>
            </LiquidMetalCard>
          ))}
        </div>
      </section>
    </div>
  );
}
