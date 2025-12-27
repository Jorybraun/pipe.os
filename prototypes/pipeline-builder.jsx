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
  Send,
  Plus,
  Eye,
  EyeOff,
  Bug,
  Play,
  Save,
  Activity,
  AlertTriangle,
  GripVertical,
  Volume2,
  Brain,
  ListChecks,
  UserPlus,
  Calendar,
  ChevronRight,
} from 'lucide-react';

// ============================================================================
// DESIGN SYSTEM COMPONENTS (matching profile/pipeline)
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

function MetalScoreRing({ value, size = 80, label }) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;
  
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div style={{
        position: 'absolute',
        inset: 8,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(200,210,230,0.15) 0%, transparent 70%)',
        filter: 'blur(8px)',
      }} />
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} fill="none" />
        <defs>
          <linearGradient id={`chrome-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="100%" stopColor="rgba(220,220,240,0.9)" />
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={radius} stroke={`url(#chrome-${label})`} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: size > 60 ? 18 : 14, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,200,220,0.8) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{value}</span>
      </div>
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

// Sidebar matching profile
function SidebarNav({ activeSection, onSectionChange, isAgentOpen, onAgentToggle }) {
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
      
      {/* AI Agent button */}
      <div style={{ position: 'relative' }}>
        <div style={{ 
          position: 'absolute', 
          top: -4, 
          left: -4, 
          width: 8, 
          height: 8, 
          background: isAgentOpen ? 'rgba(139, 92, 246, 0.8)' : 'rgba(150,255,150,0.8)', 
          boxShadow: isAgentOpen ? '0 0 8px rgba(139, 92, 246, 0.6)' : '0 0 8px rgba(150,255,150,0.6)' 
        }} />
        <button onClick={onAgentToggle} style={{
          width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: isAgentOpen ? '1px solid rgba(139, 92, 246, 0.4)' : 'none', cursor: 'pointer',
          background: isAgentOpen ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))' : 'transparent',
          color: isAgentOpen ? '#a78bfa' : 'rgba(255,255,255,0.4)',
        }}>
          <Sparkles size={18} />
        </button>
        <div style={{ fontSize: 7, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 2 }}>AVG</div>
      </div>
    </div>
  );
}

// Stage card matching profile bottom row
function StageCard({ stage, index, isActive, isConfigured, onClick }) {
  const Icon = stage.icon;
  const stageNumber = index + 1;
  
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
        {isConfigured && <CheckCircle size={16} color="rgba(150,255,150,0.8)" />}
        {isActive && !isConfigured && (
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
      
      {/* Stage number (large, matching profile scores) */}
      <div style={{
        fontSize: 42,
        fontWeight: 800,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        background: isConfigured 
          ? 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)'
          : 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(200,210,230,0.15) 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {isConfigured ? '✓' : stageNumber}
      </div>
      
      {/* Progress bar */}
      <div style={{ marginTop: 16, height: 2, background: 'rgba(255,255,255,0.06)' }}>
        {isConfigured && (
          <div style={{
            width: '100%',
            height: '100%',
            background: 'linear-gradient(90deg, rgba(150,255,150,0.4), rgba(150,255,150,0.8))',
            boxShadow: '0 0 10px rgba(150,255,150,0.3)',
          }} />
        )}
        {isActive && !isConfigured && (
          <div style={{
            width: '50%',
            height: '100%',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))',
            boxShadow: '0 0 10px rgba(255,255,255,0.2)',
          }} />
        )}
      </div>
    </LiquidMetalCard>
  );
}

// ============================================================================
// STAGE CONFIGURATION COMPONENTS
// ============================================================================

function ScreeningStageConfig() {
  const questions = [
    { id: 1, text: 'Tell me about your experience with distributed systems.', type: 'technical', required: true, timeLimit: 3 },
    { id: 2, text: 'Why are you interested in this role?', type: 'motivation', required: true, timeLimit: 2 },
    { id: 3, text: 'Describe a challenging technical problem you solved recently.', type: 'behavioral', required: true, timeLimit: 3 },
  ];
  
  const knockoutCriteria = [
    { id: 1, criteria: 'Less than 3 years experience', enabled: true },
    { id: 2, criteria: 'No distributed systems experience', enabled: true },
    { id: 3, criteria: 'Unable to start within 4 weeks', enabled: false },
  ];
  
  const rubric = [
    { dimension: 'TECHNICAL DEPTH', weight: 35 },
    { dimension: 'COMMUNICATION', weight: 25 },
    { dimension: 'ROLE FIT', weight: 25 },
    { dimension: 'ENTHUSIASM', weight: 15 },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <SubTitle>SCREENING_QUESTIONS</SubTitle>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer' }}>
            <Plus size={10} />ADD QUESTION
          </button>
        </div>
        
        {questions.map((q, i) => (
          <LiquidMetalCard key={q.id} variant="dark" style={{ marginBottom: 2, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{i + 1}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#fff', marginBottom: 8, lineHeight: 1.6 }}>{q.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 8, letterSpacing: '0.15em', padding: '4px 8px', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>{q.type}</span>
                  <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>{q.timeLimit} MIN</span>
                  {q.required && <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,100,100,0.6)' }}>REQUIRED</span>}
                </div>
              </div>
              <button style={{ padding: 8, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}><GripVertical size={14} /></button>
            </div>
          </LiquidMetalCard>
        ))}
        
        <div style={{ marginTop: 32 }}>
          <SubTitle>KNOCKOUT_CRITERIA</SubTitle>
          <div style={{ marginTop: 16 }}>
            {knockoutCriteria.map(k => (
              <LiquidMetalCard key={k.id} variant="default" style={{ marginBottom: 2, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <AlertTriangle size={14} color={k.enabled ? 'rgba(255,100,100,0.8)' : 'rgba(255,255,255,0.2)'} />
                    <span style={{ fontSize: 11, color: k.enabled ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)' }}>{k.criteria}</span>
                  </div>
                  <div style={{ width: 36, height: 20, background: k.enabled ? 'rgba(255,100,100,0.3)' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer' }}>
                    <div style={{ position: 'absolute', top: 2, left: k.enabled ? 18 : 2, width: 16, height: 16, background: k.enabled ? 'rgba(255,100,100,0.9)' : 'rgba(255,255,255,0.3)', transition: 'left 0.2s' }} />
                  </div>
                </div>
              </LiquidMetalCard>
            ))}
          </div>
        </div>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RubricCard rubric={rubric} />
        <TimeCard minutes={8} label="EST. DURATION" />
      </div>
    </div>
  );
}

function AICollabStageConfig() {
  const task = {
    title: 'BUILD A RATE LIMITER',
    description: 'Implement a sliding window rate limiter that can be used to limit API requests. The rate limiter should support multiple clients and be thread-safe.',
    requirements: [
      'Support configurable rate limits (requests per time window)',
      'Use a sliding window algorithm (not fixed window)',
      'Handle multiple clients identified by a client_id',
      'Include a clean_expired() method to remove old entries',
      'Return remaining requests and reset time in response',
    ],
  };
  
  const rubric = [
    { dimension: 'PROMPT CLARITY', weight: 30 },
    { dimension: 'ITERATION', weight: 25 },
    { dimension: 'CRITICAL REVIEW', weight: 25 },
    { dimension: 'CODE QUALITY', weight: 20 },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
      <div>
        <SubTitle>CODING_TASK</SubTitle>
        <LiquidMetalCard variant="mercury" style={{ padding: 32, marginTop: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>TASK</div>
          <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 16px', letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{task.title}</h3>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'rgba(255,255,255,0.6)', margin: 0 }}>{task.description}</p>
        </LiquidMetalCard>
        
        <SubTitle>REQUIREMENTS</SubTitle>
        <div style={{ marginTop: 16 }}>
          {task.requirements.map((req, i) => (
            <LiquidMetalCard key={i} variant="dark" style={{ marginBottom: 2, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <CheckCircle size={14} color="rgba(150,255,150,0.6)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{req}</span>
              </div>
            </LiquidMetalCard>
          ))}
        </div>
        
        <div style={{ marginTop: 32 }}>
          <SubTitle>AI_ASSISTANT_CONFIG</SubTitle>
          <LiquidMetalCard variant="default" style={{ marginTop: 16, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))', border: '1px solid rgba(139, 92, 246, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Brain size={20} color="#a78bfa" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 4 }}>CLAUDE SONNET</div>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>HELPFUL · HONEST · HARMLESS</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
              The AI will assist candidates in writing code. Prompts and interactions are recorded for evaluation.
            </div>
          </LiquidMetalCard>
        </div>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RubricCard rubric={rubric} />
        <TimeCard minutes={45} label="TIME LIMIT" />
        <LiquidMetalCard variant="default" style={{ padding: 24 }}>
          <SubTitle>HINTS_AVAILABLE</SubTitle>
          <div style={{ fontSize: 36, fontWeight: 800, marginTop: 16, background: 'linear-gradient(180deg, #fff 0%, rgba(200,200,220,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>3</div>
          <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>MAX HINTS</div>
        </LiquidMetalCard>
      </div>
    </div>
  );
}

function CodeReviewStageConfig() {
  const [showBugs, setShowBugs] = useState(true);
  const [expandedBug, setExpandedBug] = useState(null);
  
  const challenges = [
    {
      id: 1,
      title: 'AUTH HANDLER',
      filename: 'auth_handler.py',
      difficulty: 'HARD',
      timeLimit: 12,
      bugs: [
        { id: 1, line: 4, severity: 'critical', title: 'SQL INJECTION' },
        { id: 2, line: 8, severity: 'high', title: 'WEAK HASHING' },
        { id: 3, line: 12, severity: 'medium', title: 'TIMING ATTACK' },
      ],
      code: `def login(username, password):
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor.execute(query)
    user = cursor.fetchone()
    
    if user and user[2] == hashlib.md5(password.encode()).hexdigest():
        session_token = secrets.token_hex(16)
        cursor.execute(f"UPDATE users SET token = '{session_token}'")
        conn.commit()
        if password == user[2]:
            return {"status": "success", "token": session_token}
    return {"status": "failed"}`
    },
    {
      id: 2,
      title: 'RATE LIMITER',
      filename: 'rate_limiter.py',
      difficulty: 'MEDIUM',
      timeLimit: 10,
      bugs: [
        { id: 4, line: 3, severity: 'high', title: 'RACE CONDITION' },
        { id: 5, line: 7, severity: 'medium', title: 'MEMORY LEAK' },
      ],
      code: `class RateLimiter:
    def __init__(self, max_requests=100, window_seconds=60):
        self.requests = {}
        self.max_requests = max_requests
        self.window = window_seconds
    
    def is_allowed(self, client_id):
        current_time = time.time()
        if client_id not in self.requests:
            self.requests[client_id] = []
        
        self.requests[client_id].append(current_time)
        recent = [t for t in self.requests[client_id] 
                  if current_time - t < self.window]
        self.requests[client_id] = recent
        
        return len(recent) <= self.max_requests`
    }
  ];
  
  const rubric = [
    { dimension: 'BUGS FOUND', weight: 40 },
    { dimension: 'SEVERITY ASSESSMENT', weight: 25 },
    { dimension: 'FIX QUALITY', weight: 25 },
    { dimension: 'CODE QUALITY', weight: 10 },
  ];
  
  const getSeverityStyle = (severity) => {
    switch (severity) {
      case 'critical': return { color: 'rgba(255,100,100,0.9)', bg: 'rgba(255,100,100,0.1)' };
      case 'high': return { color: 'rgba(255,180,100,0.9)', bg: 'rgba(255,180,100,0.1)' };
      case 'medium': return { color: 'rgba(255,230,100,0.9)', bg: 'rgba(255,230,100,0.1)' };
      default: return { color: 'rgba(100,180,255,0.9)', bg: 'rgba(100,180,255,0.1)' };
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <SubTitle>CODE_CHALLENGES</SubTitle>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer' }}>
            <Plus size={10} />ADD CHALLENGE
          </button>
        </div>
        
        {challenges.map((challenge) => (
          <LiquidMetalCard key={challenge.id} variant="dark" style={{ marginBottom: 8 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Code size={14} color="rgba(255,255,255,0.4)" />
                </div>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: '0.1em', color: '#fff', fontWeight: 700 }}>{challenge.title}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{challenge.filename} · {challenge.difficulty} · {challenge.timeLimit}MIN</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>{challenge.bugs.length} BUGS</div>
                <button onClick={() => setShowBugs(!showBugs)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: showBugs ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: showBugs ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer' }}>
                  {showBugs ? <Eye size={10} /> : <EyeOff size={10} />}
                  {showBugs ? 'VISIBLE' : 'HIDDEN'}
                </button>
              </div>
            </div>
            <div style={{ padding: 20, fontSize: 11, lineHeight: 1.8, overflowX: 'auto' }}>
              {challenge.code.split('\n').map((line, lineNum) => {
                const bug = showBugs && challenge.bugs.find(b => b.line === lineNum + 1);
                const style = bug ? getSeverityStyle(bug.severity) : null;
                return (
                  <div key={lineNum} style={{ display: 'flex', background: bug ? style.bg : 'transparent', borderLeft: bug ? `2px solid ${style.color}` : '2px solid transparent', marginLeft: -20, paddingLeft: 18, marginRight: -20, paddingRight: 20 }}>
                    <span style={{ width: 36, paddingRight: 16, textAlign: 'right', color: bug ? style.color : 'rgba(255,255,255,0.15)', userSelect: 'none', flexShrink: 0 }}>{lineNum + 1}</span>
                    <span style={{ color: 'rgba(255,255,255,0.7)', flex: 1, whiteSpace: 'pre' }}>{line || ' '}</span>
                    {bug && <span style={{ fontSize: 8, letterSpacing: '0.1em', color: style.color, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><Bug size={10} />{bug.title}</span>}
                  </div>
                );
              })}
            </div>
          </LiquidMetalCard>
        ))}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RubricCard rubric={rubric} />
        <BugSummaryCard bugs={challenges.flatMap(c => c.bugs)} />
        <TimeCard minutes={22} label="TOTAL TIME" />
      </div>
    </div>
  );
}

function PlanningStageConfig() {
  const scenario = {
    title: 'DESIGN A NOTIFICATION SYSTEM',
    context: 'Your team needs to build a notification system that supports email, SMS, and push notifications.',
    deliverables: ['System architecture diagram', 'API design document', 'Database schema', 'Implementation timeline', 'Risk assessment'],
  };
  
  const rubric = [
    { dimension: 'SYSTEM THINKING', weight: 30 },
    { dimension: 'TECHNICAL DEPTH', weight: 25 },
    { dimension: 'COMMUNICATION', weight: 25 },
    { dimension: 'PRACTICALITY', weight: 20 },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
      <div>
        <SubTitle>PLANNING_SCENARIO</SubTitle>
        <LiquidMetalCard variant="mercury" style={{ padding: 32, marginTop: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>SCENARIO</div>
          <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 16px', letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{scenario.title}</h3>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'rgba(255,255,255,0.6)', margin: 0 }}>{scenario.context}</p>
        </LiquidMetalCard>
        
        <SubTitle>EXPECTED_DELIVERABLES</SubTitle>
        <div style={{ marginTop: 16 }}>
          {scenario.deliverables.map((del, i) => (
            <LiquidMetalCard key={i} variant="dark" style={{ marginBottom: 2, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ListChecks size={14} color="rgba(255,255,255,0.4)" />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{del}</span>
              </div>
            </LiquidMetalCard>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RubricCard rubric={rubric} />
        <TimeCard minutes={60} label="TIME LIMIT" />
      </div>
    </div>
  );
}

function VoiceStageConfig() {
  const questions = [
    { id: 1, category: 'TECHNICAL', question: 'Walk me through how you would design a caching layer for a high-traffic API.', followUps: ['What cache invalidation strategy would you use?'], timeLimit: 10 },
    { id: 2, category: 'BEHAVIORAL', question: 'Tell me about a time you had to push back on a technical decision.', followUps: ['What was the outcome?'], timeLimit: 8 },
  ];
  
  const rubric = [
    { dimension: 'TECHNICAL KNOWLEDGE', weight: 35 },
    { dimension: 'COMMUNICATION', weight: 25 },
    { dimension: 'PROBLEM SOLVING', weight: 25 },
    { dimension: 'CULTURE FIT', weight: 15 },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <SubTitle>INTERVIEW_QUESTIONS</SubTitle>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer' }}>
            <Plus size={10} />ADD QUESTION
          </button>
        </div>
        
        {questions.map((q) => (
          <LiquidMetalCard key={q.id} variant="dark" style={{ marginBottom: 8, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Mic size={14} color="rgba(255,255,255,0.4)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 8, letterSpacing: '0.15em', padding: '4px 8px', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>{q.category}</span>
                  <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>{q.timeLimit} MIN</span>
                </div>
                <div style={{ fontSize: 12, color: '#fff', marginBottom: 12, lineHeight: 1.6 }}>{q.question}</div>
                <div style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>FOLLOW-UPS</div>
                  {q.followUps.map((f, j) => (
                    <div key={j} style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ChevronRight size={10} color="rgba(255,255,255,0.3)" />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </LiquidMetalCard>
        ))}
        
        <div style={{ marginTop: 32 }}>
          <SubTitle>VOICE_SETTINGS</SubTitle>
          <LiquidMetalCard variant="default" style={{ marginTop: 16, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Volume2 size={16} color="#a78bfa" />
              </div>
              <div style={{ fontSize: 11, color: '#fff' }}>NATURAL VOICE AI INTERVIEWER</div>
            </div>
          </LiquidMetalCard>
        </div>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RubricCard rubric={rubric} />
        <TimeCard minutes={30} label="TOTAL TIME" />
      </div>
    </div>
  );
}

function PanelStageConfig() {
  const interviewers = [
    { id: 1, name: 'Sarah Chen', role: 'Engineering Manager', focus: 'Leadership', avatar: 'SC' },
    { id: 2, name: 'Mike Johnson', role: 'Staff Engineer', focus: 'System Design', avatar: 'MJ' },
    { id: 3, name: 'Lisa Park', role: 'Senior Engineer', focus: 'Technical', avatar: 'LP' },
  ];
  
  const rubric = [
    { dimension: 'TECHNICAL ABILITY', weight: 30 },
    { dimension: 'PROBLEM SOLVING', weight: 25 },
    { dimension: 'COLLABORATION', weight: 25 },
    { dimension: 'CULTURE FIT', weight: 20 },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <SubTitle>INTERVIEW_PANEL</SubTitle>
          <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 8, letterSpacing: '0.15em', cursor: 'pointer' }}>
            <UserPlus size={10} />ADD INTERVIEWER
          </button>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
          {interviewers.map(int => (
            <LiquidMetalCard key={int.id} variant="chrome" hover style={{ padding: 24 }}>
              <div style={{ width: 48, height: 48, background: 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(200,200,220,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontSize: 16, fontWeight: 700 }}>{int.avatar}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{int.name}</div>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>{int.role}</div>
              <div style={{ fontSize: 8, letterSpacing: '0.1em', padding: '4px 8px', background: 'rgba(99, 102, 241, 0.2)', color: 'rgba(99, 102, 241, 0.8)', display: 'inline-block' }}>{int.focus}</div>
            </LiquidMetalCard>
          ))}
        </div>
        
        <SubTitle>SCHEDULING</SubTitle>
        <LiquidMetalCard variant="default" style={{ marginTop: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Calendar size={20} color="rgba(255,255,255,0.4)" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#fff', marginBottom: 4 }}>Auto-scheduling enabled</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Finds optimal time slots based on availability</div>
            </div>
          </div>
        </LiquidMetalCard>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RubricCard rubric={rubric} />
        <TimeCard minutes={60} label="DURATION" />
        <LiquidMetalCard variant="default" style={{ padding: 24 }}>
          <SubTitle>PANEL_SIZE</SubTitle>
          <div style={{ fontSize: 36, fontWeight: 800, marginTop: 16, background: 'linear-gradient(180deg, #fff 0%, rgba(200,200,220,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{interviewers.length}</div>
          <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>INTERVIEWERS</div>
        </LiquidMetalCard>
      </div>
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function RubricCard({ rubric }) {
  return (
    <LiquidMetalCard variant="mercury" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <SubTitle>SCORING_RUBRIC</SubTitle>
        <MetalScoreRing value={100} size={48} label="rubric" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rubric.map((item, i) => (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>{item.dimension}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{item.weight}%</span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.06)' }}>
              <div style={{ width: `${item.weight}%`, height: '100%', background: 'linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.8))', boxShadow: '0 0 8px rgba(255,255,255,0.2)' }} />
            </div>
          </div>
        ))}
      </div>
    </LiquidMetalCard>
  );
}

function BugSummaryCard({ bugs }) {
  const counts = {
    critical: bugs.filter(b => b.severity === 'critical').length,
    high: bugs.filter(b => b.severity === 'high').length,
    medium: bugs.filter(b => b.severity === 'medium').length,
    low: bugs.filter(b => b.severity === 'low').length,
  };
  
  return (
    <LiquidMetalCard variant="default" style={{ padding: 24 }}>
      <SubTitle>BUG_SUMMARY</SubTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 20 }}>
        {[
          { label: 'CRITICAL', count: counts.critical, color: 'rgba(255,100,100,0.8)' },
          { label: 'HIGH', count: counts.high, color: 'rgba(255,180,100,0.8)' },
          { label: 'MEDIUM', count: counts.medium, color: 'rgba(255,230,100,0.8)' },
          { label: 'LOW', count: counts.low, color: 'rgba(100,180,255,0.8)' },
        ].map((item, i) => (
          <div key={i} style={{ padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: item.color, marginBottom: 4 }}>{item.count}</div>
            <div style={{ fontSize: 7, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>{item.label}</div>
          </div>
        ))}
      </div>
    </LiquidMetalCard>
  );
}

function TimeCard({ minutes, label }) {
  return (
    <LiquidMetalCard variant="default" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>{label}</div>
          <div style={{ fontSize: 36, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,200,220,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em' }}>{minutes}</div>
          <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)' }}>MINUTES</div>
        </div>
        <Clock size={32} color="rgba(255,255,255,0.15)" />
      </div>
    </LiquidMetalCard>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const pipelineStages = [
  { id: 'screening', name: 'SCREEN', icon: Phone, configured: true },
  { id: 'ai_collab', name: 'AI COLLAB', icon: Zap, configured: true },
  { id: 'code_review', name: 'CODE REV', icon: Code, configured: false },
  { id: 'planning', name: 'PLANNING', icon: FileText, configured: false },
  { id: 'voice', name: 'VOICE', icon: Mic, configured: false },
  { id: 'panel', name: 'PANEL', icon: Users, configured: false },
];

export default function AgenticPipelineBuilder() {
  const [activeSection, setActiveSection] = useState('pipeline');
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState('code_review');
  const [inputValue, setInputValue] = useState('');
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `I've configured your pipeline for Senior Python Engineer. Select a stage to customize.` }
  ]);
  
  useEffect(() => { setMounted(true); }, []);
  
  const handleSend = (text) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInputValue('');
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'll make that adjustment. The stage has been updated." }]);
    }, 800);
  };
  
  const renderStageConfig = () => {
    switch (selectedStage) {
      case 'screening': return <ScreeningStageConfig />;
      case 'ai_collab': return <AICollabStageConfig />;
      case 'code_review': return <CodeReviewStageConfig />;
      case 'planning': return <PlanningStageConfig />;
      case 'voice': return <VoiceStageConfig />;
      case 'panel': return <PanelStageConfig />;
      default: return <CodeReviewStageConfig />;
    }
  };
  
  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
      <ChromeMeshGrid />
      
      {/* Header */}
      <header style={{ padding: '24px 32px', opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(-20px)', transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4</span>
            </div>
            <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))' }}>
              PIPELINE_BUILDER
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button style={{ padding: '10px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', fontSize: 10, letterSpacing: '0.15em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><Play size={12} />PREVIEW</button>
            <button style={{ padding: '10px 24px', background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontSize: 10, letterSpacing: '0.15em', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}><Save size={12} />SAVE PIPELINE</button>
          </div>
        </div>
      </header>
      
      <div style={{ display: 'flex', position: 'relative', minHeight: 'calc(100vh - 140px)' }}>
        {/* Sidebar */}
        <aside style={{ width: 80, padding: '0 16px', borderRight: '1px solid rgba(255,255,255,0.04)', opacity: mounted ? 1 : 0, transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s' }}>
          <SidebarNav activeSection={activeSection} onSectionChange={setActiveSection} isAgentOpen={isAgentOpen} onAgentToggle={() => setIsAgentOpen(!isAgentOpen)} />
        </aside>
        
        {/* Agent Panel */}
        {isAgentOpen && (
          <aside style={{ width: 360, position: 'fixed', left: 80, top: 120, height: 'calc(100vh - 140px)', background: 'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(15,15,25,0.98))', backdropFilter: 'blur(40px) saturate(150%)', borderRight: '1px solid rgba(139, 92, 246, 0.2)', boxShadow: '4px 0 24px rgba(0,0,0,0.3)', zIndex: 9, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '32px 24px 24px', borderBottom: '1px solid rgba(139, 92, 246, 0.15)' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(139, 92, 246, 0.6)', marginBottom: 12 }}>AI_AGENT</div>
              <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, rgba(139, 92, 246, 0.9) 75%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PIPELINE<br />DESIGNER</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }}>
                  <div style={{ padding: '14px 18px', background: msg.role === 'user' ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(59, 130, 246, 0.3))' : 'rgba(255,255,255,0.05)', border: msg.role === 'user' ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255,255,255,0.08)', fontSize: 12, lineHeight: 1.7, color: msg.role === 'user' ? '#fff' : 'rgba(255,255,255,0.7)' }}>{msg.content}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: '16px 24px 24px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', gap: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', padding: '4px 4px 4px 16px' }}>
                <input type="text" placeholder="Ask me anything..." value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && inputValue && handleSend(inputValue)} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 11, fontFamily: '"Space Mono", monospace' }} />
                <button onClick={() => inputValue && handleSend(inputValue)} style={{ width: 40, height: 40, background: inputValue ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.6), rgba(59, 130, 246, 0.5))' : 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Send size={16} /></button>
              </div>
            </div>
          </aside>
        )}
        
        {/* Main */}
        <main style={{ flex: 1, marginLeft: isAgentOpen ? 360 : 0, padding: '0 32px 32px', position: 'relative', transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)', zIndex: 1 }}>
          {/* Info bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, paddingBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: mounted ? 1 : 0, transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>POSITION</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>SR. SOFTWARE ENGINEER</div>
              </div>
              <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>STAGES CONFIGURED</div>
                <div style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {pipelineStages.filter(s => s.configured).length} / {pipelineStages.length}
                </div>
              </div>
            </div>
            <SubTitle>PIPELINE_STAGES</SubTitle>
          </div>
          
          {/* Stage cards */}
          <section style={{ marginBottom: 40 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {pipelineStages.map((stage, i) => (
                <div key={stage.id} style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(20px)', transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${i * 60}ms` }}>
                  <StageCard stage={stage} index={i} isActive={selectedStage === stage.id} isConfigured={stage.configured} onClick={() => setSelectedStage(stage.id)} />
                </div>
              ))}
            </div>
          </section>
          
          {/* Stage Config */}
          <div style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.5s' }}>
            {renderStageConfig()}
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