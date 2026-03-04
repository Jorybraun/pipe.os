import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
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
  <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px' }}>
    <Skeleton width={120} height={10} style={{ marginBottom: 12 }} />
    <Skeleton width={300} height={40} style={{ marginBottom: 48 }} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Skeleton key={i} height={80} style={{ borderRadius: 8 }} />
      ))}
    </div>
  </div>
);

/**
 * ListingPage - Main entry point showing all roles/pipelines.
 * Refactored to match the airy, glassy design of the rest of the platform.
 */
export default function ListingPage(): JSX.Element {
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState<PipelineWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ACTIVE" | "DRAFT" | "ARCHIVED">("all");
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
    fetchPipelines();
  }, [fetchPipelines]);

  const filteredPipelines = useMemo(() => {
    return pipelines.filter((p) => {
      const matchesFilter = filter === "all" || p.status === filter;
      const matchesSearch = searchQuery === "" || p.title.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [pipelines, filter, searchQuery]);

  if (isLoading && pipelines.length === 0) {
    return <ListingSkeleton />;
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px 100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            RECRUITMENT_PIPELINES
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', margin: 0 }}>
            Active Roles
          </h1>
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace', marginTop: 8 }}>
          {filteredPipelines.length} total
        </div>
      </div>

      {/* Filter & Action Bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', padding: 2, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
          {(["all", "ACTIVE", "DRAFT", "ARCHIVED"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '8px 16px',
                background: filter === f ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                borderRadius: 4,
                color: filter === f ? '#fff' : 'rgba(255,255,255,0.3)',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'Space Mono',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textTransform: 'uppercase'
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
          <Search size={14} color="rgba(255,255,255,0.2)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by role title..."
            style={{
              width: '100%',
              padding: '10px 16px 10px 36px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 12,
              fontFamily: 'Space Mono',
              outline: 'none'
            }}
          />
        </div>

        <button
          onClick={() => navigate("/pipeline/new")}
          style={{
            padding: '10px 24px',
            background: '#fff',
            border: 'none',
            borderRadius: 6,
            color: '#000',
            fontSize: 10,
            fontWeight: 800,
            fontFamily: 'Space Mono',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <Plus size={14} /> NEW_PIPELINE
        </button>
      </div>

      {/* Roles List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredPipelines.length === 0 ? (
          <div style={{ padding: 64, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12 }}>
             <p style={{ color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>No pipelines found.</p>
          </div>
        ) : (
          filteredPipelines.map(p => (
            <RoleCard
              key={p.id}
              title={p.title}
              department={p.level || "UNSPECIFIED"}
              status={p.status as any}
              candidates={p.candidateCount}
              avgScore={p.avgScore}
              stagesConfigured={p.stageCount}
              totalStages={p.stageCount || 1}
              createdAt={p.createdAt}
              onClick={() => navigate(`/pipeline/${p.id}`)}
            />
          ))
        )}
      </div>
    </div>
  );
}
