import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  MapPin,
  Mail,
  Briefcase,
  CheckCircle,
  Activity,
  Phone,
  Zap,
  Code,
  Mic,
  Users,
  FileText,
  ArrowLeft,
} from "lucide-react";
import {
  Layout,
  ProfileHeader,
  LiquidMetalCard,
  MetalScoreRing,
  SubTitle,
  SidebarNav,
} from "../components";
import { getCandidateById } from "../mocks";

/**
 * CandidateProfilePage - Detailed candidate profile
 *
 * Shows candidate avatar, AI verdict, assessment scores, and pipeline status
 * Matches the profile-example.tsx design
 */

// Map stage names to icons
const stageIcons: Record<string, typeof Phone> = {
  "Code Review": Code,
  "Voice Interview": Mic,
  "System Design": FileText,
  Screening: Phone,
  "AI Collaboration": Zap,
  "Panel Interview": Users,
};

export default function CandidateProfilePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("profile");
  const [isAgentOpen, setIsAgentOpen] = useState(false);

  const candidate = id ? getCandidateById(id) : undefined;

  if (!candidate) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
        }}
      >
        <LiquidMetalCard
          variant="mercury"
          style={{ padding: 60, textAlign: "center" }}
        >
          <h2 style={{ fontSize: 24, marginBottom: 16 }}>
            Candidate Not Found
          </h2>
          <button
            onClick={() => navigate("/")}
            style={{
              padding: "12px 24px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Back to Roles
          </button>
        </LiquidMetalCard>
      </div>
    );
  }

  // Mock AI profile data - would come from backend in real app
  const aiProfile = {
    verdict:
      candidate.signal === "STRONG"
        ? "STRONG\nYES"
        : candidate.signal === "YES"
        ? "YES"
        : "MAYBE",
    reasoning:
      candidate.signal === "STRONG"
        ? "Exceeds requirements in technical depth and AI collaboration. Strong contributor from day one."
        : candidate.signal === "YES"
        ? "Meets requirements with solid technical skills. Good fit for the role with some ramp-up time."
        : "Shows potential but may need additional development. Consider for junior positions.",
    roleFitScore: candidate.score / 100,
    cultureFitScore: Math.min((candidate.score - 5) / 100, 0.99),
    growthPotentialScore: Math.min((candidate.score + 5) / 100, 0.99),
  };

  return (
    <>
      {/* Back button */}
      <div style={{ marginBottom: 32 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
            fontSize: 10,
            letterSpacing: "0.15em",
            transition: "color 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.6)";
          }}
        >
          <ArrowLeft size={12} /> BACK TO PIPELINE
        </button>
      </div>

      {/* <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {stages.map((s) => (
          <div key={s.id} style={{ flex: 1, minWidth: 280 }}>
            <StageHeaderCard
              stage={s}
              candidates={candidatesByStage[s.id] || []}
              isActive={stage === s.id}
              onClick={() => navigate(`/pipeline/${id}/${s.id}`)}
            />
          </div>
        ))}
      </div> */}

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {candidate.stages.map((stage) => {
          const Icon = stageIcons[stage.name] || FileText;
          const isComplete = stage.status === "COMPLETED";
          const isActive = stage.status === "IN_PROGRESS";

          return (
            <div key={stage.id} style={{ flex: 1, minWidth: 280 }}>
              <LiquidMetalCard
                key={stage.id}
                variant={isActive ? "chrome" : "default"}
                hover
                style={{
                  padding: 24,
                  opacity: !isComplete && !isActive ? 0.4 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <Icon
                    size={16}
                    color={isActive ? "#fff" : "rgba(255,255,255,0.4)"}
                  />
                  {isComplete && (
                    <CheckCircle size={12} color="rgba(150,255,150,0.8)" />
                  )}
                  {isActive && (
                    <Activity
                      size={12}
                      color="rgba(255,255,255,0.8)"
                      style={{
                        animation: "pulse 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                </div>

                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.2em",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
                    marginBottom: 8,
                  }}
                >
                  {stage.name.toUpperCase()}
                </div>

                {isComplete && stage.score && (
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      background:
                        "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {stage.score}
                  </div>
                )}

                {!isComplete && !isActive && (
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      color: "rgba(255,255,255,0.15)",
                    }}
                  >
                    —
                  </div>
                )}
              </LiquidMetalCard>
            </div>
          );
        })}
      </div>
      {/* Hero Grid: Avatar + AI Verdict + Score Stack */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr 200px",
          gap: 24,
          marginBottom: 60,
        }}
      >
        {/* Avatar Block */}
        <LiquidMetalCard variant="chrome" hover style={{ padding: 0 }}>
          <div
            style={{
              height: 320,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              background: `
                radial-gradient(
                  ellipse at 30% 30%,
                  rgba(255,255,255,0.15) 0%,
                  transparent 50%
                ),
                radial-gradient(
                  ellipse at 70% 70%,
                  rgba(200,210,230,0.1) 0%,
                  transparent 50%
                )
              `,
            }}
          >
            {/* Large liquid metal monogram */}
            <div
              style={{
                fontSize: 120,
                fontWeight: 900,
                background: `
                  linear-gradient(135deg,
                    rgba(255,255,255,1) 0%,
                    rgba(200,200,220,0.7) 20%,
                    rgba(255,255,255,0.95) 40%,
                    rgba(180,190,210,0.6) 60%,
                    rgba(220,220,240,0.9) 80%,
                    rgba(255,255,255,1) 100%
                  )
                `,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                filter: "drop-shadow(0 10px 40px rgba(200,210,230,0.3))",
                letterSpacing: "0.05em",
              }}
            >
              {candidate.initials}
            </div>
          </div>

          {/* Contact info */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {[
              { icon: Briefcase, value: candidate.company || "Not specified" },
              { icon: MapPin, value: candidate.location },
              { icon: Mail, value: candidate.email },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px 24px",
                  borderBottom:
                    i < 2 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                <item.icon size={14} color="rgba(255,255,255,0.25)" />
                {(item.value || "").toUpperCase()}
              </div>
            ))}
          </div>
        </LiquidMetalCard>

        {/* AI Recommendation */}
        <LiquidMetalCard variant="mercury" hover style={{ padding: 48 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              marginBottom: 40,
            }}
          >
            <div>
              <div style={{ marginBottom: 20 }}>
                <SubTitle>AI_VERDICT</SubTitle>
              </div>

              <div
                style={{
                  fontSize: 72,
                  fontWeight: 900,
                  lineHeight: 0.85,
                  letterSpacing: "-0.03em",
                  background: `
                    linear-gradient(135deg,
                      #fff 0%,
                      rgba(200,210,230,0.8) 25%,
                      #fff 50%,
                      rgba(180,190,220,0.7) 75%,
                      rgba(240,240,250,0.9) 100%
                    )
                  `,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 4px 30px rgba(200,210,230,0.2))",
                  whiteSpace: "pre-line",
                }}
              >
                {aiProfile.verdict}
              </div>
            </div>

            <MetalScoreRing value={candidate.score} label="AVG" />
          </div>

          <div
            style={{
              padding: 24,
              background: "rgba(0,0,0,0.2)",
              borderLeft: "2px solid rgba(255,255,255,0.2)",
              fontSize: 13,
              lineHeight: 1.7,
              color: "rgba(255,255,255,0.6)",
              letterSpacing: "0.02em",
            }}
          >
            {aiProfile.reasoning}
          </div>
        </LiquidMetalCard>

        {/* Score Stack */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "ROLE", value: aiProfile.roleFitScore },
            { label: "CULTURE", value: aiProfile.cultureFitScore },
            { label: "GROWTH", value: aiProfile.growthPotentialScore },
          ].map((item, i) => (
            <LiquidMetalCard key={i} hover style={{ flex: 1, padding: 20 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.3em",
                    color: "rgba(255,255,255,0.3)",
                  }}
                >
                  {item.label}
                </span>

                <span
                  style={{
                    fontSize: 36,
                    fontWeight: 800,
                    background:
                      "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {Math.round(item.value * 100)}
                </span>

                {/* Chrome bar */}
                <div
                  style={{
                    height: 3,
                    background: "rgba(255,255,255,0.06)",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: "100%",
                      width: `${item.value * 100}%`,
                      background:
                        "linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.8), rgba(200,210,230,0.6))",
                      boxShadow: "0 0 15px rgba(255,255,255,0.3)",
                    }}
                  />
                </div>
              </div>
            </LiquidMetalCard>
          ))}
        </div>
      </section>
      {/* Assessment Pipeline
      <section style={{ marginBottom: 60 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.4em",
            color: "rgba(255,255,255,0.3)",
            marginBottom: 20,
          }}
        >
          PIPELINE STATUS
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 2,
          }}
        ></div>
      </section> */}
    </>
  );
}
