import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  Loader2,
} from "lucide-react";
import { RoleCard, LiquidMetalCard } from "../components";
import { generateClient } from 'aws-amplify/data';
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type PipelineWithStats = Schema['Pipeline']['type'] & {
  candidateCount: number;
  stageCount: number;
  avgScore: number | null;
};

/**
 * ListingPage - Main entry point showing all roles/pipelines
 *
 * Features:
 * - Stats cards showing overview metrics
 * - Search and filter functionality
 * - Grid of role cards
 * - Navigation to pipeline builder and detail views
 *
 * Note: Layout is provided by AppLayout wrapper in App.tsx
 */
export default function ListingPage(): JSX.Element {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [pipelines, setPipelines] = useState<PipelineWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ACTIVE" | "DRAFT" | "ARCHIVED">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPipelines = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data: pipelineData } = await client.models.Pipeline.list();
      
      const enrichedPipelines = await Promise.all(
        pipelineData.map(async (p) => {
          const [stages, candidates] = await Promise.all([
            client.models.Stage.list({ filter: { pipelineId: { eq: p.id } } }),
            client.models.Candidate.list({ filter: { pipelineId: { eq: p.id } } }),
          ]);

          // Calculate average score for candidates who have one
          const scoredCandidates = candidates.data.filter(c => (c as any).score !== undefined && (c as any).score !== null);
          const avgScore = scoredCandidates.length > 0 
            ? Math.round(scoredCandidates.reduce((acc, c) => acc + ((c as any).score || 0), 0) / scoredCandidates.length)
            : null;

          return {
            ...p,
            stageCount: stages.data.length,
            candidateCount: candidates.data.length,
            avgScore,
          };
        })
      );

      setPipelines(enrichedPipelines);
    } catch (err) {
      console.error("[ListingPage] Error fetching pipelines:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    fetchPipelines();
  }, [fetchPipelines]);

  // Filter and search roles
  const filteredPipelines = pipelines.filter((p) => {
    const matchesFilter = filter === "all" || p.status === filter;
    const matchesSearch =
      searchQuery === "" ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleRoleClick = (id: string): void => {
    navigate(`/pipeline/${id}`);
  };

  if (isLoading && pipelines.length === 0) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 className="animate-spin" size={32} color="rgba(255,255,255,0.2)" />
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace' }}>
            FETCHING_PIPELINES...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Filter Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.4s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{ width: 6, height: 6, background: "rgba(255,255,255,0.4)" }}
          />
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.3em",
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
            }}
          >
            ALL_ROLES
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Search */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <Search size={12} color="rgba(255,255,255,0.3)" />
            <input
              type="text"
              placeholder="Search roles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#fff",
                fontSize: 10,
                letterSpacing: "0.1em",
                fontFamily: '"Space Mono", monospace',
                width: 120,
              }}
            />
          </div>

          {/* Filter buttons */}
          <div style={{ display: "flex", gap: 2 }}>
            {(["all", "ACTIVE", "DRAFT", "ARCHIVED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "8px 14px",
                  background:
                    filter === f ? "rgba(255,255,255,0.1)" : "transparent",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: filter === f ? "#fff" : "rgba(255,255,255,0.4)",
                  fontSize: 8,
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Roles Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 16,
        }}
      >
        {filteredPipelines.map((p) => (
          <RoleCard
            key={p.id}
            title={p.title}
            department={p.level || "Seniority"}
            location="REMOTE"
            status={
              p.status === "ARCHIVED"
                ? "closed"
                : (p.status?.toLowerCase() as "active" | "draft" | "closed")
            }
            candidates={p.candidateCount}
            avgScore={p.avgScore}
            stagesConfigured={p.stageCount}
            totalStages={p.stageCount || 1}
            createdAt={p.createdAt}
            onClick={() => handleRoleClick(p.id)}
          />
        ))}

        {/* Create New Role Card */}
        <div
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(20px)",
            transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${
              filteredPipelines.length * 80
            }ms`,
          }}
        >
          <LiquidMetalCard
            variant="default"
            hover
            onClick={() => navigate("/pipeline/new")}
            style={{
              minHeight: 280,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed rgba(255,255,255,0.15)",
              cursor: 'pointer'
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <Plus size={24} color="rgba(255,255,255,0.4)" />
            </div>
            <div
              style={{
                fontSize: 12,
                letterSpacing: "0.15em",
                color: "rgba(255,255,255,0.5)",
                marginBottom: 8,
              }}
            >
              CREATE NEW ROLE
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              Set up a new hiring pipeline
            </div>
          </LiquidMetalCard>
        </div>
      </div>
      
      <style>{`
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
