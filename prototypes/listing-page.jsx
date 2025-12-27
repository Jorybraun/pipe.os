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
  Users,
  CheckCircle,
  Activity,
  ChevronRight,
  Building,
  MapPin,
  Calendar,
  TrendingUp,
  Archive,
  Search,
  Filter,
  MoreHorizontal,
  Briefcase,
  Zap,
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
    { id: 'roles', icon: Briefcase },
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
// MOCK DATA
// ============================================================================

const mockRoles = [
  {
    id: 1,
    title: 'SR. SOFTWARE ENGINEER',
    department: 'ENGINEERING',
    location: 'SAN FRANCISCO, CA',
    status: 'active',
    candidates: 12,
    stagesConfigured: 6,
    totalStages: 6,
    createdAt: '2024-12-15',
    avgScore: 82,
  },
  {
    id: 2,
    title: 'PRODUCT MANAGER',
    department: 'PRODUCT',
    location: 'NEW YORK, NY',
    status: 'active',
    candidates: 8,
    stagesConfigured: 5,
    totalStages: 6,
    createdAt: '2024-12-10',
    avgScore: 78,
  },
  {
    id: 3,
    title: 'STAFF ENGINEER',
    department: 'ENGINEERING',
    location: 'REMOTE',
    status: 'draft',
    candidates: 0,
    stagesConfigured: 3,
    totalStages: 6,
    createdAt: '2024-12-18',
    avgScore: null,
  },
  {
    id: 4,
    title: 'ENGINEERING MANAGER',
    department: 'ENGINEERING',
    location: 'SEATTLE, WA',
    status: 'active',
    candidates: 5,
    stagesConfigured: 6,
    totalStages: 6,
    createdAt: '2024-12-01',
    avgScore: 85,
  },
  {
    id: 5,
    title: 'SENIOR DESIGNER',
    department: 'DESIGN',
    location: 'LOS ANGELES, CA',
    status: 'closed',
    candidates: 24,
    stagesConfigured: 6,
    totalStages: 6,
    createdAt: '2024-11-20',
    avgScore: 79,
  },
  {
    id: 6,
    title: 'DATA SCIENTIST',
    department: 'DATA',
    location: 'AUSTIN, TX',
    status: 'active',
    candidates: 3,
    stagesConfigured: 4,
    totalStages: 6,
    createdAt: '2024-12-19',
    avgScore: 88,
  },
];

// ============================================================================
// ROLE CARD COMPONENT
// ============================================================================

function RoleCard({ role, onClick, index }) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), index * 80);
    return () => clearTimeout(timer);
  }, [index]);

  const getStatusStyle = (status) => {
    switch (status) {
      case 'active': return { color: 'rgba(150,255,150,0.8)', bg: 'rgba(150,255,150,0.1)', label: 'ACTIVE' };
      case 'draft': return { color: 'rgba(255,200,100,0.8)', bg: 'rgba(255,200,100,0.1)', label: 'DRAFT' };
      case 'closed': return { color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)', label: 'CLOSED' };
      default: return { color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)', label: status.toUpperCase() };
    }
  };

  const statusStyle = getStatusStyle(role.status);
  const isComplete = role.stagesConfigured === role.totalStages;

  return (
    <div style={{
      opacity: mounted ? 1 : 0,
      transform: mounted ? 'translateY(0)' : 'translateY(20px)',
      transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <LiquidMetalCard 
        variant={role.status === 'active' ? 'chrome' : 'default'} 
        hover 
        onClick={onClick}
      >
        {/* Header */}
        <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            {/* Status badge */}
            <div style={{
              fontSize: 8,
              letterSpacing: '0.2em',
              padding: '4px 10px',
              background: statusStyle.bg,
              color: statusStyle.color,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {role.status === 'active' && <Activity size={8} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />}
              {statusStyle.label}
            </div>
            
            {/* More options */}
            <button style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }}>
              <MoreHorizontal size={16} />
            </button>
          </div>
          
          {/* Title */}
          <h3 style={{
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            margin: '0 0 12px',
            background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {role.title}
          </h3>
          
          {/* Meta info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Building size={10} color="rgba(255,255,255,0.25)" />
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>{role.department}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={10} color="rgba(255,255,255,0.25)" />
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)' }}>{role.location}</span>
            </div>
          </div>
        </div>
        
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Candidates */}
          <div style={{ padding: 20, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>CANDIDATES</div>
            <div style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {role.candidates}
            </div>
          </div>
          
          {/* Avg Score */}
          <div style={{ padding: 20, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>AVG SCORE</div>
            <div style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              background: role.avgScore 
                ? 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(200,210,230,0.15) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {role.avgScore || '—'}
            </div>
          </div>
          
          {/* Stages */}
          <div style={{ padding: 20 }}>
            <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>STAGES</div>
            <div style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              background: isComplete 
                ? 'linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)'
                : 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {role.stagesConfigured}/{role.totalStages}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={10} color="rgba(255,255,255,0.25)" />
            <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>
              CREATED {new Date(role.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}
            </span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.5)' }}>
            <span style={{ fontSize: 9, letterSpacing: '0.1em' }}>VIEW PIPELINE</span>
            <ChevronRight size={12} />
          </div>
        </div>
        
        {/* Progress bar */}
        <div style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            width: `${(role.stagesConfigured / role.totalStages) * 100}%`,
            height: '100%',
            background: isComplete 
              ? 'linear-gradient(90deg, rgba(150,255,150,0.4), rgba(150,255,150,0.8))'
              : 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))',
            boxShadow: isComplete ? '0 0 10px rgba(150,255,150,0.3)' : '0 0 10px rgba(255,255,255,0.2)',
          }} />
        </div>
      </LiquidMetalCard>
    </div>
  );
}

// ============================================================================
// STATS CARDS
// ============================================================================

function StatsCard({ label, value, icon: Icon, trend }) {
  return (
    <LiquidMetalCard variant="dark" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>{label}</div>
          <div style={{
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {value}
          </div>
          {trend && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
              <TrendingUp size={10} color="rgba(150,255,150,0.8)" />
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(150,255,150,0.8)' }}>{trend}</span>
            </div>
          )}
        </div>
        <div style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color="rgba(255,255,255,0.3)" />
        </div>
      </div>
    </LiquidMetalCard>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RolesListing() {
  const [activeSection, setActiveSection] = useState('roles');
  const [mounted, setMounted] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [filter, setFilter] = useState('all');
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredRoles = filter === 'all' 
    ? mockRoles 
    : mockRoles.filter(r => r.status === filter);

  const stats = {
    totalRoles: mockRoles.length,
    activeRoles: mockRoles.filter(r => r.status === 'active').length,
    totalCandidates: mockRoles.reduce((sum, r) => sum + r.candidates, 0),
    avgScore: Math.round(mockRoles.filter(r => r.avgScore).reduce((sum, r) => sum + r.avgScore, 0) / mockRoles.filter(r => r.avgScore).length),
  };

  // Placeholder view when a role is selected
  if (selectedRole) {
    return (
      <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
        <ChromeMeshGrid />
        
        <header style={{ padding: '24px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
            <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4</span>
          </div>
          <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))' }}>
            PIPELINE_VIEW
          </h1>
        </header>
        
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 140px)' }}>
          <aside style={{ width: 80, padding: '0 16px', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
            <SidebarNav activeSection="pipeline" onSectionChange={setActiveSection} />
          </aside>
          
          <main style={{ flex: 1, padding: '0 32px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <LiquidMetalCard variant="mercury" style={{ padding: 60, textAlign: 'center', maxWidth: 600 }}>
              <div style={{ width: 80, height: 80, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px' }}>
                <Target size={32} color="rgba(255,255,255,0.4)" />
              </div>
              
              <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>VIEWING PIPELINE FOR</div>
              
              <h2 style={{
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                margin: '0 0 24px',
                background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {selectedRole.title}
              </h2>
              
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, marginBottom: 32 }}>
                This is a placeholder for the pipeline view. The full pipeline interface with candidates and stages would be displayed here.
              </p>
              
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button 
                  onClick={() => setSelectedRole(null)}
                  style={{ padding: '12px 24px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', fontSize: 10, letterSpacing: '0.15em', cursor: 'pointer' }}
                >
                  ← BACK TO ROLES
                </button>
                <button style={{ padding: '12px 24px', background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontSize: 10, letterSpacing: '0.15em', fontWeight: 700, cursor: 'pointer' }}>
                  VIEW CANDIDATES
                </button>
              </div>
            </LiquidMetalCard>
          </main>
        </div>
        
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
      <ChromeMeshGrid />
      
      {/* Header */}
      <header style={{
        padding: '24px 32px',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4</span>
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
              ROLES
            </h1>
          </div>
          
          {/* Create New Role Button */}
          <button 
            onClick={() => window.location.href = '/pipeline-builder'}
            style={{ 
              padding: '14px 28px', 
              background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))', 
              border: '1px solid rgba(255,255,255,0.2)', 
              color: '#fff', 
              fontSize: 11, 
              letterSpacing: '0.15em', 
              fontWeight: 700, 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <Plus size={16} />
            CREATE NEW ROLE
          </button>
        </div>
      </header>
      
      <div style={{ display: 'flex', position: 'relative', minHeight: 'calc(100vh - 140px)' }}>
        {/* Sidebar */}
        <aside style={{
          width: 80,
          padding: '0 16px',
          borderRight: '1px solid rgba(255,255,255,0.04)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
        }}>
          <SidebarNav activeSection={activeSection} onSectionChange={setActiveSection} />
        </aside>
        
        {/* Main Content */}
        <main style={{ flex: 1, padding: '0 32px 32px', position: 'relative', zIndex: 1 }}>
          {/* Stats Row */}
          <section style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            marginBottom: 40,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
          }}>
            <StatsCard label="TOTAL ROLES" value={stats.totalRoles} icon={Briefcase} />
            <StatsCard label="ACTIVE ROLES" value={stats.activeRoles} icon={Activity} trend="+2 THIS WEEK" />
            <StatsCard label="TOTAL CANDIDATES" value={stats.totalCandidates} icon={Users} trend="+15 THIS WEEK" />
            <StatsCard label="AVG SCORE" value={stats.avgScore} icon={TrendingUp} />
          </section>
          
          {/* Filter Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.4s',
          }}>
            <SubTitle>ALL_ROLES</SubTitle>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Search */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                padding: '8px 16px', 
                background: 'rgba(255,255,255,0.03)', 
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <Search size={12} color="rgba(255,255,255,0.3)" />
                <input 
                  type="text" 
                  placeholder="Search roles..." 
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    outline: 'none', 
                    color: '#fff', 
                    fontSize: 10, 
                    letterSpacing: '0.1em',
                    fontFamily: '"Space Mono", monospace',
                    width: 120,
                  }} 
                />
              </div>
              
              {/* Filter buttons */}
              <div style={{ display: 'flex', gap: 2 }}>
                {['all', 'active', 'draft', 'closed'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: '8px 14px',
                      background: filter === f ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: filter === f ? '#fff' : 'rgba(255,255,255,0.4)',
                      fontSize: 8,
                      letterSpacing: '0.15em',
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          {/* Roles Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: 16,
          }}>
            {filteredRoles.map((role, i) => (
              <RoleCard 
                key={role.id} 
                role={role} 
                index={i}
                onClick={() => setSelectedRole(role)} 
              />
            ))}
            
            {/* Create New Role Card */}
            <div style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(20px)',
              transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${filteredRoles.length * 80}ms`,
            }}>
              <LiquidMetalCard 
                variant="default" 
                hover 
                onClick={() => window.location.href = '/pipeline-builder'}
                style={{ 
                  minHeight: 280,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px dashed rgba(255,255,255,0.15)',
                }}
              >
                <div style={{ 
                  width: 64, 
                  height: 64, 
                  background: 'rgba(255,255,255,0.05)', 
                  border: '1px solid rgba(255,255,255,0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: 20,
                }}>
                  <Plus size={24} color="rgba(255,255,255,0.4)" />
                </div>
                <div style={{ fontSize: 12, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                  CREATE NEW ROLE
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                  Set up a new hiring pipeline
                </div>
              </LiquidMetalCard>
            </div>
          </div>
        </main>
      </div>
      
      {/* Global styles */}
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