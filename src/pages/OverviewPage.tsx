import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  CheckCircle,
  Activity,
  Code,
  FileText,
  Building,
  Copy,
  Plus,
  X,
  Calendar,
  Video,
  ExternalLink,
  Clock,
} from "lucide-react";
import { LiquidMetalCard } from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { generateClient } from 'aws-amplify/data';
import type { Schema } from "../../amplify/data/resource";
import { useCandidateCreate } from "../hooks/useCandidateCreate";
import { FieldGroup, TextInput } from "../components/ui/form";
import { useSchedulingConnection } from "../hooks/useSchedulingConnection";

const client = generateClient<Schema>();

const OverviewSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: 40 }}>
    {/* Header Skeleton */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <div>
        <Skeleton width={100} height={8} style={{ marginBottom: 12 }} />
        <Skeleton width={200} height={32} />
      </div>
      <Skeleton width={120} height={40} />
    </div>

    {/* Stage Headers Skeleton */}
    <div style={{ display: 'flex', gap: 12 }}>
      {[1, 2, 3].map(i => (
        <LiquidMetalCard key={i} style={{ flex: 1, minWidth: 280, height: 180, padding: 24 }}>
          <Skeleton width={20} height={20} style={{ marginBottom: 24 }} />
          <Skeleton width={80} height={8} style={{ marginBottom: 16 }} />
          <Skeleton width={60} height={42} />
          <Skeleton width="100%" height={2} style={{ marginTop: 20 }} />
        </LiquidMetalCard>
      ))}
    </div>
  </div>
);

/**
 * OverviewPage - Kanban-style pipeline view showing candidates by stage
 */

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
  const Icon = FileText;
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
        {(stage.title || 'STAGE').toUpperCase()}
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
  onInvite,
  isInviting,
  interview,
}: {
  candidate: any;
  onClick: () => void;
  onInvite?: () => void;
  isInviting?: boolean;
  interview?: any;
}) {
  const [copied, setCopied] = useState(false);

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

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString([], { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div>
      <LiquidMetalCard
        variant="dark"
        hover
        onClick={onClick}
        style={{ marginBottom: 8, cursor: "pointer", position: 'relative' }}
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
            
            {/* INTERVIEW STATUS & TIME BADGE */}
            {interview ? (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 12px',
                  background: interview.status === 'INVITED' ? 'rgba(251,191,36,0.08)' : 'rgba(96,165,250,0.08)',
                  border: `1px solid ${interview.status === 'INVITED' ? 'rgba(251,191,36,0.2)' : 'rgba(96,165,250,0.2)'}`,
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={10} color={interview.status === 'INVITED' ? '#fbbf24' : '#60a5fa'} />
                    <span style={{ fontSize: 8, fontWeight: 800, color: interview.status === 'INVITED' ? '#fbbf24' : '#60a5fa', letterSpacing: '0.12em', fontFamily: 'Space Mono' }}>
                      {interview.status}
                    </span>
                  </div>
                  {interview.status === 'SCHEDULED' && <Video size={10} color="#60a5fa" />}
                </div>

                {interview.status === 'SCHEDULED' && interview.scheduledAt ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={10} color="rgba(255,255,255,0.6)" />
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: 'Space Mono' }}>
                      {formatTime(interview.scheduledAt)}
                    </div>
                  </div>
                ) : interview.status === 'INVITED' && (interview.emailSentAt || interview.createdAt) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={10} color="rgba(255,255,255,0.3)" />
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', fontFamily: 'Space Mono' }}>
                      SENT: {formatTime(interview.emailSentAt || interview.createdAt)}
                    </div>
                  </div>
                ) : null}

                {interview.meetingUrl && (
                  <a
                    href={interview.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ 
                      fontSize: 8, 
                      color: '#60a5fa', 
                      textDecoration: 'none', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 4,
                      marginTop: 2,
                      fontWeight: 700,
                      letterSpacing: '0.05em'
                    }}
                  >
                    JOIN_MEETING <ExternalLink size={8} />
                  </a>
                )}
              </div>
            ) : (
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
            )}
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
              gap: 6,
            }}
          >
            {!interview && (candidate.status === 'INVITED' || candidate.status === 'IN_PROGRESS') ? (
              <>
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
                {onInvite && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onInvite(); }}
                    disabled={isInviting}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: isInviting ? 'rgba(255,255,255,0.2)' : '#a78bfa',
                      cursor: isInviting ? 'default' : 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <Video size={16} />
                    <span style={{ fontSize: 7, letterSpacing: '0.1em' }}>
                      {isInviting ? 'INVITING' : 'INTERVIEW'}
                    </span>
                  </button>
                )}
              </>
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // False until we confirm Phase 14 schema fields exist in the deployed sandbox.
  const [schemaReady, setSchemaReady] = useState(false);

  // Scheduling Connection for provider resolution
  const { connection, fetchEventTypes } = useSchedulingConnection();

  // Add Candidate Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ name: '', email: '' });
  const { create: createCandidate, isSubmitting: isAdding } = useCandidateCreate();

  // Upcoming scheduled interviews for this pipeline (status=SCHEDULED)
  const [upcomingInterviews, setUpcomingInterviews] = useState<any[]>([]);

  // Invite-to-interview state
  const [invitingCandidateId, setInvitingCandidateId] = useState<string | null>(null);

  const handleAddStage = async () => {
    if (!id) return;
    
    const title = window.prompt("Enter new stage name:");
    if (!title || title.trim() === '') return;
    
    setIsLoading(true);
    try {
      await client.models.Stage.create({
        pipelineId: id,
        title: title.trim(),
        order: stages.length,
      });
      await fetchData();
    } catch (err) {
      console.error("Failed to add stage:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);

      // Probe schema for new fields inline (avoids cascading state updates)
      let hasNewFields = schemaReady;
      if (!hasNewFields) {
        try {
          await client.models.Stage.list({
            limit: 1,
            selectionSet: ['id', 'schedulingEventTypeId'],
          });
          hasNewFields = true;
          setSchemaReady(true);
        } catch {
          hasNewFields = false;
        }
      }

      // Dynamically build selection set based on schema readiness
      const stageFields = ['id', 'title', 'order', 'challenges.*'];
      if (hasNewFields) {
        stageFields.push('mode', 'schedulingEventTypeId');
      }

      const [pipelineData, candidatesData, stagesData] = await Promise.all([
        client.models.Pipeline.get({ id }),
        client.models.Candidate.list({ 
          filter: { pipelineId: { eq: id } },
          selectionSet: ['id', 'name', 'email', 'status', 'inviteToken', 'assessments.id', 'assessments.challengeId', 'assessments.score']
        }),
        client.models.Stage.list({ 
          filter: { pipelineId: { eq: id } },
          selectionSet: stageFields as any
        }),
      ]);

      setPipeline(pipelineData?.data || null);

      // Enrichment logic with extra guards
      const rawCandidates = candidatesData?.data || [];
      const enrichedCandidates = rawCandidates.map(c => {
        if (!c) return null;
        const assessments = (c as any).assessments || [];
        const scores = assessments.map((a: any) => a.score).filter((s: any) => typeof s === 'number');
        const score = scores.length > 0 ? Math.round(scores.reduce((sum: number, s: number) => sum + s, 0) / scores.length) : null;
        return { ...c, score };
      }).filter(Boolean);

      setCandidates(enrichedCandidates);
      
      const rawStages = (stagesData?.data as any[]) || [];
      setStages(rawStages
        .filter(s => s !== null)
        .sort((a, b) => (a.order || 0) - (b.order || 0)));

      // Load upcoming scheduled interviews — guarded
      try {
        const { data: siData } = await client.models.ScheduledInterview.list({
          filter: { pipelineId: { eq: id } },
        });
        setUpcomingInterviews((siData ?? []).filter((si: any) => si && (si.status === 'SCHEDULED' || si.status === 'INVITED')));
      } catch (siErr) {
        console.warn('[OverviewPage] ScheduledInterview model failed:', siErr);
      }
    } catch (err) {
      console.error("Error fetching pipeline data:", err);
      setError(err instanceof Error ? err : new Error("Failed to load pipeline data"));
    } finally {
      setIsLoading(false);
    }
  }, [id, schemaReady]);

  useEffect(() => {
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
    if (!window.confirm("Are you sure you want to delete ALL stages for this pipeline?")) return;
    
    setIsLoading(true);
    try {
      // Fetch all stages first
      const { data: stagesToDelete } = await client.models.Stage.list({
        filter: { pipelineId: { eq: id } }
      });
      // Delete them
      await Promise.all(stagesToDelete.map(s => client.models.Stage.delete({ id: s.id })));
      
      // Wait for consistency. Amplify Data backend is eventually consistent.
      // This arbitrary delay allows DynamoDB streams to sync before we re-fetch.
      await new Promise(resolve => setTimeout(resolve, 500));
      await fetchData();
    } catch (err) {
      console.error("Failed to clear stages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  /** Create a ScheduledInterview record for a candidate (Invite to Interview) */
  const handleInviteToInterview = async (candidateId: string, stageId: string) => {
    if (!id) return;

    // Only allow invites for LIVE_VIDEO stages
    const stage = stages.find((s: any) => s.id === stageId);
    if (!stage || stage.mode !== 'LIVE_VIDEO') {
      console.warn('[OverviewPage] Invite to Interview is only valid for LIVE_VIDEO stages');
      return;
    }

    setInvitingCandidateId(candidateId);
    try {
      // Prevent duplicate invites: check for an existing record first
      const { data: existing } = await client.models.ScheduledInterview.list({
        filter: { candidateId: { eq: candidateId }, stageId: { eq: stageId } },
      });
      if (existing && existing.length > 0) {
        console.warn('[OverviewPage] Interview invite already exists for this candidate + stage');
        return;
      }

      // Resolve scheduling URL from the recruiter's connected provider
      let schedulingUrl: string | undefined;
      if (connection?.id && connection.status === 'ACTIVE') {
        try {
          const eventTypes = await fetchEventTypes(connection.id);
          if (eventTypes.length > 0) {
            schedulingUrl = eventTypes[0].url;
            console.log('[OverviewPage] Resolved scheduling URL from provider:', schedulingUrl);
          }
        } catch (err) {
          console.warn('[OverviewPage] Could not fetch event types, falling back to no scheduling URL:', err);
        }
      }

      await client.models.ScheduledInterview.create({
        pipelineId: id,
        candidateId,
        stageId,
        status: 'INVITED',
        schedulingProvider: connection?.providerId || 'MANUAL',
        schedulingUrl: schedulingUrl ?? null,
      });
      // Re-fetch upcoming interviews
      const { data: siData } = await client.models.ScheduledInterview.list({
        filter: { pipelineId: { eq: id } },
      });
      setUpcomingInterviews((siData ?? []).filter((si: any) => si && (si.status === 'SCHEDULED' || si.status === 'INVITED')));
    } catch (err) {
      console.error('[OverviewPage] Failed to create interview invitation:', err);
    } finally {
      setInvitingCandidateId(null);
    }
  };

  const handleSeedStage = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      console.log('[Overview] Seeding MVP stages...');
      // 1. Technical Screen (Default: ASYNC)
      await client.models.Stage.create({
        pipelineId: id,
        title: 'Technical Screen',
        order: 0,
        mode: 'ASYNC',
      });

      // 2. Final Round (LIVE_VIDEO for scheduling tests)
      await client.models.Stage.create({
        pipelineId: id,
        title: 'Final Round',
        order: 1,
        mode: 'LIVE_VIDEO',
      });

      console.log('[Overview] Stages seeded. Refreshing...');
      // Wait for consistency. Amplify Data backend is eventually consistent.
      // 800ms is usually sufficient for standard sandbox deployments, but may
      // need backoff/retry in heavy load scenarios.
      await new Promise(resolve => setTimeout(resolve, 800));
      await fetchData();
    } catch (err) {
      console.error("Failed to seed stages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Map challenge IDs to stage IDs for grouping
  const challengeToStageMap = stages.reduce((acc, stage) => {
    (stage.challenges || []).forEach((c: any) => {
      acc[c.id] = stage.id;
    });
    return acc;
  }, {} as Record<string, string>);

  // Group candidates by their current stage
  const candidatesByStage = stages.reduce((acc, s, idx) => {
    acc[s.id] = candidates.filter(c => {
      // Get count of unique stages this candidate has submitted assessments for
      const completedStageIds = new Set(
        (c.assessments || [])
          .map((a: any) => challengeToStageMap[a.challengeId])
          .filter(Boolean)
      );
      const completedCount = completedStageIds.size;

      // If they finished everything, they are in the last stage
      if (c.status === 'COMPLETED' && idx === stages.length - 1) return true;
      if (c.status === 'COMPLETED') return false;

      // Otherwise, they are in the stage corresponding to their progress
      // e.g. 0 stages completed -> in stage 0
      // 1 stage completed -> in stage 1
      return idx === completedCount;
    });
    return acc;
  }, {} as Record<string, any[]>);

  if (isLoading && !pipeline) {
    return <OverviewSkeleton />;
  }

  if (error) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 400, padding: 40, textAlign: 'center' }}>
          <div style={{ color: '#f87171', marginBottom: 16, fontSize: 12, fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            ERROR_LOADING_PIPELINE
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            {error.message}
          </p>
          <button
            onClick={() => fetchData()}
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

  if (!pipeline && !isLoading) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <h2 style={{ color: '#fff', marginBottom: 20 }}>Pipeline Not Found</h2>
        <button onClick={() => navigate("/")} style={{ color: '#fff', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', padding: '10px 20px', cursor: 'pointer' }}>Back to Roles</button>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header with Add Candidate button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>PIPELINE_OVERVIEW</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>{pipeline?.title}</h1>
        </div>

        {!showAddForm && (
          <div style={{ display: 'flex', gap: 12 }}>
            {import.meta.env.DEV && (
              <>
                <button
                  onClick={handleClearStages}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 20px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.4)",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    fontFamily: "Space Mono",
                    cursor: "pointer",
                  }}
                >
                  <X size={14} />
                  CLEAR_STAGES
                </button>
                {stages.length === 0 && (
                  <button
                    onClick={handleSeedStage}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 20px",
                      background: "rgba(255,100,100,0.1)",
                      border: "1px solid rgba(255,100,100,0.2)",
                      color: "#ffaaaa",
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      fontFamily: "Space Mono",
                      cursor: "pointer",
                    }}
                  >
                    <Code size={14} />
                    SEED_MVP_STAGES
                  </button>
                )}
              </>
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

      {/* Stage Headers and Kanban Grid */}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 24, alignItems: 'flex-start' }}>
        {stages.map((s) => {
          const stageCandidates = candidatesByStage[s.id] || [];
          return (
            <div key={s.id} style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Header */}
              <StageHeaderCard
                stage={s}
                candidates={stageCandidates}
                isActive={false}
                onClick={() => navigate(`/pipeline/${id}/stages/${s.id}`)}
              />

              {/* Candidate Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stageCandidates.map((candidate: any) => {
                  // Find the interview record for this candidate in THIS stage
                  const interview = upcomingInterviews.find(si => si.candidateId === candidate.id && si.stageId === s.id);
                  
                  return (
                    <CandidateKanbanCard
                      key={candidate.id}
                      candidate={candidate}
                      interview={interview}
                      onClick={() => navigate(`/candidates/${candidate.id}`)}
                      onInvite={s.mode === 'LIVE_VIDEO' ? () => handleInviteToInterview(candidate.id, s.id) : undefined}
                      isInviting={invitingCandidateId === candidate.id}
                    />
                  );
                })}

                {stageCandidates.length === 0 && (
                  <div
                    style={{
                      height: 120,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px dashed rgba(255,255,255,0.08)",
                      borderRadius: 12
                    }}
                  >
                    <span style={{ fontSize: 8, letterSpacing: "0.2em", color: "rgba(255,255,255,0.2)" }}>
                      NO CANDIDATES
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Stage Column */}
        <div style={{ flex: '0 0 320px' }}>
          <button
            onClick={handleAddStage}
            style={{
              width: '100%',
              height: 180, 
              background: 'rgba(255,255,255,0.03)',
              border: '1px dashed rgba(255,255,255,0.1)',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
          >
            <Plus size={20} />
            <span style={{ fontSize: 10, letterSpacing: '0.2em', fontWeight: 700, fontFamily: 'Space Mono' }}>ADD_STAGE</span>
          </button>
        </div>
      </div>
    </div>
  );
}
