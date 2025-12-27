import React, { useState, useEffect } from 'react';
import {
  User,
  Target,
  GitBranch,
  Clock,
  MessageSquare,
  FileText,
  Sparkles,
  Plus,
  CheckCircle,
  Activity,
  ChevronRight,
  ChevronLeft,
  Video,
  Play,
  Edit3,
  Trash2,
  GripVertical,
  MoreHorizontal,
  Copy,
  Settings,
  BarChart3,
  AlertCircle,
  Phone,
  Zap,
  Code,
  Mic,
  Users,
  Eye,
  Save,
  Wand2,
} from 'lucide-react';

// ============================================================================
// DESIGN SYSTEM COMPONENTS
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
    mercury: {
      background: `linear-gradient(160deg,
        rgba(200, 210, 230, 0.12) 0%,
        rgba(180, 190, 220, 0.06) 30%,
        rgba(220, 225, 240, 0.15) 50%,
        rgba(170, 180, 210, 0.08) 70%,
        rgba(190, 200, 225, 0.1) 100%
      )`,
      border: '1px solid rgba(200, 210, 240, 0.15)',
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

function SubTitle({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
      <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{children}</span>
    </div>
  );
}

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
      
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)', margin: '12px 0' }} />
      
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, background: 'rgba(150,255,150,0.8)', boxShadow: '0 0 8px rgba(150,255,150,0.6)' }} />
        <button style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}>
          <Sparkles size={18} />
        </button>
        <div style={{ fontSize: 7, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 2 }}>AVG</div>
      </div>
    </div>
  );
}

// ============================================================================
// STAGE NAVIGATION TABS
// ============================================================================

const stages = [
  { id: 'screening', name: 'SCREENING', icon: Phone, configured: true },
  { id: 'ai_collab', name: 'AI COLLAB', icon: Zap, configured: true },
  { id: 'code_review', name: 'CODE REVIEW', icon: Code, configured: false },
  { id: 'planning', name: 'PLANNING', icon: FileText, configured: false },
  { id: 'voice', name: 'VOICE', icon: Mic, configured: false },
  { id: 'panel', name: 'PANEL', icon: Users, configured: false },
];

function StageTabNav({ activeStage, onStageChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 32 }}>
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const isActive = activeStage === stage.id;
        return (
          <button
            key={stage.id}
            onClick={() => onStageChange(stage.id)}
            style={{
              flex: 1,
              padding: '16px 12px',
              background: isActive 
                ? 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(200,200,220,0.08))'
                : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
              borderBottom: isActive ? '2px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.06)',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon size={14} />
              {stage.configured && <CheckCircle size={10} color="rgba(150,255,150,0.8)" />}
            </div>
            <span style={{ fontSize: 8, letterSpacing: '0.15em' }}>{stage.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// MOCK DATA
// ============================================================================

const mockQuestions = [
  { 
    id: 'q1', 
    text: 'Tell me about your experience with distributed systems and how you\'ve applied that knowledge in previous roles.', 
    type: 'technical', 
    timeLimit: 3,
    required: true,
    hasVideo: true,
    videoDuration: 45,
    rubricDimensions: 4,
    order: 1,
  },
  { 
    id: 'q2', 
    text: 'Why are you interested in this role and what excites you about our company?', 
    type: 'motivation', 
    timeLimit: 2,
    required: true,
    hasVideo: true,
    videoDuration: 32,
    rubricDimensions: 3,
    order: 2,
  },
  { 
    id: 'q3', 
    text: 'Describe a challenging technical problem you solved recently. Walk me through your approach.', 
    type: 'behavioral', 
    timeLimit: 3,
    required: true,
    hasVideo: false,
    videoDuration: null,
    rubricDimensions: 5,
    order: 3,
  },
  { 
    id: 'q4', 
    text: 'How do you approach code reviews? What do you look for and how do you provide feedback?', 
    type: 'technical', 
    timeLimit: 2,
    required: false,
    hasVideo: true,
    videoDuration: 28,
    rubricDimensions: 3,
    order: 4,
  },
  { 
    id: 'q5', 
    text: 'Tell me about a time you had to work with a difficult team member. How did you handle it?', 
    type: 'behavioral', 
    timeLimit: 3,
    required: false,
    hasVideo: false,
    videoDuration: null,
    rubricDimensions: 4,
    order: 5,
  },
];

// ============================================================================
// QUESTION CARD COMPONENT
// ============================================================================

function QuestionCard({ question, onClick, index }) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), index * 60);
    return () => clearTimeout(timer);
  }, [index]);

  const typeColors = {
    technical: { bg: 'rgba(100, 180, 255, 0.15)', color: 'rgba(100, 180, 255, 0.9)', border: 'rgba(100, 180, 255, 0.3)' },
    behavioral: { bg: 'rgba(255, 180, 100, 0.15)', color: 'rgba(255, 180, 100, 0.9)', border: 'rgba(255, 180, 100, 0.3)' },
    motivation: { bg: 'rgba(180, 100, 255, 0.15)', color: 'rgba(180, 100, 255, 0.9)', border: 'rgba(180, 100, 255, 0.3)' },
  };

  const typeStyle = typeColors[question.type] || typeColors.technical;

  return (
    <div style={{
      opacity: mounted ? 1 : 0,
      transform: mounted ? 'translateY(0)' : 'translateY(15px)',
      transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <LiquidMetalCard variant="dark" hover onClick={onClick}>
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            {/* Drag handle + number */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button style={{ padding: 4, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'grab' }}>
                <GripVertical size={16} />
              </button>
              <div style={{
                width: 36,
                height: 36,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{question.order}</span>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1 }}>
              {/* Meta row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{
                  fontSize: 8,
                  letterSpacing: '0.15em',
                  padding: '4px 10px',
                  background: typeStyle.bg,
                  color: typeStyle.color,
                  border: `1px solid ${typeStyle.border}`,
                  textTransform: 'uppercase',
                }}>
                  {question.type}
                </span>
                <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>
                  {question.timeLimit} MIN
                </span>
                {question.required && (
                  <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,100,100,0.7)' }}>REQUIRED</span>
                )}
              </div>
              
              {/* Question text */}
              <p style={{ fontSize: 14, color: '#fff', lineHeight: 1.6, margin: '0 0 16px' }}>
                {question.text}
              </p>

              {/* Status indicators */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                {/* Video status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {question.hasVideo ? (
                    <>
                      <div style={{ width: 8, height: 8, background: 'rgba(150,255,150,0.8)', boxShadow: '0 0 6px rgba(150,255,150,0.5)' }} />
                      <Video size={12} color="rgba(150,255,150,0.8)" />
                      <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(150,255,150,0.8)' }}>
                        {Math.floor(question.videoDuration / 60)}:{(question.videoDuration % 60).toString().padStart(2, '0')}
                      </span>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 8, height: 8, background: 'rgba(255,200,100,0.6)' }} />
                      <Video size={12} color="rgba(255,200,100,0.6)" />
                      <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,200,100,0.6)' }}>NO VIDEO</span>
                    </>
                  )}
                </div>

                {/* Rubric status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BarChart3 size={12} color="rgba(255,255,255,0.4)" />
                  <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>
                    {question.rubricDimensions} CRITERIA
                  </span>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', alignItems: 'center', color: 'rgba(255,255,255,0.3)' }}>
              <ChevronRight size={20} />
            </div>
          </div>
        </div>
        
        {/* Bottom accent line */}
        <div style={{ 
          height: 2, 
          background: question.hasVideo 
            ? 'linear-gradient(90deg, rgba(150,255,150,0.3), rgba(150,255,150,0.6), rgba(150,255,150,0.3))'
            : 'linear-gradient(90deg, rgba(255,200,100,0.2), rgba(255,200,100,0.4), rgba(255,200,100,0.2))',
        }} />
      </LiquidMetalCard>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function StageDetail() {
  const [activeSection, setActiveSection] = useState('pipeline');
  const [activeStage, setActiveStage] = useState('screening');
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Navigate to question detail
  const handleQuestionClick = (questionId) => {
    // In real app: router.push(`/role/${roleId}/${activeStage}/${questionId}`)
    console.log(`Navigate to /role/:id/${activeStage}/${questionId}`);
    alert(`Navigate to question detail: ${questionId}`);
  };

  // Stats
  const totalQuestions = mockQuestions.length;
  const questionsWithVideo = mockQuestions.filter(q => q.hasVideo).length;
  const requiredQuestions = mockQuestions.filter(q => q.required).length;
  const totalTime = mockQuestions.reduce((sum, q) => sum + q.timeLimit, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
      <ChromeMeshGrid />

      {/* Header */}
      <header style={{
        padding: '24px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <button style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, letterSpacing: '0.1em' }}>
                <ChevronLeft size={12} />
                ROLES
              </button>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>SR. SOFTWARE ENGINEER</span>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.6)' }}>SCREENING</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4</span>
            </div>
            <h1 style={{
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '8px 0 0',
              background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))',
            }}>
              SCREENING_STAGE
            </h1>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button style={{
              padding: '10px 20px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 10,
              letterSpacing: '0.15em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <Eye size={12} />
              PREVIEW
            </button>
            <button style={{
              padding: '10px 20px',
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.15em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <Wand2 size={12} />
              AI GENERATE
            </button>
            <button style={{
              padding: '10px 24px',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            }}>
              <Plus size={14} />
              ADD QUESTION
            </button>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', position: 'relative', minHeight: 'calc(100vh - 160px)' }}>
        {/* Sidebar */}
        <aside style={{
          width: 80,
          padding: '24px 16px',
          borderRight: '1px solid rgba(255,255,255,0.04)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
        }}>
          <SidebarNav activeSection={activeSection} onSectionChange={setActiveSection} />
        </aside>

        {/* Main Content */}
        <main style={{ flex: 1, padding: '24px 32px', position: 'relative', zIndex: 1 }}>
          {/* Stage tabs */}
          <StageTabNav activeStage={activeStage} onStageChange={setActiveStage} />

          {/* Stats bar */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            marginBottom: 32,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
          }}>
            <LiquidMetalCard variant="default" style={{ padding: 20 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>QUESTIONS</div>
              <div style={{ fontSize: 28, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {totalQuestions}
              </div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 20 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>WITH VIDEO</div>
              <div style={{ 
                fontSize: 28, 
                fontWeight: 800, 
                background: questionsWithVideo === totalQuestions 
                  ? 'linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)'
                  : 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', 
                WebkitBackgroundClip: 'text', 
                WebkitTextFillColor: 'transparent' 
              }}>
                {questionsWithVideo}/{totalQuestions}
              </div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 20 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>REQUIRED</div>
              <div style={{ fontSize: 28, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {requiredQuestions}
              </div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 20 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>EST. TIME</div>
              <div style={{ fontSize: 28, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {totalTime} MIN
              </div>
            </LiquidMetalCard>
          </div>

          {/* Questions list header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <SubTitle>QUESTIONS</SubTitle>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>
              DRAG TO REORDER
            </div>
          </div>

          {/* Questions list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mockQuestions.map((question, i) => (
              <QuestionCard 
                key={question.id}
                question={question}
                index={i}
                onClick={() => handleQuestionClick(question.id)}
              />
            ))}
          </div>

          {/* Add question card */}
          <div style={{
            marginTop: 16,
            opacity: mounted ? 1 : 0,
            transition: `opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${mockQuestions.length * 60 + 200}ms`,
          }}>
            <LiquidMetalCard 
              variant="default" 
              hover 
              onClick={() => handleQuestionClick('new')}
              style={{ 
                padding: 32,
                border: '1px dashed rgba(255,255,255,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
              }}
            >
              <Plus size={20} color="rgba(255,255,255,0.4)" />
              <span style={{ fontSize: 11, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.5)' }}>
                ADD NEW QUESTION
              </span>
            </LiquidMetalCard>
          </div>
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.95); } }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>
    </div>
  );
}