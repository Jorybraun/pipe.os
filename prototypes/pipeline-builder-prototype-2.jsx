import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  Plus,
  Check,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Phone,
  Zap,
  Code,
  FileText,
  Mic,
  Users,
  Video,
  BarChart3,
  Clock,
  Building,
  Briefcase,
  MapPin,
  DollarSign,
  Target,
  User,
  Bot,
  Loader,
  ArrowRight,
  Edit3,
  Eye,
  Save,
  X,
  MessageSquare,
  Settings,
  Wand2,
  RefreshCw,
  AlertCircle,
  Play,
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
    ai: {
      background: `linear-gradient(135deg,
        rgba(139, 92, 246, 0.15) 0%,
        rgba(99, 102, 241, 0.1) 50%,
        rgba(139, 92, 246, 0.12) 100%
      )`,
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
        boxShadow: isHovered 
          ? '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)'
          : 'inset 0 1px 0 rgba(255,255,255,0.1)',
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

// ============================================================================
// AI CHAT COMPONENTS
// ============================================================================

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 0' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            width: 6,
            height: 6,
            background: 'rgba(139, 92, 246, 0.6)',
            animation: `typingBounce 1.4s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function ChatMessage({ message, isAI, isTyping }) {
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      marginBottom: 16,
      flexDirection: isAI ? 'row' : 'row-reverse',
    }}>
      {/* Avatar */}
      <div style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        background: isAI 
          ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.2))'
          : 'rgba(255,255,255,0.1)',
        border: `1px solid ${isAI ? 'rgba(139, 92, 246, 0.4)' : 'rgba(255,255,255,0.15)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {isAI ? <Sparkles size={14} color="rgba(139, 92, 246, 0.9)" /> : <User size={14} color="rgba(255,255,255,0.5)" />}
      </div>

      {/* Message bubble */}
      <LiquidMetalCard 
        variant={isAI ? 'ai' : 'dark'} 
        style={{ 
          padding: '12px 16px', 
          maxWidth: '85%',
          flex: 1,
        }}
      >
        {isTyping ? (
          <TypingIndicator />
        ) : (
          <>
            <div style={{ fontSize: 8, letterSpacing: '0.15em', color: isAI ? 'rgba(139, 92, 246, 0.7)' : 'rgba(255,255,255,0.3)', marginBottom: 6 }}>
              {isAI ? 'PIPE_AI' : 'YOU'}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
              {message}
            </div>
          </>
        )}
      </LiquidMetalCard>
    </div>
  );
}

function SuggestionChip({ text, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        background: 'rgba(139, 92, 246, 0.1)',
        border: '1px solid rgba(139, 92, 246, 0.25)',
        color: 'rgba(139, 92, 246, 0.9)',
        fontSize: 10,
        letterSpacing: '0.05em',
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
      onMouseEnter={e => {
        e.target.style.background = 'rgba(139, 92, 246, 0.2)';
        e.target.style.borderColor = 'rgba(139, 92, 246, 0.4)';
      }}
      onMouseLeave={e => {
        e.target.style.background = 'rgba(139, 92, 246, 0.1)';
        e.target.style.borderColor = 'rgba(139, 92, 246, 0.25)';
      }}
    >
      {text}
    </button>
  );
}

// ============================================================================
// PIPELINE PREVIEW COMPONENTS
// ============================================================================

const stageIcons = {
  screening: Phone,
  ai_collab: Zap,
  code_review: Code,
  planning: FileText,
  voice: Mic,
  panel: Users,
};

const stageLabels = {
  screening: 'SCREENING',
  ai_collab: 'AI COLLAB',
  code_review: 'CODE REVIEW',
  planning: 'PLANNING',
  voice: 'VOICE',
  panel: 'PANEL',
};

function StageCard({ stage, isActive, isComplete, onClick }) {
  const Icon = stageIcons[stage.type] || Target;
  
  return (
    <LiquidMetalCard 
      variant={isActive ? 'chrome' : isComplete ? 'mercury' : 'default'}
      hover
      onClick={onClick}
      style={{ marginBottom: 8 }}
    >
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36,
              height: 36,
              background: isComplete 
                ? 'rgba(150,255,150,0.15)'
                : isActive 
                  ? 'rgba(139, 92, 246, 0.2)'
                  : 'rgba(255,255,255,0.05)',
              border: `1px solid ${isComplete ? 'rgba(150,255,150,0.3)' : isActive ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.1)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {isComplete ? (
                <CheckCircle size={16} color="rgba(150,255,150,0.9)" />
              ) : (
                <Icon size={16} color={isActive ? 'rgba(139, 92, 246, 0.9)' : 'rgba(255,255,255,0.4)'} />
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                {stageLabels[stage.type]}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>
                {stage.questions?.length || 0} QUESTIONS
              </div>
            </div>
          </div>
          
          {isActive && (
            <div style={{
              padding: '4px 8px',
              background: 'rgba(139, 92, 246, 0.2)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
            }}>
              <span style={{ fontSize: 7, letterSpacing: '0.15em', color: 'rgba(139, 92, 246, 0.9)' }}>BUILDING</span>
            </div>
          )}
          
          <ChevronRight size={16} color="rgba(255,255,255,0.3)" />
        </div>

        {/* Questions preview */}
        {stage.questions && stage.questions.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {stage.questions.slice(0, 2).map((q, i) => (
              <div key={i} style={{ 
                fontSize: 10, 
                color: 'rgba(255,255,255,0.5)', 
                marginBottom: 6,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>{i + 1}.</span>
                <span style={{ lineHeight: 1.4 }}>{q.text.substring(0, 60)}...</span>
              </div>
            ))}
            {stage.questions.length > 2 && (
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
                +{stage.questions.length - 2} MORE
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Progress bar */}
      {isActive && (
        <div style={{ height: 2, background: 'rgba(139, 92, 246, 0.3)' }}>
          <div style={{
            width: '60%',
            height: '100%',
            background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.6), rgba(139, 92, 246, 0.9))',
            animation: 'progressPulse 2s ease-in-out infinite',
          }} />
        </div>
      )}
    </LiquidMetalCard>
  );
}

function RolePreviewCard({ role }) {
  return (
    <LiquidMetalCard variant="chrome" style={{ padding: 24, marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>ROLE</div>
          <h2 style={{
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            margin: 0,
            background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {role.title || 'UNTITLED ROLE'}
          </h2>
        </div>
        {role.title && (
          <button style={{
            padding: '6px 12px',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.6)',
            fontSize: 9,
            letterSpacing: '0.1em',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <Edit3 size={10} />
            EDIT
          </button>
        )}
      </div>

      {/* Role meta */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {role.department && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building size={12} color="rgba(255,255,255,0.3)" />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{role.department}</span>
          </div>
        )}
        {role.level && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Briefcase size={12} color="rgba(255,255,255,0.3)" />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{role.level}</span>
          </div>
        )}
        {role.location && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={12} color="rgba(255,255,255,0.3)" />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{role.location}</span>
          </div>
        )}
        {role.salary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={12} color="rgba(255,255,255,0.3)" />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{role.salary}</span>
          </div>
        )}
      </div>

      {/* Requirements */}
      {role.requirements && role.requirements.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>KEY REQUIREMENTS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {role.requirements.map((req, i) => (
              <span key={i} style={{
                padding: '4px 10px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: 9,
                color: 'rgba(255,255,255,0.6)',
              }}>
                {req}
              </span>
            ))}
          </div>
        </div>
      )}
    </LiquidMetalCard>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function PipelineBuilder() {
  const [mounted, setMounted] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef(null);
  
  // Conversation state
  const [messages, setMessages] = useState([
    {
      id: 1,
      isAI: true,
      text: "Welcome to Pipeline Builder. I'll help you create a complete interview pipeline. Let's start with the basics — what role are you hiring for?",
    }
  ]);

  // Pipeline state
  const [role, setRole] = useState({
    title: '',
    department: '',
    level: '',
    location: '',
    salary: '',
    requirements: [],
  });

  const [stages, setStages] = useState([]);
  const [activeStage, setActiveStage] = useState(null);
  const [buildPhase, setBuildPhase] = useState('role'); // role, stages, questions, complete

  // Suggestions based on phase
  const suggestions = {
    role: [
      'Senior Software Engineer',
      'Product Manager',
      'Data Scientist',
      'Design Lead',
    ],
    stages: [
      'Add screening stage',
      'Include code review',
      'Add technical interview',
      'Use standard pipeline',
    ],
    questions: [
      'Generate 5 technical questions',
      'Add behavioral questions',
      'Include system design',
      'More coding challenges',
    ],
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Simulated AI response
  const processUserMessage = (userMessage) => {
    const lowerMsg = userMessage.toLowerCase();
    
    // Phase: Role definition
    if (buildPhase === 'role') {
      if (lowerMsg.includes('engineer') || lowerMsg.includes('developer')) {
        setRole(prev => ({
          ...prev,
          title: 'SR. SOFTWARE ENGINEER',
          department: 'Engineering',
          level: 'Senior (L5+)',
        }));
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Great choice! I've set up a Senior Software Engineer role. What location and compensation range are you targeting? You can also tell me the key requirements you're looking for.",
          }]);
          setIsTyping(false);
        }, 1500);
      } else if (lowerMsg.includes('remote') || lowerMsg.includes('hybrid') || lowerMsg.includes('onsite')) {
        const location = lowerMsg.includes('remote') ? 'Remote' : lowerMsg.includes('hybrid') ? 'Hybrid' : 'On-site';
        setRole(prev => ({ ...prev, location }));
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: `Perfect, ${location} it is. What are the must-have skills or requirements for this role?`,
          }]);
          setIsTyping(false);
        }, 1200);
      } else if (lowerMsg.includes('python') || lowerMsg.includes('react') || lowerMsg.includes('distributed') || lowerMsg.includes('aws')) {
        const skills = [];
        if (lowerMsg.includes('python')) skills.push('Python');
        if (lowerMsg.includes('react')) skills.push('React');
        if (lowerMsg.includes('distributed')) skills.push('Distributed Systems');
        if (lowerMsg.includes('aws')) skills.push('AWS');
        if (lowerMsg.includes('5+ years') || lowerMsg.includes('5 years')) skills.push('5+ years experience');
        
        setRole(prev => ({ ...prev, requirements: [...prev.requirements, ...skills] }));
        setBuildPhase('stages');
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Excellent! I've captured those requirements. Now let's build your interview pipeline. I recommend starting with a video screening, followed by a technical assessment. What stages would you like to include?",
          }]);
          setIsTyping(false);
        }, 1500);
      } else if (lowerMsg.includes('product') || lowerMsg.includes('pm')) {
        setRole(prev => ({
          ...prev,
          title: 'PRODUCT MANAGER',
          department: 'Product',
          level: 'Senior',
        }));
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Product Manager role created! What's the focus area — growth, platform, or core product? And any specific experience requirements?",
          }]);
          setIsTyping(false);
        }, 1500);
      } else {
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "I didn't quite catch that. Could you tell me the role title you're hiring for? For example: 'Senior Software Engineer' or 'Product Manager'",
          }]);
          setIsTyping(false);
        }, 1000);
      }
    }
    
    // Phase: Stage configuration
    else if (buildPhase === 'stages') {
      if (lowerMsg.includes('screening') || lowerMsg.includes('video')) {
        const newStage = { type: 'screening', questions: [] };
        setStages(prev => [...prev, newStage]);
        setActiveStage('screening');
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Added Screening stage! I can generate questions for you or you can add them manually. Would you like me to create 3-5 screening questions tailored to your role requirements?",
          }]);
          setIsTyping(false);
          setBuildPhase('questions');
        }, 1200);
      } else if (lowerMsg.includes('code') || lowerMsg.includes('technical')) {
        const newStage = { type: 'code_review', questions: [] };
        setStages(prev => [...prev, newStage]);
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Code Review stage added! This will include a take-home coding challenge. Want me to add a Screening stage first, or move straight to configuring the technical assessment?",
          }]);
          setIsTyping(false);
        }, 1200);
      } else if (lowerMsg.includes('standard') || lowerMsg.includes('recommended')) {
        setStages([
          { type: 'screening', questions: [] },
          { type: 'code_review', questions: [] },
          { type: 'voice', questions: [] },
        ]);
        setActiveStage('screening');
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "I've set up a standard 3-stage pipeline: Screening → Code Review → Voice Interview. Let me generate questions for the Screening stage first. Ready?",
          }]);
          setIsTyping(false);
          setBuildPhase('questions');
        }, 1500);
      } else {
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "I can add Screening, Code Review, AI Collaboration, Planning, Voice Interview, or Panel stages. Which would you like to start with? Or say 'standard pipeline' for my recommended setup.",
          }]);
          setIsTyping(false);
        }, 1000);
      }
    }
    
    // Phase: Question generation
    else if (buildPhase === 'questions') {
      if (lowerMsg.includes('generate') || lowerMsg.includes('yes') || lowerMsg.includes('create')) {
        setTimeout(() => {
          // Simulate question generation
          const generatedQuestions = [
            { text: "Tell me about your experience with distributed systems and how you've applied that knowledge in previous roles.", type: 'technical', timeLimit: 3 },
            { text: "Why are you interested in this role and what excites you about our company?", type: 'motivation', timeLimit: 2 },
            { text: "Describe a challenging technical problem you solved recently. Walk me through your approach.", type: 'behavioral', timeLimit: 3 },
          ];
          
          setStages(prev => prev.map(s => 
            s.type === activeStage ? { ...s, questions: generatedQuestions } : s
          ));
          
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Done! I've generated 3 screening questions covering technical background, motivation, and problem-solving. You can preview them in the pipeline view. Want me to add more questions, or shall we move to the next stage?",
          }]);
          setIsTyping(false);
        }, 2000);
      } else if (lowerMsg.includes('next') || lowerMsg.includes('move on')) {
        const currentIndex = stages.findIndex(s => s.type === activeStage);
        if (currentIndex < stages.length - 1) {
          setActiveStage(stages[currentIndex + 1].type);
          setTimeout(() => {
            setMessages(prev => [...prev, {
              id: Date.now(),
              isAI: true,
              text: `Moving to ${stageLabels[stages[currentIndex + 1].type]}. Want me to generate questions for this stage?`,
            }]);
            setIsTyping(false);
          }, 1000);
        } else {
          setBuildPhase('complete');
          setActiveStage(null);
          setTimeout(() => {
            setMessages(prev => [...prev, {
              id: Date.now(),
              isAI: true,
              text: "Your pipeline is complete! You can preview the candidate experience, make edits, or publish when ready. Is there anything else you'd like to adjust?",
            }]);
            setIsTyping(false);
          }, 1000);
        }
      } else if (lowerMsg.includes('more') || lowerMsg.includes('add')) {
        setTimeout(() => {
          const newQuestion = { 
            text: "How do you approach code reviews? What do you look for and how do you provide feedback?", 
            type: 'technical', 
            timeLimit: 2 
          };
          
          setStages(prev => prev.map(s => 
            s.type === activeStage ? { ...s, questions: [...s.questions, newQuestion] } : s
          ));
          
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Added another technical question about code review practices. The screening stage now has 4 questions. Want to continue adding or move to the next stage?",
          }]);
          setIsTyping(false);
        }, 1500);
      } else {
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: Date.now(),
            isAI: true,
            text: "Would you like me to 'generate' more questions, 'add' a specific question, or 'move on' to the next stage?",
          }]);
          setIsTyping(false);
        }, 1000);
      }
    }
    
    // Phase: Complete
    else if (buildPhase === 'complete') {
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: Date.now(),
          isAI: true,
          text: "Your pipeline is ready! You can click 'Preview' to see the candidate experience or 'Publish' to start accepting applications. Need any final adjustments?",
        }]);
        setIsTyping(false);
      }, 1000);
    }
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    
    // Add user message
    setMessages(prev => [...prev, {
      id: Date.now(),
      isAI: false,
      text: inputValue,
    }]);
    
    setIsTyping(true);
    const userMsg = inputValue;
    setInputValue('');
    
    // Process and respond
    processUserMessage(userMsg);
  };

  const handleSuggestion = (suggestion) => {
    setInputValue(suggestion);
  };

  const totalQuestions = stages.reduce((sum, s) => sum + (s.questions?.length || 0), 0);

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0c0c0e', 
      fontFamily: '"Space Mono", monospace', 
      color: '#fff',
      display: 'flex',
    }}>
      <ChromeMeshGrid />

      {/* LEFT PANEL - AI Chat */}
      <div style={{
        width: '50%',
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
        {/* Chat header */}
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
              <Sparkles size={18} color="rgba(139, 92, 246, 0.9)" />
            </div>
            <div>
              <h1 style={{ 
                fontSize: 16, 
                fontWeight: 800, 
                margin: 0, 
                color: '#fff',
                letterSpacing: '-0.02em',
              }}>
                PIPE_AI
              </h1>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(139, 92, 246, 0.7)' }}>
                PIPELINE BUILDER AGENT
              </div>
            </div>
          </div>
        </div>

        {/* Chat messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 24,
        }}>
          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg.text} isAI={msg.isAI} />
          ))}
          {isTyping && <ChatMessage isAI isTyping />}
          <div ref={chatEndRef} />
        </div>

        {/* Suggestions */}
        <div style={{
          padding: '12px 24px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          {(suggestions[buildPhase] || suggestions.questions).map((s, i) => (
            <SuggestionChip key={i} text={s} onClick={() => handleSuggestion(s)} />
          ))}
        </div>

        {/* Input area */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid rgba(139, 92, 246, 0.15)',
          background: 'linear-gradient(0deg, rgba(139, 92, 246, 0.05) 0%, transparent 100%)',
        }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Type your message..."
              style={{
                flex: 1,
                padding: '14px 18px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
                fontFamily: '"Space Mono", monospace',
              }}
            />
            <button
              onClick={handleSend}
              style={{
                width: 48,
                height: 48,
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(99, 102, 241, 0.3))',
                border: '1px solid rgba(139, 92, 246, 0.5)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL - Pipeline Preview */}
      <div style={{
        width: '50%',
        height: '100vh',
        overflowY: 'auto',
        padding: 32,
        position: 'relative',
        zIndex: 1,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <SubTitle>PIPELINE BUILDER</SubTitle>
            <h1 style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '8px 0 0',
              background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              LIVE_PREVIEW
            </h1>
          </div>
          
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{
              padding: '10px 16px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 9,
              letterSpacing: '0.15em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <Eye size={12} />
              PREVIEW
            </button>
            <button style={{
              padding: '10px 20px',
              background: buildPhase === 'complete' 
                ? 'linear-gradient(135deg, rgba(150,255,150,0.2), rgba(100,200,100,0.15))'
                : 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
              border: `1px solid ${buildPhase === 'complete' ? 'rgba(150,255,150,0.3)' : 'rgba(255,255,255,0.2)'}`,
              color: '#fff',
              fontSize: 9,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {buildPhase === 'complete' ? <Play size={12} /> : <Save size={12} />}
              {buildPhase === 'complete' ? 'PUBLISH' : 'SAVE DRAFT'}
            </button>
          </div>
        </div>

        {/* Role card */}
        <RolePreviewCard role={role} />

        {/* Stats */}
        {stages.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
            <LiquidMetalCard variant="default" style={{ padding: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>STAGES</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{stages.length}</div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>QUESTIONS</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{totalQuestions}</div>
            </LiquidMetalCard>
            <LiquidMetalCard variant="default" style={{ padding: 16 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>EST. TIME</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{totalQuestions * 3} MIN</div>
            </LiquidMetalCard>
          </div>
        )}

        {/* Stages list */}
        <SubTitle>PIPELINE STAGES</SubTitle>
        <div style={{ marginTop: 16 }}>
          {stages.length === 0 ? (
            <LiquidMetalCard variant="dark" style={{ padding: 32, textAlign: 'center' }}>
              <Target size={32} color="rgba(255,255,255,0.2)" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>
                NO STAGES YET
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                Tell PIPE_AI which stages to add
              </div>
            </LiquidMetalCard>
          ) : (
            stages.map((stage, i) => (
              <StageCard
                key={stage.type}
                stage={stage}
                isActive={stage.type === activeStage}
                isComplete={stage.questions && stage.questions.length > 0 && stage.type !== activeStage}
              />
            ))
          )}
          
          {/* Add stage hint */}
          {stages.length > 0 && stages.length < 4 && (
            <div style={{
              padding: 16,
              border: '1px dashed rgba(139, 92, 246, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 8,
            }}>
              <Plus size={14} color="rgba(139, 92, 246, 0.5)" />
              <span style={{ fontSize: 10, color: 'rgba(139, 92, 246, 0.6)', letterSpacing: '0.1em' }}>
                ASK AI TO ADD MORE STAGES
              </span>
            </div>
          )}
        </div>

        {/* Build progress */}
        <LiquidMetalCard variant="ai" style={{ padding: 20, marginTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(139, 92, 246, 0.7)' }}>BUILD PROGRESS</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(139, 92, 246, 0.9)' }}>
              {buildPhase === 'role' && '25%'}
              {buildPhase === 'stages' && '50%'}
              {buildPhase === 'questions' && '75%'}
              {buildPhase === 'complete' && '100%'}
            </div>
          </div>
          <div style={{ height: 4, background: 'rgba(139, 92, 246, 0.2)' }}>
            <div style={{
              width: buildPhase === 'role' ? '25%' : buildPhase === 'stages' ? '50%' : buildPhase === 'questions' ? '75%' : '100%',
              height: '100%',
              background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.6), rgba(139, 92, 246, 0.9))',
              transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            {['Role', 'Stages', 'Questions', 'Complete'].map((phase, i) => {
              const phaseKeys = ['role', 'stages', 'questions', 'complete'];
              const currentIndex = phaseKeys.indexOf(buildPhase);
              const isComplete = i < currentIndex;
              const isCurrent = i === currentIndex;
              
              return (
                <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 16,
                    height: 16,
                    background: isComplete ? 'rgba(150,255,150,0.2)' : isCurrent ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isComplete ? 'rgba(150,255,150,0.4)' : isCurrent ? 'rgba(139, 92, 246, 0.5)' : 'rgba(255,255,255,0.1)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {isComplete && <Check size={10} color="rgba(150,255,150,0.9)" />}
                    {isCurrent && <div style={{ width: 6, height: 6, background: 'rgba(139, 92, 246, 0.9)' }} />}
                  </div>
                  <span style={{ fontSize: 8, letterSpacing: '0.1em', color: isComplete ? 'rgba(150,255,150,0.7)' : isCurrent ? 'rgba(139, 92, 246, 0.8)' : 'rgba(255,255,255,0.3)' }}>
                    {phase.toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        </LiquidMetalCard>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        
        @keyframes pulse { 
          0%, 100% { opacity: 1; transform: scale(1); } 
          50% { opacity: 0.6; transform: scale(0.95); } 
        }
        
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
        
        @keyframes progressPulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
        
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(139, 92, 246, 0.3); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.5); }
        
        input::placeholder {
          color: rgba(255,255,255,0.3);
        }
      `}</style>
    </div>
  );
}