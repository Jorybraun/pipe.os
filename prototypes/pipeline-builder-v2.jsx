import React, { useState, useEffect } from 'react';
import { 
  Sparkles, Plus, Trash2, GripVertical, ChevronRight, ChevronDown,
  Phone, Zap, Code, Mic, Users, Target, Building, Briefcase, MapPin,
  Eye, Save, Play, Check, CheckCircle, Clock, Video, VideoOff, BarChart3,
  Lightbulb, Brain, ListChecks, AlertCircle, RefreshCw, ArrowRight,
  User, DollarSign, TrendingUp, Calendar, FileText, MessageSquare,
  Loader, CheckCheck, X, Edit3, Copy, Wand2
} from 'lucide-react';

// ============================================================================
// DESIGN SYSTEM
// ============================================================================

function LiquidMetalCard({ children, style = {}, variant = 'default', hover = false, onClick }) {
  const [isHovered, setIsHovered] = useState(false);
  
  const variants = {
    default: {
      background: `linear-gradient(135deg, rgba(180, 180, 190, 0.08) 0%, rgba(120, 120, 140, 0.04) 25%, rgba(200, 200, 210, 0.08) 50%, rgba(100, 100, 120, 0.04) 75%, rgba(160, 160, 180, 0.08) 100%)`,
      border: '1px solid rgba(255, 255, 255, 0.12)',
    },
    chrome: {
      background: `linear-gradient(135deg, rgba(220, 220, 230, 0.15) 0%, rgba(180, 180, 200, 0.08) 20%, rgba(255, 255, 255, 0.2) 40%, rgba(160, 160, 180, 0.08) 60%, rgba(200, 200, 220, 0.12) 80%, rgba(140, 140, 160, 0.08) 100%)`,
      border: '1px solid rgba(255, 255, 255, 0.2)',
    },
    dark: {
      background: `linear-gradient(135deg, rgba(40, 40, 50, 0.6) 0%, rgba(60, 60, 80, 0.5) 50%, rgba(30, 30, 40, 0.7) 100%)`,
      border: '1px solid rgba(255, 255, 255, 0.1)',
    },
    ai: {
      background: `linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(99, 102, 241, 0.1) 50%, rgba(139, 92, 246, 0.12) 100%)`,
      border: '1px solid rgba(139, 92, 246, 0.3)',
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
        boxShadow: isHovered ? '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' : 'inset 0 1px 0 rgba(255,255,255,0.1)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SubTitle({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
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
      backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)`,
      backgroundSize: '80px 80px',
      pointerEvents: 'none',
      zIndex: 0,
    }} />
  );
}

// ============================================================================
// AGENT PANEL COMPONENTS (Not a chatbot - structured agent interface)
// ============================================================================

function AgentTaskItem({ task, isActive, isComplete, isPending }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '12px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      opacity: isPending ? 0.4 : 1,
    }}>
      <div style={{
        width: 24,
        height: 24,
        flexShrink: 0,
        background: isComplete ? 'rgba(150,255,150,0.15)' : isActive ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${isComplete ? 'rgba(150,255,150,0.3)' : isActive ? 'rgba(139, 92, 246, 0.4)' : 'rgba(255,255,255,0.1)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {isComplete && <Check size={12} color="rgba(150,255,150,0.9)" />}
        {isActive && <Loader size={12} color="rgba(139, 92, 246, 0.9)" style={{ animation: 'spin 1s linear infinite' }} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#fff' : 'rgba(255,255,255,0.7)', marginBottom: 2 }}>
          {task.title}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
          {task.description}
        </div>
      </div>
    </div>
  );
}

function AgentInsight({ icon: Icon, title, content, type = 'info' }) {
  const colors = {
    info: { bg: 'rgba(139, 92, 246, 0.1)', border: 'rgba(139, 92, 246, 0.3)', icon: 'rgba(139, 92, 246, 0.8)' },
    success: { bg: 'rgba(150,255,150,0.1)', border: 'rgba(150,255,150,0.3)', icon: 'rgba(150,255,150,0.8)' },
    warning: { bg: 'rgba(255,200,100,0.1)', border: 'rgba(255,200,100,0.3)', icon: 'rgba(255,200,100,0.8)' },
  };
  const c = colors[type];
  
  return (
    <div style={{
      padding: 12,
      background: c.bg,
      border: `1px solid ${c.border}`,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon size={12} color={c.icon} />
        <span style={{ fontSize: 9, letterSpacing: '0.1em', color: c.icon, fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{content}</div>
    </div>
  );
}

// ============================================================================
// ROLE DISCOVERY COMPONENTS
// ============================================================================

function RoleField({ label, value, placeholder, onChange, multiline = false, icon: Icon }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
        {Icon && <Icon size={10} />}
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
            fontSize: 12,
            fontFamily: '"Space Mono", monospace',
            resize: 'vertical',
            minHeight: 80,
            outline: 'none',
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
            fontSize: 12,
            fontFamily: '"Space Mono", monospace',
            outline: 'none',
          }}
        />
      )}
    </div>
  );
}

function RoleSection({ title, icon: Icon, children, isComplete }) {
  const [expanded, setExpanded] = useState(true);
  
  return (
    <LiquidMetalCard variant={isComplete ? 'chrome' : 'default'} style={{ marginBottom: 16 }}>
      <div 
        onClick={() => setExpanded(!expanded)}
        style={{ 
          padding: '16px 20px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32,
            height: 32,
            background: isComplete ? 'rgba(150,255,150,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isComplete ? 'rgba(150,255,150,0.3)' : 'rgba(255,255,255,0.1)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {isComplete ? <CheckCircle size={14} color="rgba(150,255,150,0.9)" /> : <Icon size={14} color="rgba(255,255,255,0.4)" />}
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>{title}</span>
        </div>
        {expanded ? <ChevronDown size={16} color="rgba(255,255,255,0.4)" /> : <ChevronRight size={16} color="rgba(255,255,255,0.4)" />}
      </div>
      {expanded && <div style={{ padding: 20 }}>{children}</div>}
    </LiquidMetalCard>
  );
}

// ============================================================================
// QUESTION CARD WITH RUBRIC & PURPOSE
// ============================================================================

function QuestionCard({ question, index, onUpdate, onRemove, onExpand, isExpanded }) {
  const typeColors = {
    technical: { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.3)', text: 'rgba(59, 130, 246, 0.9)' },
    behavioral: { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)', text: 'rgba(245, 158, 11, 0.9)' },
    motivation: { bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.3)', text: 'rgba(139, 92, 246, 0.9)' },
    situational: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)', text: 'rgba(16, 185, 129, 0.9)' },
  };
  
  const tc = typeColors[question.type] || typeColors.technical;
  
  return (
    <LiquidMetalCard variant="dark" style={{ marginBottom: 12 }}>
      {/* Header row */}
      <div style={{ 
        padding: '16px 20px', 
        display: 'flex', 
        alignItems: 'center', 
        gap: 12,
        borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
      }}>
        <div style={{ cursor: 'grab', color: 'rgba(255,255,255,0.3)' }}>
          <GripVertical size={16} />
        </div>
        
        <div style={{
          width: 28,
          height: 28,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.6)',
        }}>
          {index + 1}
        </div>
        
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              padding: '3px 8px',
              background: tc.bg,
              border: `1px solid ${tc.border}`,
              fontSize: 8,
              letterSpacing: '0.1em',
              color: tc.text,
              fontWeight: 600,
            }}>
              {question.type.toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{question.timeLimit} MIN</span>
            {question.required && <span style={{ fontSize: 9, color: 'rgba(255,100,100,0.8)', letterSpacing: '0.05em' }}>REQUIRED</span>}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
            {question.text}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: question.hasVideo ? 'rgba(150,255,150,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${question.hasVideo ? 'rgba(150,255,150,0.2)' : 'rgba(255,255,255,0.1)'}` }}>
            {question.hasVideo ? <Video size={10} color="rgba(150,255,150,0.8)" /> : <VideoOff size={10} color="rgba(255,255,255,0.3)" />}
            <span style={{ fontSize: 8, color: question.hasVideo ? 'rgba(150,255,150,0.8)' : 'rgba(255,255,255,0.3)', letterSpacing: '0.05em' }}>
              {question.hasVideo ? 'VIDEO' : 'NO VIDEO'}
            </span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <BarChart3 size={10} color="rgba(255,255,255,0.4)" />
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em' }}>
              {question.rubric?.length || 0} CRITERIA
            </span>
          </div>
          
          <button onClick={() => onExpand(isExpanded ? null : question.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            {isExpanded ? <ChevronDown size={16} color="rgba(255,255,255,0.4)" /> : <ChevronRight size={16} color="rgba(255,255,255,0.4)" />}
          </button>
        </div>
      </div>
      
      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ padding: 20 }}>
          {/* Purpose */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Lightbulb size={12} color="rgba(139, 92, 246, 0.7)" />
              <span style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(139, 92, 246, 0.7)' }}>PURPOSE</span>
            </div>
            <div style={{ 
              padding: 16, 
              background: 'rgba(139, 92, 246, 0.08)', 
              border: '1px solid rgba(139, 92, 246, 0.15)',
              fontSize: 11,
              color: 'rgba(255,255,255,0.7)',
              lineHeight: 1.6,
            }}>
              {question.purpose}
            </div>
          </div>
          
          {/* Rubric */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ListChecks size={12} color="rgba(255,255,255,0.5)" />
                <span style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.5)' }}>EVALUATION CRITERIA</span>
              </div>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
                Total: {question.rubric?.reduce((sum, r) => sum + r.weight, 0) || 0}%
              </span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {question.rubric?.map((criterion, i) => (
                <div key={i} style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    background: 'rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 800,
                    color: 'rgba(255,255,255,0.6)',
                    flexShrink: 0,
                  }}>
                    {criterion.weight}%
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{criterion.name}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{criterion.description}</div>
                  </div>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                    <X size={12} color="rgba(255,255,255,0.3)" />
                  </button>
                </div>
              ))}
            </div>
            
            <button style={{
              width: '100%',
              marginTop: 8,
              padding: '10px',
              background: 'transparent',
              border: '1px dashed rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              letterSpacing: '0.1em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontFamily: '"Space Mono", monospace',
            }}>
              <Plus size={12} />
              ADD CRITERION
            </button>
          </div>
          
          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => onRemove(question.id)} style={{
              padding: '8px 16px',
              background: 'rgba(255,100,100,0.1)',
              border: '1px solid rgba(255,100,100,0.2)',
              color: 'rgba(255,100,100,0.8)',
              fontSize: 9,
              letterSpacing: '0.1em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: '"Space Mono", monospace',
            }}>
              <Trash2 size={10} />
              REMOVE
            </button>
            <button style={{
              padding: '8px 16px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 9,
              letterSpacing: '0.1em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: '"Space Mono", monospace',
            }}>
              <Edit3 size={10} />
              EDIT QUESTION
            </button>
          </div>
        </div>
      )}
    </LiquidMetalCard>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function PipelineBuilderAI() {
  const [mounted, setMounted] = useState(false);
  const [activeStep, setActiveStep] = useState(0); // 0: role, 1: pipeline, 2: questions, 3: review
  const [expandedQuestion, setExpandedQuestion] = useState(null);
  const [agentWorking, setAgentWorking] = useState(false);
  
  // Deep role discovery state
  const [role, setRole] = useState({
    title: '',
    department: '',
    level: '',
    location: '',
    salaryMin: '',
    salaryMax: '',
    // Deep discovery fields
    missionStatement: '',
    teamContext: '',
    keyResponsibilities: '',
    technicalRequirements: '',
    softSkills: '',
    successMetrics: '',
    growthPath: '',
    challenges: '',
    dayInLife: '',
    reportingStructure: '',
  });
  
  // Questions with rubric and purpose
  const [questions, setQuestions] = useState([
    {
      id: 1,
      type: 'behavioral',
      text: 'Tell me about a time when you made short-term sacrifices for long-term gains.',
      timeLimit: 3,
      required: true,
      hasVideo: false,
      purpose: 'This question evaluates strategic thinking and delayed gratification. Strong candidates demonstrate an ability to prioritize long-term outcomes over immediate wins, showing maturity in decision-making and understanding of sustainable growth.',
      rubric: [
        { name: 'Strategic Thinking', weight: 30, description: 'Demonstrates ability to see the bigger picture and make decisions aligned with long-term goals' },
        { name: 'Self-Awareness', weight: 25, description: 'Shows understanding of personal motivations and the difficulty of the sacrifice made' },
        { name: 'Impact Assessment', weight: 25, description: 'Clearly articulates the measurable outcomes of both the sacrifice and the eventual gain' },
        { name: 'Communication', weight: 20, description: 'Structures the narrative clearly with context, action, and result' },
      ],
    },
    {
      id: 2,
      type: 'technical',
      text: 'Walk me through how you would design a system to handle 10x traffic growth overnight.',
      timeLimit: 5,
      required: true,
      hasVideo: false,
      purpose: 'Assesses architectural thinking and scalability knowledge. We want to understand how candidates approach ambiguous technical challenges and whether they consider trade-offs between different solutions.',
      rubric: [
        { name: 'Scalability Patterns', weight: 35, description: 'Knowledge of horizontal scaling, caching, load balancing, and distributed systems' },
        { name: 'Problem Decomposition', weight: 25, description: 'Breaks down the problem into manageable components and addresses each systematically' },
        { name: 'Trade-off Analysis', weight: 25, description: 'Discusses pros/cons of different approaches and explains reasoning for choices' },
        { name: 'Practical Experience', weight: 15, description: 'References real-world experience or specific technologies used in similar scenarios' },
      ],
    },
    {
      id: 3,
      type: 'motivation',
      text: 'What specifically drew you to this role and our company? What impact do you hope to make?',
      timeLimit: 3,
      required: true,
      hasVideo: true,
      purpose: 'Evaluates cultural fit and genuine interest. Candidates who have done their research and can articulate specific reasons for their interest tend to be more engaged and committed long-term.',
      rubric: [
        { name: 'Company Research', weight: 30, description: 'Shows evidence of researching company mission, products, culture, and recent news' },
        { name: 'Role Alignment', weight: 30, description: 'Connects personal career goals and strengths to specific aspects of the role' },
        { name: 'Impact Vision', weight: 25, description: 'Articulates a clear vision for the contribution they want to make' },
        { name: 'Authenticity', weight: 15, description: 'Response feels genuine rather than generic or rehearsed' },
      ],
    },
  ]);
  
  // Agent tasks
  const [agentTasks, setAgentTasks] = useState([
    { id: 1, title: 'Analyzing Role Requirements', description: 'Processing job description to identify key competencies and evaluation criteria', status: 'complete' },
    { id: 2, title: 'Generating Screening Questions', description: 'Creating role-specific questions aligned with success metrics', status: 'complete' },
    { id: 3, title: 'Building Evaluation Rubrics', description: 'Defining scoring criteria and weightings for each question', status: 'active' },
    { id: 4, title: 'Optimizing Question Flow', description: 'Arranging questions for optimal candidate experience', status: 'pending' },
  ]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleRemoveQuestion = (id) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  const handleGenerateQuestions = () => {
    setAgentWorking(true);
    setTimeout(() => {
      // Simulate adding a new question
      const newQuestion = {
        id: Date.now(),
        type: 'situational',
        text: 'You discover a critical bug in production on Friday at 5pm. Walk me through your decision-making process.',
        timeLimit: 4,
        required: false,
        hasVideo: false,
        purpose: 'Tests crisis management and prioritization skills. We want to see how candidates balance urgency with thoroughness and how they communicate during high-pressure situations.',
        rubric: [
          { name: 'Triage Skills', weight: 30, description: 'Demonstrates ability to quickly assess severity and impact' },
          { name: 'Communication', weight: 25, description: 'Considers stakeholder communication and escalation paths' },
          { name: 'Problem Solving', weight: 25, description: 'Shows systematic approach to debugging and resolution' },
          { name: 'Work-Life Balance', weight: 20, description: 'Addresses the timing aspect thoughtfully without either extreme' },
        ],
      };
      setQuestions([...questions, newQuestion]);
      setAgentWorking(false);
    }, 2000);
  };

  const steps = ['Role Discovery', 'Pipeline Setup', 'Questions', 'Review'];

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0c0c0e', 
      fontFamily: '"Space Mono", monospace', 
      color: '#fff',
      display: 'flex',
    }}>
      <ChromeMeshGrid />

      {/* LEFT PANEL - Agent Panel (Structured, not chatbot) */}
      <div style={{
        width: 400,
        height: '100vh',
        borderRight: '1px solid rgba(139, 92, 246, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 1,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(-20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Agent header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(139, 92, 246, 0.15)',
          background: 'linear-gradient(180deg, rgba(139, 92, 246, 0.08) 0%, transparent 100%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.2))',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Brain size={18} color="rgba(139, 92, 246, 0.9)" />
            </div>
            <div>
              <h1 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>PIPELINE AGENT</h1>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(139, 92, 246, 0.7)' }}>
                {agentWorking ? 'WORKING...' : 'READY'}
              </div>
            </div>
          </div>
        </div>

        {/* Agent content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Progress */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              {steps.map((step, i) => (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: 20,
                    height: 20,
                    background: i < activeStep ? 'rgba(150,255,150,0.2)' : i === activeStep ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${i < activeStep ? 'rgba(150,255,150,0.4)' : i === activeStep ? 'rgba(139, 92, 246, 0.5)' : 'rgba(255,255,255,0.1)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    fontWeight: 700,
                  }}>
                    {i < activeStep ? <Check size={10} color="rgba(150,255,150,0.9)" /> : i + 1}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ height: 2, background: 'rgba(255,255,255,0.1)' }}>
              <div style={{ width: `${(activeStep / 3) * 100}%`, height: '100%', background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.6), rgba(139, 92, 246, 0.9))', transition: 'width 0.3s' }} />
            </div>
          </div>
          
          {/* Current step info */}
          <SubTitle>CURRENT STEP</SubTitle>
          <LiquidMetalCard variant="ai" style={{ padding: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 6 }}>{steps[activeStep]}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
              {activeStep === 0 && 'Define your role in detail so I can create highly targeted interview questions.'}
              {activeStep === 1 && 'Configure your interview pipeline stages and flow.'}
              {activeStep === 2 && 'Review and customize screening questions with evaluation rubrics.'}
              {activeStep === 3 && 'Final review before publishing your pipeline.'}
            </div>
          </LiquidMetalCard>
          
          {/* Agent tasks */}
          <SubTitle>AGENT TASKS</SubTitle>
          <LiquidMetalCard variant="dark" style={{ padding: 16, marginBottom: 24 }}>
            {agentTasks.map(task => (
              <AgentTaskItem 
                key={task.id} 
                task={task} 
                isActive={task.status === 'active'}
                isComplete={task.status === 'complete'}
                isPending={task.status === 'pending'}
              />
            ))}
          </LiquidMetalCard>
          
          {/* Insights */}
          <SubTitle>INSIGHTS</SubTitle>
          <AgentInsight 
            icon={Lightbulb}
            title="RECOMMENDATION"
            content="Based on the role requirements, I recommend including at least 2 technical questions and 1 behavioral question in screening."
            type="info"
          />
          <AgentInsight 
            icon={AlertCircle}
            title="ATTENTION"
            content="Your rubric weights don't sum to 100% for Question 2. This may affect scoring consistency."
            type="warning"
          />
          <AgentInsight 
            icon={CheckCheck}
            title="OPTIMIZATION"
            content="Question flow optimized for candidate engagement. Shorter questions placed first."
            type="success"
          />
        </div>
        
        {/* Agent actions */}
        <div style={{ padding: 20, borderTop: '1px solid rgba(139, 92, 246, 0.15)' }}>
          <button 
            onClick={handleGenerateQuestions}
            disabled={agentWorking}
            style={{
              width: '100%',
              padding: '14px 20px',
              background: agentWorking ? 'rgba(139, 92, 246, 0.2)' : 'linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(99, 102, 241, 0.3))',
              border: '1px solid rgba(139, 92, 246, 0.5)',
              color: '#fff',
              fontSize: 11,
              letterSpacing: '0.1em',
              fontWeight: 700,
              cursor: agentWorking ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {agentWorking ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={14} />}
            {agentWorking ? 'GENERATING...' : 'GENERATE MORE QUESTIONS'}
          </button>
        </div>
      </div>

      {/* RIGHT PANEL - Main Content */}
      <div style={{
        flex: 1,
        height: '100vh',
        overflowY: 'auto',
        position: 'relative',
        zIndex: 1,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s',
      }}>
        {/* Header */}
        <div style={{ 
          padding: '20px 32px', 
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)',
        }}>
          <div>
            <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>PIPELINE BUILDER</div>
            <h1 style={{
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: 0,
              background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 50%, #fff 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              SCREENING QUESTIONS
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{
              padding: '10px 16px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 9,
              letterSpacing: '0.1em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: '"Space Mono", monospace',
            }}>
              <Eye size={12} />
              PREVIEW
            </button>
            <button style={{
              padding: '10px 20px',
              background: 'linear-gradient(135deg, rgba(150,255,150,0.2), rgba(100,200,100,0.15))',
              border: '1px solid rgba(150,255,150,0.3)',
              color: '#fff',
              fontSize: 9,
              letterSpacing: '0.1em',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: '"Space Mono", monospace',
            }}>
              <Save size={12} />
              SAVE & CONTINUE
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: 32 }}>
          {/* Stats bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
            <LiquidMetalCard variant="default" style={{ padding: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>QUESTIONS</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{questions.length}</div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>VIDEOS</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{questions.filter(q => q.hasVideo).length}/{questions.length}</div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>EST. TIME</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{questions.reduce((sum, q) => sum + q.timeLimit, 0)} MIN</div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>REQUIRED</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{questions.filter(q => q.required).length}</div>
            </LiquidMetalCard>
          </div>
          
          {/* Questions list */}
          <SubTitle>SCREENING QUESTIONS</SubTitle>
          
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              index={index}
              onRemove={handleRemoveQuestion}
              onExpand={setExpandedQuestion}
              isExpanded={expandedQuestion === question.id}
            />
          ))}
          
          {/* Add question button */}
          <button style={{
            width: '100%',
            padding: '20px',
            background: 'transparent',
            border: '1px dashed rgba(139, 92, 246, 0.3)',
            color: 'rgba(139, 92, 246, 0.7)',
            fontSize: 11,
            letterSpacing: '0.1em',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: '"Space Mono", monospace',
            marginTop: 8,
          }}>
            <Plus size={16} />
            ADD CUSTOM QUESTION
          </button>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0c0c0e; }
        body { overflow-x: hidden; }
        
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(139, 92, 246, 0.3); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.5); }
        
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.3); }
      `}</style>
    </div>
  );
}
