import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  Filter,
  Check,
  Activity,
  Briefcase,
  Users,
} from "lucide-react";
import { RoleCard } from "../components";
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
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Skeleton key={i} height={80} style={{ borderRadius: 8 }} />
    ))}
  </div>
);

/**
 * ListingPage - Roles overview with a mixture of Pipeline Builder layout 
 * and Meetings Page list style.
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
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    fetchPipelines();
  }, [fetchPipelines]);

  const filteredPipelines = pipelines.filter((p) => {
    const matchesFilter = filter === "all" || p.status === filter;
    const matchesSearch =
      searchQuery === "" ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const stats = useMemo(() => {
    return {
      active: pipelines.filter(p => p.status === 'ACTIVE').length,
      draft: pipelines.filter(p => p.status === 'DRAFT').length,
      totalCandidates: pipelines.reduce((acc, p) => acc + p.candidateCount, 0)
    };
  }, [pipelines]);

  const handleRoleClick = (id: string): void => {
    navigate(`/pipeline/${id}`);
  };

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      {/* Page Header (Meetings Page style) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            RECRUITMENT_PIPELINES
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', margin: 0 }}>
            Active Roles
          </h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
            {pipelines.length} roles total
          </span>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#34d399', fontFamily: '"Space Mono", monospace' }}>
                <Activity size={12} />
                {stats.active} ACTIVE
             </div>
             <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace' }}>
                <Users size={12} />
                {stats.totalCandidates} CANDIDATES
             </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, position: 'relative' }}>
        {/* Main List Area (Pipeline Builder layout) */}
        <section style={{ flex: 1 }}>
          {/* List Search & Controls */}
          <div style={{ 
            display: 'flex', 
            gap: 12, 
            marginBottom: 20,
            padding: '12px 16px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 8
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <Search size={14} color="rgba(255,255,255,0.2)" />
              <input
                type="text"
                placeholder="SEARCH_BY_TITLE..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#fff',
                  fontSize: 11,
                  letterSpacing: '0.05em',
                  fontFamily: '"Space Mono", monospace',
                  width: '100%',
                }}
              />
            </div>
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />
            <button 
              onClick={() => navigate("/pipeline/new")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                color: '#a78bfa',
                padding: '4px 12px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: '"Space Mono", monospace'
              }}
            >
              <Plus size={14} />
              NEW_ROLE
            </button>
          </div>

          {/* Roles List */}
          {isLoading ? (
            <ListingSkeleton />
          ) : filteredPipelines.length === 0 ? (
            <div style={{ 
              padding: 64, 
              textAlign: 'center', 
              border: '1px dashed rgba(255,255,255,0.08)',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.01)'
            }}>
              <Briefcase size={40} color="rgba(255,255,255,0.12)" style={{ marginBottom: 16 }} />
              <p style={{ color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
                NO_ROLES_FOUND
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {filteredPipelines.map((p) => (
                <RoleCard
                  key={p.id}
                  title={p.title}
                  department={p.level || "Engineering"}
                  location="Remote"
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
            </div>
          )}
        </section>

        {/* Sidebar Configuration (Discovery Page style) */}
        <aside style={{ width: 340 }}>
           <div 
             style={{ 
               padding: 24,
               height: 'fit-content',
               background: 'rgba(255, 255, 255, 0.03)',
               backdropFilter: 'blur(40px) saturate(150%)',
               border: '1px solid rgba(255, 255, 255, 0.1)',
               borderRadius: 16,
               boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
               display: 'flex',
               flexDirection: 'column',
               gap: 24
             }}
           >
             <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Filter size={14} color="#8b5cf6" />
                <h3 style={{ 
                  fontSize: 10, 
                  letterSpacing: '0.2em', 
                  color: '#fff', 
                  textTransform: 'uppercase',
                  fontFamily: '"Space Mono", monospace',
                  fontWeight: 700
                }}>
                  FILTER_CONTROLS
                </h3>
             </div>

             <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(["all", "ACTIVE", "DRAFT", "ARCHIVED"] as const).map((f) => (
                  <div 
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: '12px 16px',
                      background: filter === f ? 'rgba(139, 92, 246, 0.1)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${filter === f ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      borderRadius: 4
                    }}
                  >
                    <span style={{ 
                      fontSize: 10, 
                      color: filter === f ? '#fff' : 'rgba(255,255,255,0.4)',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      fontFamily: '"Space Mono", monospace'
                    }}>
                      {f === 'all' ? 'ALL_STATUS' : f}
                    </span>
                    {filter === f && <Check size={12} color="#a78bfa" />}
                  </div>
                ))}
             </div>

             <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

             {/* Sidebar Info/Stats */}
             <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  PIPELINE_INSIGHTS
                </span>
                <div style={{ 
                  padding: 16, 
                  background: 'rgba(139, 92, 246, 0.03)', 
                  border: '1px solid rgba(139, 92, 246, 0.1)',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>Total Active Roles</span>
                    <span style={{ fontSize: 10, color: '#fff', fontWeight: 700, fontFamily: 'Space Mono' }}>{stats.active}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>Draft Pipelines</span>
                    <span style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700, fontFamily: 'Space Mono' }}>{stats.draft}</span>
                  </div>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>Conversion Rate</span>
                    <span style={{ fontSize: 10, color: '#34d399', fontWeight: 700, fontFamily: 'Space Mono' }}>24.2%</span>
                  </div>
                </div>
             </div>
           </div>
        </aside>
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
