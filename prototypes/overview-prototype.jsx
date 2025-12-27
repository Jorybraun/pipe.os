import React, { useState, useEffect } from 'react';
import {
  User,
  Target,
  GitBranch,
  Clock,
  MessageSquare,
  FileText,
  Sparkles,
  Phone,
  Zap,
  Code,
  Mic,
  Users,
  CheckCircle,
  Activity,
  Building,
  MapPin,
} from 'lucide-react';

// ============================================================================
// DESIGN SYSTEM COMPONENTS (from Profile)
// ============================================================================

function LiquidMetalCard({ children, style = {}, variant = 'default', hover = false, onClick }) {
  const [isHovered, setIsHovered] = useState(false);
  
  const variants = {
    default: {
      background: `linear-gradient(135deg, 
        rgba(180, 180, 190, 0.08) 0%, 
        rgba(120, 120, 140, 0.04) 25%,
        rgba(200, 200, 210, 0.08) 50%,
        rgba(100, 100, 120, 0.04) 75%,
        rgba(160, 160, 180, 0.08) 100%
      )`,
      border: '1px solid rgba(255, 255, 255, 0.12)',
    },
    chrome: {
      background: `linear-gradient(135deg,
        rgba(220, 220, 230, 0.15) 0%,
        rgba(180, 180, 200, 0.08) 20%,
        rgba(255, 255, 255, 0.2) 40%,
        rgba(160, 160, 180, 0.08) 60%,
        rgba(200, 200, 220, 0.12) 80%,
        rgba(140, 140, 160, 0.08) 100%
      )`,
      border: '1px solid rgba(255, 255, 255, 0.2)',
    },
    dark: {
      background: `linear-gradient(135deg,
        rgba(40, 40, 50, 0.6) 0%,
        rgba(60, 60, 80, 0.5) 50%,
        rgba(30, 30, 40, 0.7) 100%
      )`,
      border: '1px solid rgba(255, 255, 255, 0.1)',
    },
  };
  
  const v = variants[variant];
  
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setIsHovered(true)}
      onMouseLeave={() => hover && setIsHovered(false)}
      style={{
        background: v.background,
        backdropFilter: 'blur(40px) saturate(150%)',
        WebkitBackdropFilter: 'blur(40px) saturate(150%)',
        border: v.border,
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        transform: isHovered ? 'translateY(-2px)' : 'none',
        boxShadow: isHovered 
          ? '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)'
          : 'inset 0 1px 0 rgba(255,255,255,0.1)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {/* Chrome sweep effect */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: isHovered ? '100%' : '-100%',
        width: '50%',
        height: '100%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
        transition: 'left 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        pointerEvents: 'none',
      }} />
      {children}
    </div>
  );
}

// SubTitle with dot indicator (from profile)
function SubTitle({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
      <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{children}</span>
    </div>
  );
}

// Chrome mesh grid
function ChromeMeshGrid() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundImage: `
        linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
      `,
      backgroundSize: '80px 80px',
      pointerEvents: 'none',
      zIndex: 0,
    }} />
  );
}

// Sidebar navigation (from profile screenshot)
function SidebarNav({ activeSection, onSectionChange }) {
  const navItems = [
    { id: 'profile', icon: User },
    { id: 'pipeline', icon: Target },
    { id: 'flow', icon: GitBranch },
    { id: 'history', icon: Clock },
    { id: 'messages', icon: MessageSquare },
    { id: 'docs', icon: FileText },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {navItems.map(item => {
        const Icon = item.icon;
        const isActive = activeSection === item.id;
        return (
          <button key={item.id} onClick={() => onSectionChange(item.id)} style={{
            width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', cursor: 'pointer', position: 'relative',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            background: isActive ? 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))' : 'transparent',
            backdropFilter: isActive ? 'blur(20px)' : 'none',
            boxShadow: isActive ? '0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)' : 'none',
            color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
          }}>
            {isActive && <div style={{ position: 'absolute', left: -16, width: 3, height: 24, background: 'linear-gradient(180deg, rgba(255,255,255,0.8), rgba(200,200,220,0.6))', boxShadow: '0 0 12px rgba(255,255,255,0.4)' }} />}
            <Icon size={18} />
          </button>
        );
      })}
      
      {/* Divider */}
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)', margin: '12px 0' }} />
      
      {/* AI Agent indicator */}
      <div style={{ position: 'relative' }}>
        <div style={{ 
          position: 'absolute', 
          top: -4, 
          left: -4, 
          width: 8, 
          height: 8, 
          background: 'rgba(150,255,150,0.8)', 
          boxShadow: '0 0 8px rgba(150,255,150,0.6)' 
        }} />
        <button style={{
          width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.4)',
        }}>
          <Sparkles size={18} />
        </button>
        <div style={{ fontSize: 7, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 2 }}>AVG</div>
      </div>
    </div>
  );
}

// ============================================================================
// PIPELINE DATA
// ============================================================================

const pipelineStages = [
  { id: 'screening', name: 'SCREEN', icon: Phone },
  { id: 'ai_collab', name: 'AI COLLAB', icon: Zap },
  { id: 'code_review', name: 'CODE REV', icon: Code },
  { id: 'planning', name: 'PLANNING', icon: FileText },
  { id: 'voice', name: 'VOICE', icon: Mic },
  { id: 'panel', name: 'PANEL', icon: Users },
];

const mockCandidates = {
  screening: [
    { id: 1, initials: 'SC', name: 'Sarah Chen', company: 'Stripe', location: 'NYC', score: 78, signal: 'yes', days: 1 },
    { id: 2, initials: 'MW', name: 'Marcus Williams', company: 'Shopify', location: 'Toronto', score: 72, signal: 'yes', days: 2 },
    { id: 10, initials: 'RK', name: 'Raj Kumar', company: 'Google', location: 'SF', score: 81, signal: 'strong', days: 1 },
  ],
  ai_collab: [
    { id: 3, initials: 'ER', name: 'Emily Rodriguez', company: 'Meta', location: 'Seattle', score: 85, signal: 'strong', days: 2 },
    { id: 4, initials: 'JP', name: 'James Park', company: 'Netflix', location: 'LA', score: 79, signal: 'yes', days: 3 },
  ],
  code_review: [
    { id: 5, initials: 'DK', name: 'David Kim', company: 'Netflix', location: 'SF', score: 91, signal: 'strong', days: 1 },
  ],
  planning: [
    { id: 6, initials: 'LT', name: 'Lisa Thompson', company: 'Uber', location: 'SF', score: 88, signal: 'strong', days: 2 },
  ],
  voice: [
    { id: 7, initials: 'AP', name: 'Aisha Patel', company: 'Amazon', location: 'Seattle', score: 82, signal: 'yes', days: 1 },
  ],
  panel: [
    { id: 8, initials: 'JL', name: 'Jennifer Lee', company: 'Square', location: 'SF', score: 94, signal: 'strong', days: 3 },
  ],
};

// ============================================================================
// PIPELINE COMPONENTS
// ============================================================================

// Stage header card (matches profile bottom row exactly)
function StageHeaderCard({ stage, candidates, isActive, onClick }) {
  const Icon = stage.icon;
  const hasScore = candidates.length > 0;
  const avgScore = hasScore 
    ? Math.round(candidates.reduce((sum, c) => sum + c.score, 0) / candidates.length) 
    : null;
  const isComplete = candidates.some(c => c.signal === 'strong');

  return (
    <LiquidMetalCard 
      variant={isActive ? 'chrome' : 'default'} 
      hover 
      onClick={onClick}
      style={{ padding: 24 }}
    >
      {/* Top row: Icon + Status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Icon size={20} color={isActive ? '#fff' : 'rgba(255,255,255,0.4)'} />
        {isComplete && <CheckCircle size={16} color="rgba(150,255,150,0.8)" />}
        {isActive && !isComplete && (
          <Activity size={16} color="rgba(255,255,255,0.8)" style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
        )}
      </div>
      
      {/* Stage name */}
      <div style={{ 
        fontSize: 10, 
        letterSpacing: '0.2em', 
        color: isActive ? '#fff' : 'rgba(255,255,255,0.5)', 
        marginBottom: 12 
      }}>
        {stage.name}
      </div>
      
      {/* Score (large, dominant - like profile) */}
      {hasScore ? (
        <div style={{
          fontSize: 42,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          {avgScore}
        </div>
      ) : (
        <div style={{ fontSize: 42, fontWeight: 800, color: 'rgba(255,255,255,0.15)' }}>—</div>
      )}
      
      {/* Progress bar */}
      <div style={{ marginTop: 16, height: 2, background: 'rgba(255,255,255,0.06)' }}>
        {hasScore && (
          <div style={{
            width: `${avgScore}%`,
            height: '100%',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))',
            boxShadow: '0 0 10px rgba(255,255,255,0.2)',
          }} />
        )}
      </div>
    </LiquidMetalCard>
  );
}

// Candidate card (like profile DK card structure)
function CandidateCard({ candidate, onClick, index, stageIndex }) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), (stageIndex * 100) + (index * 80));
    return () => clearTimeout(timer);
  }, [stageIndex, index]);

  return (
    <div style={{
      opacity: mounted ? 1 : 0,
      transform: mounted ? 'translateY(0)' : 'translateY(15px)',
      transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <LiquidMetalCard variant="dark" hover onClick={onClick} style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex' }}>
          {/* Initials block (like DK in profile) */}
          <div style={{
            width: 90,
            padding: 24,
            borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.6) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {candidate.initials}
            </span>
          </div>
          
          {/* Info section */}
          <div style={{ flex: 1, padding: '20px 24px' }}>
            {/* Company */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Building size={12} color="rgba(255,255,255,0.25)" />
              <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>
                {candidate.company.toUpperCase()}
              </span>
            </div>
            
            {/* Location */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <MapPin size={12} color="rgba(255,255,255,0.25)" />
              <span style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>
                {candidate.location.toUpperCase()}
              </span>
            </div>
            
            {/* Name (like email in profile) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <User size={12} color="rgba(255,255,255,0.25)" />
              <span style={{ fontSize: 10, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.5)' }}>
                {candidate.name.toUpperCase()}
              </span>
            </div>
          </div>
          
          {/* Score section */}
          <div style={{
            width: 80,
            padding: 20,
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <div style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {candidate.score}
            </div>
            <span style={{
              fontSize: 7,
              letterSpacing: '0.15em',
              marginTop: 6,
              padding: '3px 8px',
              background: candidate.signal === 'strong' 
                ? 'rgba(150,255,150,0.15)' 
                : 'rgba(255,255,255,0.05)',
              color: candidate.signal === 'strong' 
                ? 'rgba(150,255,150,0.8)' 
                : 'rgba(255,255,255,0.5)',
            }}>
              {candidate.signal.toUpperCase()}
            </span>
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}

// Pipeline column
function PipelineColumn({ stage, candidates, isActive, onStageClick, stageIndex }) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), stageIndex * 80);
    return () => clearTimeout(timer);
  }, [stageIndex]);

  return (
    <div style={{
      flex: 1,
      minWidth: 280,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      opacity: mounted ? 1 : 0,
      transform: mounted ? 'translateY(0)' : 'translateY(20px)',
      transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      {/* Stage header card */}
      <StageHeaderCard 
        stage={stage} 
        candidates={candidates} 
        isActive={isActive}
        onClick={() => onStageClick(stage.id)}
      />
      
      {/* Candidates list */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {candidates.map((candidate, i) => (
          <CandidateCard 
            key={candidate.id} 
            candidate={candidate} 
            index={i}
            stageIndex={stageIndex}
          />
        ))}
        
        {candidates.length === 0 && (
          <div style={{
            flex: 1,
            minHeight: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px dashed rgba(255,255,255,0.08)',
          }}>
            <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)' }}>
              NO CANDIDATES
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function PipelineIndustrial() {
  const [activeSection, setActiveSection] = useState('pipeline');
  const [activeStage, setActiveStage] = useState('code_review');
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const totalCandidates = Object.values(mockCandidates).flat().length;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0c0c0e',
      fontFamily: '"Space Mono", monospace',
      color: '#fff',
    }}>
      <ChromeMeshGrid />
      
      {/* Header (from profile) */}
      <header style={{
        padding: '24px 32px',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>
            PIPE_OS // V.2.0.4
          </span>
        </div>
        <h1 style={{
          fontSize: 48,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          margin: 0,
          background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))',
        }}>
          PIPELINE_VIEW
        </h1>
      </header>
      
      <div style={{ display: 'flex', position: 'relative', minHeight: 'calc(100vh - 140px)' }}>
        {/* Sidebar (from profile) */}
        <aside style={{
          width: 80,
          padding: '0 16px',
          borderRight: '1px solid rgba(255,255,255,0.04)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
        }}>
          <SidebarNav activeSection={activeSection} onSectionChange={setActiveSection} />
        </aside>
        
        {/* Main content */}
        <main style={{ flex: 1, padding: '0 32px 32px', position: 'relative', zIndex: 1 }}>
          {/* Position info bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 32,
            paddingBottom: 20,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>
                  POSITION
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>
                  SR. SOFTWARE ENGINEER
                </div>
              </div>
              <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>
                  ACTIVE CANDIDATES
                </div>
                <div style={{ 
                  fontSize: 24, 
                  fontWeight: 800, 
                  background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  {totalCandidates}
                </div>
              </div>
            </div>
            
            <SubTitle>PIPELINE_STATUS</SubTitle>
          </div>
          
          {/* Pipeline columns (full width kanban) */}
          <div style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingBottom: 24,
          }}>
            {pipelineStages.map((stage, i) => (
              <PipelineColumn
                key={stage.id}
                stage={stage}
                candidates={mockCandidates[stage.id] || []}
                isActive={activeStage === stage.id}
                onStageClick={setActiveStage}
                stageIndex={i}
              />
            ))}
          </div>
        </main>
      </div>
      
      {/* Global styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.95); }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>
    </div>
  );
}