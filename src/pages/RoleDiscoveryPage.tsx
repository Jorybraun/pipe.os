import { useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { AgentPanel } from "../components/RoleDiscovery/AgentPanel";
import { BaselineForm } from "../components/RoleDiscovery/BaselineForm";
import type {
  RoleDiscoveryData,
  RoleBaseline,
  RoleDynamicContext,
  RoleDiscoveryProgress,
} from "../types/roleDiscovery";

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
      <div
        style={{
          display: "flex",
          position: "relative",
        }}
      >
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
          {/* Stats Bar */}
          {/* <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 32,
              marginBottom: 32,
              paddingBottom: 20,
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              opacity: mounted ? 1 : 0,
              transition: "opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.2em",
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 6,
                }}
              >
                SECTIONS
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  background:
                    "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {Object.keys(sections).length}
              </div>
            </div>
            <div
              style={{
                width: 1,
                height: 40,
                background: "rgba(255,255,255,0.08)",
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.2em",
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 6,
                }}
              >
                COMPLETE
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  background:
                    progress.completeness >= 60
                      ? "linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)"
                      : "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {progress.completeness}%
              </div>
            </div>
            <div
              style={{
                width: 1,
                height: 40,
                background: "rgba(255,255,255,0.08)",
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.2em",
                  color: "rgba(255,255,255,0.3)",
                  marginBottom: 6,
                }}
              >
                GAPS
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  background:
                    progress.gaps.length === 0
                      ? "linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)"
                      : "linear-gradient(180deg, rgba(255,200,100,0.9) 0%, rgba(255,200,100,0.6) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {progress.gaps.length}
              </div>
            </div>
          </div> */}

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
