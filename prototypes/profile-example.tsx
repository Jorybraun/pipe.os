import React from "react";
import {
  MapPin,
  Mail,
  Briefcase,
  CheckCircle,
  Phone,
  Activity,
  Zap,
  Code,
  Mic,
  Users,
} from "lucide-react";

import {
  Layout,
  ProfileHeader,
  LiquidMetalCard,
  MetalScoreRing,
  SubTitle,
  SidebarNav,
} from "../src/components/index";

// Sample data
const candidate = {
  id: 1,
  name: "David Kim",
  email: "david.kim@example.com",
  phone: "+1 (555) 123-4567",
  location: "San Francisco, CA",
  currentCompany: "Netflix",
  yearsExperience: 8,
  avatar: "DK",
};

const profile = {
  recommendationReasoning:
    "Exceeds requirements in technical depth and AI collaboration. Strong contributor from day one.",
  roleFitScore: 0.91,
  cultureFitScore: 0.85,
  growthPotentialScore: 0.88,
};

const assessments = [
  { name: "SCREEN", status: "completed", score: 85, icon: Phone },
  { name: "AI COLLAB", status: "completed", score: 91, icon: Zap },
  { name: "CODE REV", status: "in_progress", score: null, icon: Code },
  { name: "PLANNING", status: "pending", score: null, icon: Users },
  { name: "VOICE", status: "pending", score: null, icon: Mic },
  { name: "PANEL", status: "pending", score: null, icon: Users },
];

export default function ProfileExample() {
  const [activeSection, setActiveSection] = React.useState("overview");
  const [isAgentOpen, setIsAgentOpen] = React.useState(false);

  return (
    <Layout
      header={
        <ProfileHeader
          title="CANDIDATE_PROFILE"
          subtitle="PIPE_OS // V.2.0.4"
        />
      }
      sidebar={
        <SidebarNav
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          isAgentOpen={isAgentOpen}
          onAgentToggle={() => setIsAgentOpen(!isAgentOpen)}
        />
      }
      agentPanel={
        <div style={{ padding: 24 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              color: "rgba(139, 92, 246, 0.8)",
              marginBottom: 8,
            }}
          >
            AI AGENT
          </div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#fff",
              margin: "0 0 24px 0",
            }}
          >
            Assistant
          </h2>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            Agent panel content goes here. This can be a chat interface or
            analysis tools.
          </p>
        </div>
      }
      isAgentOpen={isAgentOpen}
    >
      {/* Hero Grid */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr 200px",
          gap: 24,
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
              {candidate.avatar}
            </div>
          </div>

          {/* Contact info */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {[
              { icon: Briefcase, value: candidate.currentCompany },
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
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                <item.icon size={14} color="rgba(255,255,255,0.25)" />
                {item.value.toUpperCase()}
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
                }}
              >
                STRONG
                <br />
                YES
              </div>
            </div>

            <MetalScoreRing value={91} label="AVG" />
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
            {profile.recommendationReasoning}
          </div>
        </LiquidMetalCard>

        {/* Score Stack */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "ROLE", value: profile.roleFitScore },
            { label: "CULTURE", value: profile.cultureFitScore },
            { label: "GROWTH", value: profile.growthPotentialScore },
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

      {/* Assessment Pipeline */}
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
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 2,
          }}
        >
          {assessments.map((a, i) => {
            const Icon = a.icon;
            const isComplete = a.status === "completed";
            const isActive = a.status === "in_progress";

            return (
              <LiquidMetalCard
                key={i}
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
                  {a.name}
                </div>

                {isComplete && (
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
                    {a.score}
                  </div>
                )}
              </LiquidMetalCard>
            );
          })}
        </div>
      </section>

      {/* Signals + Skills */}
    </Layout>
  );
}
