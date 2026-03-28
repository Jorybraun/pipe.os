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
  Trash2,
} from "lucide-react";
import { RoleCard } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { useData } from '../providers';

type PipelineWithStats = {
  id: string;
  title: string;
  status?: string | null;
  level?: string | null;
  createdAt?: string;
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
  const dataFactory = useData();
  const [mounted, setMounted] = useState(false);
  const [pipelines, setPipelines] = useState<PipelineWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ACTIVE" | "DRAFT" | "ARCHIVED">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchPipelines = useCallback(async () => {
    const client = dataFactory.createClient();
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
        ],
      });

      const enrichedPipelines = (pipelineData as unknown as Array<{
        id: string;
        title: string;
        status?: string | null;
        level?: string | null;
        createdAt?: string;
        stages?: { id: string }[] | null;
        candidates?: { id: string }[] | null;
      }>).map((p) => {
        const avgScore = null;
        return {
          ...p,
          stageCount: p.stages?.length || 0,
          candidateCount: p.candidates?.length || 0,
          avgScore,
        };
      });

      setPipelines(enrichedPipelines as PipelineWithStats[]);
    } catch (err) {
      console.error("[ListingPage] Error fetching pipelines:", err);
    } finally {
      setIsLoading(false);
    }
  }, [dataFactory]);

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

  const handleDeletePipeline = async (id: string, title: string): Promise<void> => {
    if (!window.confirm(`Are you sure you want to delete the pipeline "${title}"? This action cannot be undone.`)) {
      return;
    }

    const client = dataFactory.createClient();
    try {
      setIsLoading(true);
      await client.models.Pipeline.delete({ id });
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetchPipelines();
    } catch (err) {
      console.error("[ListingPage] Error deleting pipeline:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;

    if (!window.confirm(`Delete ${count} selected pipeline${count > 1 ? 's' : ''}? This cannot be undone.`)) {
      return;
    }

    const client = dataFactory.createClient();
    try {
      setIsLoading(true);
      await Promise.all(
        Array.from(selectedIds).map(id => client.models.Pipeline.delete({ id }))
      );
      setSelectedIds(new Set());
      await fetchPipelines();
    } catch (err) {
      console.error("[ListingPage] Bulk delete error:", err);
      alert("Failed to delete some pipelines.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (id: string, isSelected: boolean) => {
    const next = new Set(selectedIds);
    if (isSelected) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredPipelines.length && filteredPipelines.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPipelines.map(p => p.id)));
    }
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
              <div 
                onClick={toggleAll}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
              >
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: `1.5px solid ${selectedIds.size > 0 ? "#8b5cf6" : "rgba(255,255,255,0.2)"}`,
                  background: selectedIds.size === filteredPipelines.length && filteredPipelines.length > 0 ? "#8b5cf6" : "transparent",
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {selectedIds.size > 0 && selectedIds.size < filteredPipelines.length && (
                    <div style={{ width: 6, height: 1.5, background: '#8b5cf6' }} />
                  )}
                  {selectedIds.size === filteredPipelines.length && filteredPipelines.length > 0 && (
                    <Check size={10} color="#fff" strokeWidth={4} />
                  )}
                </div>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
                  {selectedIds.size > 0 ? `${selectedIds.size}_SELECTED` : 'SELECT_ALL'}
                </span>
              </div>
              <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.05)' }} />
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
            {selectedIds.size > 0 && (
              <button 
                onClick={handleBulkDelete}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(255, 80, 80, 0.1)',
                  border: '1px solid rgba(255, 80, 80, 0.2)',
                  color: '#ff5050',
                  padding: '4px 12px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 80, 80, 0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 80, 80, 0.1)'}
              >
                <Trash2 size={14} />
                DELETE_SELECTED ({selectedIds.size})
              </button>
            )}
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
                  id={p.id}
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
                  createdAt={p.createdAt ?? new Date().toISOString()}
                  isSelected={selectedIds.has(p.id)}
                  onSelect={(sel) => toggleSelect(p.id, sel)}
                  onClick={() => handleRoleClick(p.id)}
                  onDelete={() => handleDeletePipeline(p.id, p.title)}
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
