import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Mail, Phone, MapPin, Linkedin, Github, Globe, 
  Sparkles, TrendingUp, Target, Brain, Clock, Calendar,
  ChevronRight, Download, MessageSquare, AlertTriangle,
  CheckCircle, FileText, Code, Mic, Users, Zap, ArrowUpRight,
  Briefcase, Award, Activity
} from 'lucide-react';
import { LiquidMetal } from '@paper-design/shaders-react';

const candidate = {
  id: 1,
  name: 'David Kim',
  email: 'david.kim@example.com',
  phone: '+1 (555) 123-4567',
  location: 'San Francisco, CA',
  timezone: 'PST (UTC-8)',
  currentTitle: 'Staff Engineer',
  currentCompany: 'Netflix',
  yearsExperience: 8,
  avatar: 'DK',
  tags: ['strong', 'priority'],
};

const profile = {
  executiveSummary: `Exceptional distributed systems expertise with proven technical leadership at scale. Netflix experience positions him well for senior roles requiring hands-on skills and architectural vision. Outstanding AI collaboration demonstrated in Stage 1.`,
  
  roleFitScore: 0.91,
  cultureFitScore: 0.85,
  growthPotentialScore: 0.88,
  
  aiRecommendation: 'strong_yes',
  recommendationReasoning: 'Exceeds requirements in technical depth and AI collaboration. Strong contributor from day one.',
  
  recommendedQuestions: [
    { question: 'Describe refactoring a critical system with zero downtime.', rationale: 'System design validation', lookFor: 'Risk mitigation approach' },
    { question: 'How do you mentor engineers with different learning styles?', rationale: 'Leadership assessment', lookFor: 'Adaptability & empathy' },
  ],
};

const assessments = [
  { name: 'SCREEN', status: 'completed', score: 85, icon: Phone },
  { name: 'AI COLLAB', status: 'completed', score: 91, icon: Sparkles },
  { name: 'CODE REV', status: 'in_progress', score: null, icon: Code },
  { name: 'PLANNING', status: 'pending', score: null, icon: FileText },
  { name: 'VOICE', status: 'pending', score: null, icon: Mic },
  { name: 'PANEL', status: 'pending', score: null, icon: Users },
];

const signals = [
  { type: 'strength', title: 'PROMPT CLARITY', desc: 'Clear, specific prompts that effectively guided AI.', confidence: 92 },
  { type: 'strength', title: 'CODE REVIEW', desc: 'Found 3 bugs including subtle edge case.', confidence: 88 },
  { type: 'strength', title: 'DECOMPOSITION', desc: '5 logical subtasks with clear success criteria.', confidence: 85 },
  { type: 'concern', title: 'FRONTEND EXP', desc: 'Backend focused. May need ramp-up time.', confidence: 72 },
];

const skills = [
  { name: 'PYTHON', level: 95 },
  { name: 'GO', level: 78 },
  { name: 'DISTRIBUTED', level: 90 },
  { name: 'K8S', level: 72 },
  { name: 'AWS', level: 80 },
  { name: 'SYS DESIGN', level: 92 },
];

// Liquid Metal Card Component
const LiquidMetalCard = ({ children, style = {}, variant = 'default', hover = false }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  const variants = {
    default: {
      background: `
        linear-gradient(135deg, 
          rgba(180, 180, 190, 0.08) 0%, 
          rgba(120, 120, 140, 0.04) 25%,
          rgba(200, 200, 210, 0.08) 50%,
          rgba(100, 100, 120, 0.04) 75%,
          rgba(160, 160, 180, 0.08) 100%
        )
      `,
      border: '1px solid rgba(255, 255, 255, 0.12)',
    },
    chrome: {
      background: `
        linear-gradient(135deg,
          rgba(220, 220, 230, 0.15) 0%,
          rgba(180, 180, 200, 0.08) 20%,
          rgba(255, 255, 255, 0.2) 40%,
          rgba(160, 160, 180, 0.08) 60%,
          rgba(200, 200, 220, 0.12) 80%,
          rgba(140, 140, 160, 0.08) 100%
        )
      `,
      border: '1px solid rgba(255, 255, 255, 0.2)',
    },
    mercury: {
      background: `
        linear-gradient(160deg,
          rgba(200, 210, 230, 0.12) 0%,
          rgba(180, 190, 220, 0.06) 30%,
          rgba(220, 225, 240, 0.15) 50%,
          rgba(170, 180, 210, 0.08) 70%,
          rgba(190, 200, 225, 0.1) 100%
        )
      `,
      border: '1px solid rgba(200, 210, 240, 0.15)',
    },
  };
  
  const v = variants[variant];
  
  return (
    <div
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
        ...style,
      }}
    >
      {/* Chrome reflection sweep */}
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
};

// Liquid Metal Score Ring
const MetalScoreRing = ({ value, size = 120, label }) => {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;
  
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {/* Glow effect */}
      <div style={{
        position: 'absolute',
        inset: 10,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(200,210,230,0.15) 0%, transparent 70%)',
        filter: 'blur(10px)',
      }} />
      
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Chrome gradient progress */}
        <defs>
          <linearGradient id={`chrome-${label}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
            <stop offset="25%" stopColor="rgba(200,200,220,0.7)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="75%" stopColor="rgba(180,180,200,0.7)" />
            <stop offset="100%" stopColor="rgba(220,220,240,0.9)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#chrome-${label})`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: '"Monument Extended", "Space Grotesk", sans-serif',
          fontSize: 32,
          fontWeight: 800,
          background: 'linear-gradient(180deg, #fff 0%, rgba(200,200,220,0.8) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.02em',
        }}>
          {value}
        </span>
        {label && (
          <span style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: 8,
            letterSpacing: '0.25em',
            color: 'rgba(255,255,255,0.4)',
            marginTop: 4,
          }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
};

const oldHeadr = () => {
     <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(12, 12, 14, 0.7)',
        backdropFilter: 'blur(40px) saturate(150%)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'stretch',
          height: 80,
        }}>
          {/* Back */}
          <button style={{
            width: 80,
            background: 'transparent',
            border: 'none',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s',
          }}>
            <ArrowLeft size={20} color="rgba(255,255,255,0.6)" />
          </button>
          
          {/* Title */}
          <div style={{
            padding: '0 40px',
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div>
              <div style={{
                fontSize: 9,
                letterSpacing: '0.4em',
                color: 'rgba(255,255,255,0.3)',
                marginBottom: 6,
              }}>
                CANDIDATE
              </div>
              <div style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 50%, #fff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {candidate.name.toUpperCase()}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: 8 }}>
              {candidate.tags.map(tag => (
                <span key={tag} style={{
                  padding: '8px 14px',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  fontSize: 9,
                  letterSpacing: '0.2em',
                  color: 'rgba(255,255,255,0.8)',
                }}>
                  {tag.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
          
          <div style={{ flex: 1 }} />
          
          {/* Actions */}
          <button style={{
            padding: '0 40px',
            background: `
              linear-gradient(135deg,
                rgba(255,255,255,0.2) 0%,
                rgba(200,200,220,0.1) 25%,
                rgba(255,255,255,0.25) 50%,
                rgba(180,180,200,0.1) 75%,
                rgba(220,220,240,0.15) 100%
              )
            `,
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.2em',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            transition: 'all 0.3s',
          }}>
            ADVANCE STAGE
            <ArrowUpRight size={14} />
          </button>
        </div>
      </header>

}

const NewHeader = () => {
  return <header style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 60 }}>
                <div>
                  <SubTitle>
                    PIPE_OS // V.2.0.4
                  </SubTitle>
                  <h1 style={{ 
                    fontSize: 48, 
                    fontFamily: '"Monument Extended", sans-serif',
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    margin: 0,
                    background: 'linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.5) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}>
                    CANDIDATE_PROFILE
                  </h1>
                </div>
      
                {/* <div style={{ display: 'flex', gap: 20 }}>
                  <LiquidMetalCard variant="chrome" style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Briefcase size={16} />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{candidate.currentTitle}</span>
                  </LiquidMetalCard>
                  <LiquidMetalCard variant="chrome" style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Award size={16} />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{candidate.yearsExperience} YOE</span>
                  </LiquidMetalCard>
                </div> */}
              </header>
}

const SubTitle = ({ children }) => {
                    return <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 12,
                    marginBottom: 8 
                  }}>
                    <div style={{ width: 8, height: 8, background: '#fff', boxShadow: '0 0 10px #fff' }} />
                    <span style={{ fontSize: 12, letterSpacing: '0.2em', opacity: 0.7 }}>{ children }</span></div>
}

export default function CandidateProfileLiquidMetal() {
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [time, setTime] = useState(0);
  
  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    
    const interval = setInterval(() => {
      setTime(t => t + 0.02);
    }, 50);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearInterval(interval);
    };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0c0c0e',
      fontFamily: '"Space Mono", monospace',
      color: '#fff',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Animated liquid metal background */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.4, // Adjust opacity to blend with content
      }}>
        <LiquidMetal
          width={1920} // Increased resolution for better quality on larger screens
          height={1080}
          image="../public/mario-pipe.svg"
          colorBack="#aaaaac"
          colorTint="#ffffff"
          shape="diamond"
          repetition={2}
          softness={0.1}
          shiftRed={0.3}
          shiftBlue={0.3}
          distortion={0.07}
          contour={0.4}
          angle={70}
          speed={1}
          scale={0.6}
          fit="cover" // Changed to cover to fill the screen
        />
      </div>
      
      {/* Chrome mesh grid */}
      <div style={{
        position: 'fixed',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
        `,
        backgroundSize: '80px 80px',
        pointerEvents: 'none',
      }} />
      
      {/* Floating chrome orbs */}
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          style={{
            position: 'fixed',
            width: 200 + i * 100,
            height: 200 + i * 100,
            borderRadius: '50%',
            background: `
              radial-gradient(
                ellipse at ${30 + Math.sin(time + i) * 20}% ${30 + Math.cos(time + i) * 20}%,
                rgba(255,255,255,0.15) 0%,
                rgba(200,210,230,0.08) 30%,
                rgba(180,190,220,0.04) 60%,
                transparent 100%
              )
            `,
            left: `${10 + i * 20}%`,
            top: `${20 + (i % 3) * 25}%`,
            filter: 'blur(60px)',
            pointerEvents: 'none',
            transform: `translate(${Math.sin(time * 0.5 + i) * 30}px, ${Math.cos(time * 0.3 + i) * 30}px)`,
            transition: 'transform 2s ease-out',
          }}
        />
      ))}

      {/* Header */}
      <NewHeader></NewHeader>
      <main style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '24px 20px',
        position: 'relative',
      }}>
        {/* Hero Grid */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr 200px',
          gap: 24,
          marginBottom: 60,
        }}>
          {/* Avatar Block */}
          <LiquidMetalCard variant="chrome" hover style={{ padding: 0 }}>
            <div style={{
              height: 320,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              background: `
                radial-gradient(
                  ellipse at 30% 30%,
                  rgba(255,255,255,0.15) 0%,
                  transparent 50%
                ),
                radial-gradient(
                  ellipse at 70% 70%,
                  rgba(200,210,230,0.1) 0%,
                  transparent 50%
                )
              `,
            }}>
              {/* Large liquid metal monogram */}
              <div style={{
                fontSize: 120,
                fontWeight: 900,
                background: `
                  linear-gradient(135deg,
                    rgba(255,255,255,1) 0%,
                    rgba(200,200,220,0.7) 20%,
                    rgba(255,255,255,0.95) 40%,
                    rgba(180,190,210,0.6) 60%,
                    rgba(220,220,240,0.9) 80%,
                    rgba(255,255,255,1) 100%
                  )
                `,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 10px 40px rgba(200,210,230,0.3))',
                letterSpacing: '0.05em',
              }}>
                {candidate.avatar}
              </div>
            </div>
            
            {/* Contact info */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {[
                { icon: Briefcase, value: candidate.currentCompany },
                { icon: MapPin, value: candidate.location },
                { icon: Mail, value: candidate.email },
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '16px 24px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  fontSize: 11,
                  letterSpacing: '0.05em',
                  color: 'rgba(255,255,255,0.5)',
                }}>
                  <item.icon size={14} color="rgba(255,255,255,0.25)" />
                  {item.value.toUpperCase()}
                </div>
              ))}
            </div>
          </LiquidMetalCard>

          {/* AI Recommendation */}
          <LiquidMetalCard variant="mercury" hover style={{ padding: 48 }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 40,
            }}>
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 20,
                }}>
                  {/* <span style={{
                    fontSize: 9,
                    letterSpacing: '0.4em',
                    color: 'rgba(255,255,255,0.4)',
                  }}>
                    AI VERDICT
                  </span> */}
                  <SubTitle>
                    AI_VERDICT
                  </SubTitle>
                </div>
                
                <div style={{
                  fontSize: 72,
                  fontWeight: 900,
                  lineHeight: 0.85,
                  letterSpacing: '-0.03em',
                  background: `
                    linear-gradient(135deg,
                      #fff 0%,
                      rgba(200,210,230,0.8) 25%,
                      #fff 50%,
                      rgba(180,190,220,0.7) 75%,
                      rgba(240,240,250,0.9) 100%
                    )
                  `,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))',
                }}>
                  STRONG<br/>YES
                </div>
              </div>
              
              <MetalScoreRing value={91} label="AVG" />
            </div>
            
            <div style={{
              padding: 24,
              background: 'rgba(0,0,0,0.2)',
              borderLeft: '2px solid rgba(255,255,255,0.2)',
              fontSize: 13,
              lineHeight: 1.7,
              color: 'rgba(255,255,255,0.6)',
              letterSpacing: '0.02em',
            }}>
              {profile.recommendationReasoning}
            </div>
          </LiquidMetalCard>

          {/* Score Stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'ROLE', value: profile.roleFitScore },
              { label: 'CULTURE', value: profile.cultureFitScore },
              { label: 'GROWTH', value: profile.growthPotentialScore },
            ].map((item, i) => (
              <LiquidMetalCard key={i} hover style={{ flex: 1, padding: 20 }}>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  justifyContent: 'space-between',
                }}>
                  <span style={{
                    fontSize: 8,
                    letterSpacing: '0.3em',
                    color: 'rgba(255,255,255,0.3)',
                  }}>
                    {item.label}
                  </span>
                  
                  <span style={{
                    fontSize: 36,
                    fontWeight: 800,
                    background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    letterSpacing: '-0.02em',
                  }}>
                    {Math.round(item.value * 100)}
                  </span>
                  
                  {/* Chrome bar */}
                  <div style={{
                    height: 3,
                    background: 'rgba(255,255,255,0.06)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: `${item.value * 100}%`,
                      background: 'linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.8), rgba(200,210,230,0.6))',
                      boxShadow: '0 0 15px rgba(255,255,255,0.3)',
                    }} />
                  </div>
                </div>
              </LiquidMetalCard>
            ))}
          </div>
        </section>

        {/* Assessment Pipeline */}
        <section style={{ marginBottom: 60 }}>
          <div style={{
            fontSize: 9,
            letterSpacing: '0.4em',
            color: 'rgba(255,255,255,0.3)',
            marginBottom: 20,
          }}>
            PIPELINE STATUS
          </div>
          
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 2,
          }}>
            {assessments.map((a, i) => {
              const Icon = a.icon;
              const isComplete = a.status === 'completed';
              const isActive = a.status === 'in_progress';
              
              return (
                <LiquidMetalCard
                  key={i}
                  variant={isActive ? 'chrome' : 'default'}
                  hover
                  style={{
                    padding: 24,
                    opacity: !isComplete && !isActive ? 0.4 : 1,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}>
                    <Icon size={16} color={isActive ? '#fff' : 'rgba(255,255,255,0.4)'} />
                    {isComplete && <CheckCircle size={12} color="rgba(150,255,150,0.8)" />}
                    {isActive && (
                      <Activity size={12} color="rgba(255,255,255,0.8)" style={{
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                    )}
                  </div>
                  
                  <div style={{
                    fontSize: 9,
                    letterSpacing: '0.2em',
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                    marginBottom: 8,
                  }}>
                    {a.name}
                  </div>
                  
                  {isComplete && (
                    <div style={{
                      fontSize: 28,
                      fontWeight: 800,
                      background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}>
                      {a.score}
                    </div>
                  )}
                </LiquidMetalCard>
              );
            })}
          </div>
        </section>

        {/* Signals + Skills */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: '1fr 360px',
          gap: 24,
          marginBottom: 60,
        }}>
          {/* Signals */}
          <div>
            <div style={{
              fontSize: 9,
              letterSpacing: '0.4em',
              color: 'rgba(255,255,255,0.3)',
              marginBottom: 20,
            }}>
              DETECTED SIGNALS
            </div>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 16,
            }}>
              {signals.map((s, i) => (
                <LiquidMetalCard
                  key={i}
                  variant={s.type === 'strength' ? 'mercury' : 'default'}
                  hover
                  style={{ padding: 24 }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 16,
                  }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      background: s.type === 'strength'
                        ? 'linear-gradient(135deg, rgba(150,255,150,0.15), rgba(100,200,150,0.08))'
                        : 'linear-gradient(135deg, rgba(255,200,100,0.15), rgba(200,150,100,0.08))',
                      border: `1px solid ${s.type === 'strength' ? 'rgba(150,255,150,0.2)' : 'rgba(255,200,100,0.2)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {s.type === 'strength' 
                        ? <CheckCircle size={12} color="rgba(150,255,150,0.8)" />
                        : <AlertTriangle size={12} color="rgba(255,200,100,0.8)" />
                      }
                    </div>
                    <span style={{
                      fontSize: 8,
                      letterSpacing: '0.2em',
                      color: 'rgba(255,255,255,0.4)',
                      padding: '4px 8px',
                      background: 'rgba(255,255,255,0.03)',
                    }}>
                      {s.confidence}%
                    </span>
                  </div>
                  
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: '#fff',
                    marginBottom: 8,
                  }}>
                    {s.title}
                  </div>
                  
                  <div style={{
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: 'rgba(255,255,255,0.5)',
                  }}>
                    {s.desc}
                  </div>
                </LiquidMetalCard>
              ))}
            </div>
          </div>

          {/* Skills */}
          <LiquidMetalCard variant="chrome" style={{ padding: 28 }}>
            <div style={{
              fontSize: 9,
              letterSpacing: '0.4em',
              color: 'rgba(255,255,255,0.3)',
              marginBottom: 28,
            }}>
              SKILL MATRIX
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {skills.map((skill, i) => (
                <div key={i}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}>
                    <span style={{
                      fontSize: 10,
                      letterSpacing: '0.15em',
                      color: 'rgba(255,255,255,0.6)',
                    }}>
                      {skill.name}
                    </span>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#fff',
                    }}>
                      {skill.level}
                    </span>
                  </div>
                  
                  <div style={{
                    height: 6,
                    background: 'rgba(255,255,255,0.05)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: `${skill.level}%`,
                      background: `
                        linear-gradient(90deg,
                          rgba(200,210,230,0.3) 0%,
                          rgba(255,255,255,0.7) 50%,
                          rgba(180,190,220,0.5) 100%
                        )
                      `,
                      boxShadow: '0 0 20px rgba(200,210,230,0.4)',
                      transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </LiquidMetalCard>
        </section>

        {/* Questions */}
        <section>
          <div style={{
            fontSize: 9,
            letterSpacing: '0.4em',
            color: 'rgba(255,255,255,0.3)',
            marginBottom: 20,
          }}>
            INTERVIEW PROMPTS
          </div>
          
          <div style={{ display: 'flex', gap: 24 }}>
            {profile.recommendedQuestions.map((q, i) => (
              <LiquidMetalCard
                key={i}
                variant="mercury"
                hover
                style={{ flex: 1, padding: 0, display: 'flex' }}
              >
                {/* Number */}
                <div style={{
                  width: 80,
                  background: `
                    linear-gradient(180deg,
                      rgba(255,255,255,0.08) 0%,
                      transparent 100%
                    )
                  `,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRight: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <span style={{
                    fontSize: 48,
                    fontWeight: 900,
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.15), transparent)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                
                <div style={{ flex: 1, padding: 28 }}>
                  <p style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: '#fff',
                    margin: '0 0 20px',
                    fontStyle: 'italic',
                  }}>
                    "{q.question}"
                  </p>
                  
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 16,
                  }}>
                    <div>
                      <div style={{
                        fontSize: 8,
                        letterSpacing: '0.25em',
                        color: 'rgba(255,255,255,0.3)',
                        marginBottom: 6,
                      }}>
                        RATIONALE
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.6)',
                      }}>
                        {q.rationale}
                      </div>
                    </div>
                    <div>
                      <div style={{
                        fontSize: 8,
                        letterSpacing: '0.25em',
                        color: 'rgba(255,255,255,0.3)',
                        marginBottom: 6,
                      }}>
                        LOOK FOR
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.6)',
                      }}>
                        {q.lookFor}
                      </div>
                    </div>
                  </div>
                </div>
              </LiquidMetalCard>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.04)',
        padding: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <Zap size={12} color="rgba(200,210,230,0.5)" />
        <span style={{
          fontSize: 9,
          letterSpacing: '0.4em',
          color: 'rgba(255,255,255,0.2)',
        }}>
          PIPE AI
        </span>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        
        * {
          box-sizing: border-box;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.95); }
        }
        
        button:hover {
          filter: brightness(1.1);
        }
      `}</style>
    </div>
  );
}