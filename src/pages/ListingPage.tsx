import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
} from "lucide-react";
import { RoleCard, LiquidMetalCard } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { generateClient } from 'aws-amplify/data';
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type PipelineWithStats = Schema['Pipeline']['type'] & {
  candidateCount: number;
  stageCount: number;
  avgScore: number | null;
};

const ListingSkeleton = () => (
  <div style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
    gap: 16,
  }}>
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <LiquidMetalCard key={i} style={{ minHeight: 280, padding: 0 }}>
        <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Skeleton width={60} height={16} style={{ marginBottom: 16 }} />
          <Skeleton width="80%" height={24} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton width="40%" height={10} />
            <Skeleton width="30%" height={10} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ padding: 20, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <Skeleton width={40} height={8} style={{ marginBottom: 8 }} />
            <Skeleton width={30} height={28} />
          </div>
          <div style={{ padding: 20, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <Skeleton width={40} height={8} style={{ marginBottom: 8 }} />
            <Skeleton width={30} height={28} />
          </div>
          <div style={{ padding: 20 }}>
            <Skeleton width={40} height={8} style={{ marginBottom: 8 }} />
            <Skeleton width={30} height={28} />
          </div>
        </div>
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between' }}>
          <Skeleton width={80} height={10} />
          <Skeleton width={60} height={10} />
        </div>
      </LiquidMetalCard>
    ))}
  </div>
);

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
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState<"all" | "ACTIVE" | "DRAFT" | "ARCHIVED">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPipelines = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Use selectionSet to batch load related stages and candidates in one trip
      const { data: pipelineData } = await client.models.Pipeline.list({
        selectionSet: [
          'id',
          'title',
          'status',
          'level',
          'createdAt',
          'stages.id',
          'stages.title',
          'stages.order',
          'candidates.id',
          'candidates.name',
          'candidates.assessments.score',
        ],
      });
      
      const enrichedPipelines = pipelineData.map((p) => {
        // Calculate average score across all candidates in all assessments for this pipeline
        let totalScore = 0;
        let scoreCount = 0;

        p.candidates?.forEach(cand => {
          cand.assessments?.forEach(ass => {
            if (typeof ass.score === 'number') {
              totalScore += ass.score;
              scoreCount++;
            }
          });
        });

        const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : null;

        return {
          ...p,
          stageCount: p.stages?.length || 0,
          candidateCount: p.candidates?.length || 0,
          avgScore,
        };
      });

      setPipelines(enrichedPipelines as unknown as PipelineWithStats[]);
    } catch (err) {
      console.error("[ListingPage] Error fetching pipelines:", err);
      setError(err instanceof Error ? err : new Error("Failed to load pipelines"));
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
    return <ListingSkeleton />;
  }

  if (error) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 400, padding: 40, textAlign: 'center' }}>
          <div style={{ color: '#f87171', marginBottom: 16, fontSize: 12, fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            ERROR_LOADING_PIPELINES
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            {error.message}
          </p>
          <button
            onClick={() => fetchPipelines()}
            style={{
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer'
            }}
          >
            RETRY_CONNECTION
          </button>
        </LiquidMetalCard>
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
