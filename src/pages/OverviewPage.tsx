import { useState, useEffect } from 'react';
import { useParams, useNavigate, Outlet } from 'react-router-dom';
import {
  ArrowLeft,
  Building,
  MapPin,
  User,
  CheckCircle,
  Activity,
  Phone,
  Zap,
  Code,
  FileText,
  Mic,
  Users,
} from 'lucide-react';
import { Layout, ProfileHeader, LiquidMetalCard, SidebarNav, SubTitle } from '../components';
import { getRoleById, getStagesByPipelineId, getCandidatesByPipelineId } from '../mocks';
import type { Candidate, Stage } from '../types';

/**
 * OverviewPage - Kanban-style pipeline view showing candidates by stage
 *
 * Displays a horizontal kanban board with columns for each pipeline stage,
 * showing candidates organized by their current stage progress.
 */

// Map stage types to icons
const stageIcons: Record<string, typeof Phone> = {
  CODE_REVIEW: Code,
  VOICE_INTERVIEW: Mic,
  PLANNING: FileText,
  SCREENING: Phone,
  AI_COLLAB: Zap,
  PANEL: Users,
};

// Stage header card showing average score and completion status
function StageHeaderCard({
  stage,
  candidates,
  isActive,
  onClick,
}: {
  stage: Stage;
  candidates: Candidate[];
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = stageIcons[stage.type] || FileText;
  const hasScore = candidates.length > 0;
  const avgScore = hasScore
    ? Math.round(candidates.reduce((sum, c) => sum + c.score, 0) / candidates.length)
    : null;
  const isComplete = stage.status === 'COMPLETED';

  return (
    <LiquidMetalCard
      data-testid="stage-card"
      variant={isActive ? 'chrome' : 'default'}
      hover
      onClick={onClick}
      style={{ padding: 24, cursor: 'pointer' }}
    >
      {/* Top row: Icon + Status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Icon size={20} color={isActive ? '#fff' : 'rgba(255,255,255,0.4)'} />
        {isComplete && <CheckCircle size={16} color="rgba(150,255,150,0.8)" />}
        {isActive && !isComplete && (
          <Activity
            size={16}
            color="rgba(255,255,255,0.8)"
            style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
          />
        )}
      </div>

      {/* Stage name */}
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.2em',
          color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
          marginBottom: 12,
        }}
      >
        {stage.name.toUpperCase()}
      </div>

      {/* Score (large, dominant) */}
      {hasScore ? (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {avgScore}
        </div>
      ) : (
        <div style={{ fontSize: 42, fontWeight: 800, color: 'rgba(255,255,255,0.15)' }}>—</div>
      )}

      {/* Progress bar */}
      <div style={{ marginTop: 16, height: 2, background: 'rgba(255,255,255,0.06)' }}>
        {hasScore && (
          <div
            style={{
              width: `${avgScore}%`,
              height: '100%',
              background: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))',
              boxShadow: '0 0 10px rgba(255,255,255,0.2)',
            }}
          />
        )}
      </div>
    </LiquidMetalCard>
  );
}

// Detailed candidate card for kanban view
function CandidateKanbanCard({
  candidate,
  onClick,
  index,
  stageIndex,
}: {
  candidate: Candidate;
  onClick: () => void;
  index: number;
  stageIndex: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), stageIndex * 100 + index * 80);
    return () => clearTimeout(timer);
  }, [stageIndex, index]);

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(15px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <LiquidMetalCard variant="dark" hover onClick={onClick} style={{ marginBottom: 8, cursor: 'pointer' }}>
        <div style={{ display: 'flex' }}>
          {/* Initials block */}
          <div
            style={{
              width: 90,
              padding: 24,
              borderRight: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.6) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {candidate.initials}
            </span>
          </div>

          {/* Info section */}
          <div style={{ flex: 1, padding: '20px 24px' }}>
            {/* Company */}
            {candidate.company && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Building size={12} color="rgba(255,255,255,0.25)" />
                <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>
                  {candidate.company.toUpperCase()}
                </span>
              </div>
            )}

            {/* Location */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <MapPin size={12} color="rgba(255,255,255,0.25)" />
              <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>
                {(candidate.location || '').toUpperCase()}
              </span>
            </div>

            {/* Name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <User size={12} color="rgba(255,255,255,0.25)" />
              <span style={{ fontSize: 10, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.5)' }}>
                {candidate.name.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Score section */}
          <div
            style={{
              width: 80,
              padding: 20,
              borderLeft: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {candidate.score}
            </div>
            <span
              style={{
                fontSize: 7,
                letterSpacing: '0.15em',
                marginTop: 6,
                padding: '3px 8px',
                background:
                  candidate.signal === 'STRONG'
                    ? 'rgba(150,255,150,0.15)'
                    : candidate.signal === 'YES'
                      ? 'rgba(255,255,255,0.1)'
                      : 'rgba(255,255,255,0.05)',
                color:
                  candidate.signal === 'STRONG'
                    ? 'rgba(150,255,150,0.8)'
                    : candidate.signal === 'YES'
                      ? 'rgba(255,255,255,0.6)'
                      : 'rgba(255,255,255,0.5)',
              }}
            >
              {candidate.signal}
            </span>
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}

export default function OverviewPage(): JSX.Element {
  const { id, stage, questionId } = useParams<{ id: string; stage?: string; questionId?: string }>();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('pipeline');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const role = id ? getRoleById(id) : undefined;
  const stages = id ? getStagesByPipelineId(id) : [];
  const allCandidates = id ? getCandidatesByPipelineId(id) : [];

  // Find current stage for back button text
  const currentStage = stage ? stages.find((s) => s.id === stage) : undefined;

  // Group candidates by their current stage
  const candidatesByStage = stages.reduce(
    (acc, stage) => {
      acc[stage.id] = allCandidates.filter((candidate) => {
        // Find the current stage for this candidate
        // A candidate is in a stage if they have it marked as IN_PROGRESS
        // or if it's their most recently completed stage
        const candidateStage = candidate.stages.find((cs) => cs.stageId === stage.id);
        if (!candidateStage) return false;

        // If stage is in progress, include the candidate
        if (candidateStage.status === 'IN_PROGRESS') return true;

        // If stage is completed, only include if no later stages are in progress
        if (candidateStage.status === 'COMPLETED') {
          const hasLaterInProgress = candidate.stages.some(
            (cs) => cs.status === 'IN_PROGRESS' && (cs.stageId || '') > stage.id
          );
          return !hasLaterInProgress;
        }

        return false;
      });
      return acc;
    },
    {} as Record<string, Candidate[]>
  );

  if (!role) {
    return (
      <Layout
        header={<ProfileHeader title="PIPELINE NOT FOUND" subtitle="PIPE_OS // V.2.0.4" />}
        sidebar={<SidebarNav activeSection={activeSection} onSectionChange={setActiveSection} />}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <LiquidMetalCard variant="mercury" style={{ padding: 60, textAlign: 'center' }}>
            <h2 style={{ fontSize: 24, marginBottom: 16 }}>Pipeline Not Found</h2>
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '12px 24px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Back to Roles
            </button>
          </LiquidMetalCard>
        </div>
      </Layout>
    );
  }

  const totalCandidates = allCandidates.length;

  return (
    <Layout
      header={<ProfileHeader title="PIPELINE_VIEW" subtitle="PIPE_OS // V.2.0.4" />}
      sidebar={<SidebarNav activeSection={activeSection} onSectionChange={setActiveSection} />}
    >
      <div
        style={{
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Back button and position info bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 32,
            paddingBottom: 20,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <button
              onClick={() => {
                if (questionId && stage) {
                  // From question detail -> stage detail
                  navigate(`/pipeline/${id}/${stage}`);
                } else if (stage) {
                  // From stage detail -> overview
                  navigate(`/pipeline/${id}`);
                } else {
                  // From overview -> home
                  navigate('/');
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                fontSize: 10,
                letterSpacing: '0.15em',
              }}
            >
              <ArrowLeft size={12} />{' '}
              {questionId && currentStage
                ? `BACK TO ${currentStage.name.toUpperCase()}`
                : stage
                  ? 'BACK TO OVERVIEW'
                  : 'BACK TO ROLES'}
            </button>

            <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />

            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  color: 'rgba(255,255,255,0.3)',
                  marginBottom: 6,
                }}
              >
                POSITION
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>
                {role.title.toUpperCase()}
              </div>
            </div>

            <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />

            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  color: 'rgba(255,255,255,0.3)',
                  marginBottom: 6,
                }}
              >
                ACTIVE CANDIDATES
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {totalCandidates}
              </div>
            </div>
          </div>

          <SubTitle>PIPELINE_STATUS</SubTitle>
        </div>

        {/* Stage headers (always visible) */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {stages.map((s) => (
            <div key={s.id} style={{ flex: 1, minWidth: 280 }}>
              <StageHeaderCard
                stage={s}
                candidates={candidatesByStage[s.id] || []}
                isActive={stage === s.id}
                onClick={() => navigate(`/pipeline/${id}/${s.id}`)}
              />
            </div>
          ))}
        </div>

        {/* Content area - stage detail OR kanban candidate cards */}
        {stage ? (
          <Outlet />
        ) : (
          <div
            style={{
              display: 'flex',
              gap: 12,
              overflowX: 'auto',
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
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Candidates list */}
                  {stageCandidates.map((candidate, idx) => (
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
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px dashed rgba(255,255,255,0.08)',
                      }}
                    >
                      <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)' }}>
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
    </Layout>
  );
}
