import { useState, useEffect, Fragment } from "react";
import { Activity, ArrowRight, Check, CheckCircle } from "lucide-react";
import AgentPanel from "../components/RoleDiscovery/AgentPanel";
import { BaselineForm } from "../components/RoleDiscovery/BaselineForm";
import type {
  RoleDiscoveryData,
  RoleBaseline,
  RoleDynamicContext,
  RoleDiscoveryProgress,
} from "../types/roleDiscovery";
import { LiquidMetalCard } from "../components";
import { mockStages } from "../mocks";

function PhaseProgress({ current }) {
  const phases = ["ROLE DISCOVERY", "PIPELINE STAGES", "QUESTIONS", "METRICS"];

  return (
    <div
      style={{
        padding: "0px 0px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      {phases.map((phase, i) => {
        const isActive = i === current - 1;
        const isComplete = i < current - 1;
        return (
          <Fragment key={phase}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  background: isComplete
                    ? "rgba(150,255,150,0.2)"
                    : isActive
                    ? "rgba(139,92,246,0.3)"
                    : "rgba(255,255,255,0.05)",
                  border: `1px solid ${
                    isComplete
                      ? "rgba(150,255,150,0.4)"
                      : isActive
                      ? "rgba(139,92,246,0.5)"
                      : "rgba(255,255,255,0.1)"
                  }`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isComplete
                    ? "rgba(150,255,150,0.9)"
                    : isActive
                    ? "rgba(139,92,246,0.9)"
                    : "rgba(255,255,255,0.3)",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {isComplete ? <Check size={14} /> : i + 1}
              </div>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                  fontWeight: isActive ? 700 : 400,
                }}
              >
                {phase}
              </span>
            </div>
            {i < phases.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: isComplete
                    ? "rgba(150,255,150,0.3)"
                    : "rgba(255,255,255,0.08)",
                  maxWidth: 50,
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * RoleDiscoveryPage - Phase 1: Role Discovery
 *
 * Two-part flow for gathering role context:
 * 1. Structured Baseline (7 required fields)
 * 2. Dynamic Agent Exploration (contextual Q&A)
 *
 * Features:
 * - Collapsible form sections with completion indicators
 * - Real-time progress calculation
 * - Agent chat interface (Phase 1A: mock responses)
 * - Role model visualization
 * - 60% completion threshold to proceed to Phase 2
 *
 * Route: /pipeline/new
 *
 * Timeline:
 * - Phase 1A (current): Layout with dummy data, no LLM integration
 * - Phase 1B (future): Live LLM-powered agent
 * - Phase 1C (future): Internal testing and refinement
 */
export default function RoleDiscoveryPage(): JSX.Element {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<Partial<RoleDiscoveryData>>({});
  const [openSection, setOpenSection] = useState<string>("identity");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Update a single field
  const handleChange = (
    field: keyof RoleDiscoveryData,
    value: string | string[]
  ): void => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  // Field definitions for each section
  const sections = {
    identity: ["title", "level", "department", "location"] as const,
    team: ["teamSize", "reportsTo"] as const,
    tech: ["stack"] as const,
    success: ["successCriteria"] as const,
    challenges: ["challenges"] as const,
    culture: ["culture"] as const,
  };

  // Check if a section is complete (all required fields filled)
  const isSectionComplete = (sectionId: string): boolean => {
    const fields = sections[sectionId as keyof typeof sections];
    if (!fields) return false;

    return fields.every((field) => {
      const value = data[field];
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value?.toString().trim();
    });
  };

  // Calculate progress
  const calculateProgress = (): RoleDiscoveryProgress => {
    const allFields = Object.values(sections).flat();
    const filledFields = allFields.filter((field) => {
      const value = data[field];
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value?.toString().trim();
    }).length;

    const completeness = Math.round((filledFields / allFields.length) * 100);
    const isReady = completeness >= 60;

    const gaps: string[] = [];
    if (!isSectionComplete("identity")) gaps.push("Role identity incomplete");
    if (!isSectionComplete("team")) gaps.push("Team context incomplete");
    if (!isSectionComplete("tech"))
      gaps.push("Technical environment incomplete");
    if (!isSectionComplete("success")) gaps.push("Success criteria undefined");

    return {
      completeness,
      isReady,
      gaps,
      filledFields,
      totalFields: allFields.length,
    };
  };

  const progress = calculateProgress();

  // Extract baseline data (7 required fields)
  const baseline: RoleBaseline | null =
    isSectionComplete("identity") &&
    isSectionComplete("team") &&
    isSectionComplete("tech")
      ? {
          title: data.title!,
          level: data.level!,
          department: data.department!,
          location: data.location!,
          teamSize: data.teamSize!,
          reportsTo: data.reportsTo!,
          stack: data.stack!,
        }
      : null;

  // Extract dynamic context (optional enrichment fields)
  const context: RoleDynamicContext = {};
  if (data.successCriteria) context.successCriteria = data.successCriteria;
  if (data.challenges) context.challenges = data.challenges;
  if (data.culture) context.culture = data.culture;

  const handleContinue = (): void => {
    if (progress.isReady) {
      console.log("[RoleDiscovery] Ready to proceed to Phase 2", {
        baseline,
        context,
        progress,
      });
      // TODO: Navigate to Phase 2 (Pipeline Builder)
      // navigate('/pipeline/:id/builder')
    }
  };

  return (
    <>
      {/* <div
        style={{
          display: "flex",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          {mockStages.map((stage) => {
            const Icon = stage.icon;
            const isComplete = stage.status === "COMPLETED";
            const isActive = stage.status === "ACTIVE";

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
      </div> */}

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {/* Left Panel - Agent */}
        <AgentPanel
          baseline={baseline}
          context={context}
          progress={progress.completeness}
          gaps={progress.gaps}
        />

        {/* Main Content - Form */}
        <main
          style={{
            flex: 1,
            padding: "0 32px 120px",
            position: "relative",
            zIndex: 1,
          }}
        >
          <PhaseProgress current={1} />
          {/* Form Sections */}
          <BaselineForm
            data={data}
            onChange={handleChange}
            openSection={openSection}
            onSectionToggle={setOpenSection}
            isComplete={isSectionComplete}
          />
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.25); }
        input:focus, textarea:focus, select:focus { border-color: rgba(139, 92, 246, 0.5) !important; outline: none; }
        select option { background: #1a1a24; color: #fff; }
      `}</style>
    </>
  );
}
