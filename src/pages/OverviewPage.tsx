import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Outlet } from "react-router-dom";
import {
  CheckCircle,
  Activity,
  Code,
  FileText,
  Mic,
  Building,
  Copy,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { LiquidMetalCard } from "../components";
import { generateClient } from 'aws-amplify/data';
import type { Schema } from "../../amplify/data/resource";
import { useCandidateCreate } from "../hooks/useCandidateCreate";
import { FieldGroup, TextInput } from "../components/ui/form";
import { codeReviewSnippets } from "../content/codeReviewSnippets";

const client = generateClient<Schema>();

/**
 * OverviewPage - Kanban-style pipeline view showing candidates by stage
 */

// Map stage types to icons
const stageIcons: Record<string, typeof Code> = {
  CODE_REVIEW: Code,
  VOICE_INTERVIEW: Mic,
  PLANNING: FileText,
  QUIZ: FileText,
  AI_COLLAB: Zap,
};

// Stage header card
function StageHeaderCard({
  stage,
  candidates,
  isActive,
  onClick,
}: {
  stage: any;
  candidates: any[];
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = stageIcons[stage.type] || FileText;
  const scoredCandidates = candidates.filter(c => c.score !== undefined && c.score !== null);
  const avgScore = scoredCandidates.length > 0
    ? Math.round(
        scoredCandidates.reduce((sum, c) => sum + (c.score || 0), 0) / scoredCandidates.length
      )
    : null;

  return (
    <LiquidMetalCard
      data-testid="stage-card"
      variant={isActive ? "chrome" : "default"}
      hover
      onClick={onClick}
      style={{ padding: 24, cursor: "pointer" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <Icon size={20} color={isActive ? "#fff" : "rgba(255,255,255,0.4)"} />
        {isActive && (
          <Activity
            size={16}
            color="rgba(255,255,255,0.8)"
            style={{ animation: "pulse 1.5s ease-in-out infinite" }}
          />
        )}
      </div>

      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
          marginBottom: 12,
        }}
      >
        {stage.type.replace('_', ' ').toUpperCase()}
      </div>

      {avgScore !== null ? (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            background:
              "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {avgScore}
        </div>
      ) : (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            color: "rgba(255,255,255,0.15)",
          }}
        >
          —
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          height: 2,
          background: "rgba(255,255,255,0.06)",
        }}
      >
        {avgScore !== null && (
          <div
            style={{
              width: `${avgScore}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))",
              boxShadow: "0 0 10px rgba(255,255,255,0.2)",
            }}
          />
        )}
      </div>
    </LiquidMetalCard>
  );
}

// Candidate card
function CandidateKanbanCard({
  candidate,
  onClick,
  index,
  stageIndex,
}: {
  candidate: any;
  onClick: () => void;
  index: number;
  stageIndex: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setMounted(true),
      stageIndex * 100 + index * 80
    );
    return () => clearTimeout(timer);
  }, [stageIndex, index]);

  const handleCopyLink = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const inviteUrl = `${window.location.origin}/assess/${candidate.inviteToken}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [candidate.inviteToken]);

  const initials = (candidate.name || "")
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(15px)",
        transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <LiquidMetalCard
        variant="dark"
        hover
        onClick={onClick}
        style={{ marginBottom: 8, cursor: "pointer" }}
      >
        <div style={{ display: "flex" }}>
          <div
            style={{
              width: 80,
              padding: "20px 0",
              borderRight: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                background:
                  "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.6) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {initials}
            </span>
          </div>

          <div style={{ flex: 1, padding: "16px 20px" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "0.02em",
                marginBottom: 4,
              }}
            >
              {(candidate.name || "").toUpperCase()}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <Building size={10} color="rgba(255,255,255,0.25)" />
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.05em",
                  color: "rgba(255,255,255,0.4)",
                }}
              >
                {(candidate.email || "").toLowerCase()}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Activity size={10} color="rgba(255,255,255,0.25)" />
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.05em",
                  color: "rgba(255,255,255,0.4)",
                }}
              >
                {(candidate.status || "").toUpperCase()}
              </span>
            </div>
          </div>

          <div
            style={{
              width: 90,
              padding: 16,
              borderLeft: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            {candidate.status === 'INVITED' || candidate.status === 'IN_PROGRESS' ? (
              <button
                onClick={handleCopyLink}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copied ? '#10b981' : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.2s ease',
                }}
              >
                {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                <span style={{ fontSize: 7, letterSpacing: '0.1em' }}>
                  {copied ? 'COPIED!' : 'COPY LINK'}
                </span>
              </button>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    color: "#fff",
                  }}
                >
                  {candidate.score || 0}
                </div>
                <span
                  style={{
                    fontSize: 7,
                    letterSpacing: "0.15em",
                    marginTop: 4,
                    color: "rgba(255,255,255,0.4)",
                  }}
                >
                  SCORE
                </span>
              </>
            )}
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}

export default function OverviewPage(): JSX.Element {
  const { id, stage: activeStageId } = useParams<{
    id: string;
    stage?: string;
  }>();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [pipeline, setPipeline] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add Candidate Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ name: '', email: '' });
  const { create: createCandidate, isSubmitting: isAdding } = useCandidateCreate();

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [pipelineData, candidatesData, stagesData] = await Promise.all([
        client.models.Pipeline.get({ id }),
        client.models.Candidate.list({ filter: { pipelineId: { eq: id } } }),
        client.models.Stage.list({ filter: { pipelineId: { eq: id } } }),
      ]);

      setPipeline(pipelineData.data);
      setCandidates(candidatesData.data);
      setStages(stagesData.data.sort((a, b) => (a.order || 0) - (b.order || 0)));
    } catch (error) {
      console.error("Error fetching pipeline data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setMounted(true);
    fetchData();
  }, [fetchData]);

  const handleAddCandidate = async () => {
    if (!id || !newCandidate.name || !newCandidate.email) return;
    const result = await createCandidate({
      pipelineId: id,
      name: newCandidate.name,
      email: newCandidate.email,
    });
    if (result) {
      setNewCandidate({ name: '', email: '' });
      setShowAddForm(false);
      fetchData(); // Refresh list
    }
  };

  const handleClearStages = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      // Fetch all stages first
      const { data: stagesToDelete } = await client.models.Stage.list({
        filter: { pipelineId: { eq: id } }
      });
      // Delete them
      await Promise.all(stagesToDelete.map(s => client.models.Stage.delete({ id: s.id })));
      await fetchData();
    } catch (err) {
      console.error("Failed to clear stages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeedStage = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      // 1. CODE_REVIEW
      await client.models.Stage.create({
        pipelineId: id,
        type: 'CODE_REVIEW',
        order: 0,
        config: {
          renderer: 'DIFF_VIEW',
          snippets: codeReviewSnippets.map(s => ({
            id: s.id,
            title: s.title,
            code: s.code,
            language: s.language,
            groundTruth: s.groundTruth,
          }))
        },
      });

      // 2. QUIZ
      await client.models.Stage.create({
        pipelineId: id,
        type: 'QUIZ',
        order: 1,
        config: {
          questions: [
            {
              q: "What is the primary difference between 'let' and 'var' in JavaScript?",
              options: [
                "let is block-scoped, var is function-scoped",
                "var is block-scoped, let is function-scoped",
                "let cannot be reassigned, var can",
                "There is no difference"
              ],
              correct: 0
            },
            {
              q: "In React, what is the purpose of useEffect's dependency array?",
              options: [
                "To list all variables used in the effect",
                "To control when the effect should re-run",
                "To define the order of execution",
                "To store previous state values"
              ],
              correct: 1
            }
          ]
        },
      });

      await fetchData();
    } catch (err) {
      console.error("Failed to seed stages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Group candidates by their current stage
  const candidatesByStage = stages.reduce((acc, s, idx) => {
    acc[s.id] = candidates.filter(c => {
      // For MVP simplicity:
      // If it's the first stage, show candidates who are INVITED or IN_PROGRESS
      if (idx === 0 && (c.status === 'INVITED' || c.status === 'IN_PROGRESS')) {
        return true;
      }
      // If it's the last stage, show candidates who are COMPLETED
      if (idx === stages.length - 1 && c.status === 'COMPLETED') {
        return true;
      }
      return false;
    });
    return acc;
  }, {} as Record<string, any[]>);

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
        LOADING_PIPELINE...
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <h2 style={{ color: '#fff', marginBottom: 20 }}>Pipeline Not Found</h2>
        <button onClick={() => navigate("/")} style={{ color: '#fff', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', padding: '10px 20px', cursor: 'pointer' }}>Back to Roles</button>
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
      {/* Page Header with Add Candidate button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>PIPELINE_OVERVIEW</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>{pipeline.title}</h1>
        </div>

        {!showAddForm && (
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handleClearStages}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.4)',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: 'Space Mono',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
              CLEAR_STAGES
            </button>
            {stages.length === 0 && (
              <button
                onClick={handleSeedStage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  background: 'rgba(255,100,100,0.1)',
                  border: '1px solid rgba(255,100,100,0.2)',
                  color: '#ffaaaa',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  fontFamily: 'Space Mono',
                  cursor: 'pointer',
                }}
              >
                <Code size={14} />
                SEED_MVP_STAGES
              </button>
            )}
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: 'Space Mono',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            >
              <Plus size={14} />
              ADD_CANDIDATE
            </button>
          </div>
        )}
      </div>

      {/* Add Candidate Form (Inline Modal-ish) */}
      {showAddForm && (
        <div style={{ marginBottom: 32 }}>
          <LiquidMetalCard variant="chrome">
            <div style={{ padding: 32, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <FieldGroup label="CANDIDATE_NAME">
                  <TextInput
                    value={newCandidate.name}
                    onChange={v => setNewCandidate(prev => ({ ...prev, name: v }))}
                    placeholder="Enter name..."
                  />
                </FieldGroup>
              </div>
              <div style={{ flex: 1 }}>
                <FieldGroup label="EMAIL_ADDRESS">
                  <TextInput
                    value={newCandidate.email}
                    onChange={v => setNewCandidate(prev => ({ ...prev, email: v }))}
                    placeholder="Enter email..."
                  />
                </FieldGroup>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                <button
                  onClick={() => setShowAddForm(false)}
                  style={{
                    padding: '10px',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                  }}
                >
                  <X size={16} />
                </button>
                <button
                  onClick={handleAddCandidate}
                  disabled={isAdding || !newCandidate.name || !newCandidate.email}
                  style={{
                    padding: '10px 24px',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    fontFamily: 'Space Mono',
                    cursor: 'pointer',
                  }}
                >
                  {isAdding ? 'ADDING...' : 'ADD_CANDIDATE'}
                </button>
              </div>
            </div>
          </LiquidMetalCard>
        </div>
      )}

      {/* Stage headers */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {stages.map((s) => (
          <div key={s.id} style={{ flex: 1, minWidth: 280 }}>
            <StageHeaderCard
              stage={s}
              candidates={candidatesByStage[s.id] || []}
              isActive={activeStageId === s.id}
              onClick={() => navigate(`/pipeline/${id}/${s.id}`)}
            />
          </div>
        ))}
      </div>

      {/* Content area */}
      {activeStageId ? (
        <Outlet />
      ) : (
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 24,
          }}
        >
          {stages.map((s, i) => {
            const stageCandidates = candidatesByStage[s.id] || [];
            return (
              <div
                key={s.id}
                style={{
                  flex: 1,
                  minWidth: 280,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {stageCandidates.map((candidate: any, idx: number) => (
                  <CandidateKanbanCard
                    key={candidate.id}
                    candidate={candidate}
                    index={idx}
                    stageIndex={i}
                    onClick={() => navigate(`/candidates/${candidate.id}`)}
                  />
                ))}

                {stageCandidates.length === 0 && (
                  <div
                    style={{
                      flex: 1,
                      minHeight: 120,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px dashed rgba(255,255,255,0.08)",
                    }}
                  >
                    <span style={{ fontSize: 8, letterSpacing: "0.2em", color: "rgba(255,255,255,0.2)" }}>
                      NO CANDIDATES
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
