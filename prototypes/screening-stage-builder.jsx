import React, { useState, useEffect, useRef } from 'react';
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
  ChevronDown,
  Play,
  Pause,
  Square,
  Video,
  VideoOff,
  Mic,
  MicOff,
  RotateCcw,
  Trash2,
  GripVertical,
  Wand2,
  Save,
  Eye,
  Send,
  X,
  Volume2,
  RefreshCw,
  Edit3,
  Copy,
  Check,
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
// MOCK DATA
// ============================================================================

const initialQuestions = [
  { 
    id: 1, 
    text: 'Tell me about your experience with distributed systems and how you\'ve applied that knowledge in previous roles.', 
    type: 'technical', 
    timeLimit: 3,
    required: true,
    hasRecording: true,
    recordingDuration: 45,
  },
  { 
    id: 2, 
    text: 'Why are you interested in this role and what excites you about our company?', 
    type: 'motivation', 
    timeLimit: 2,
    required: true,
    hasRecording: false,
    recordingDuration: null,
  },
  { 
    id: 3, 
    text: 'Describe a challenging technical problem you solved recently. Walk me through your approach.', 
    type: 'behavioral', 
    timeLimit: 3,
    required: true,
    hasRecording: true,
    recordingDuration: 62,
  },
];

const aiSuggestions = [
  'How do you approach debugging complex production issues?',
  'Tell me about a time you had to learn a new technology quickly.',
  'How do you prioritize tasks when working on multiple projects?',
  'Describe your ideal team collaboration environment.',
  'What\'s your approach to code reviews?',
];

// ============================================================================
// VIDEO RECORDER COMPONENT
// ============================================================================

function VideoRecorder({ question, onSave, onClose }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording, isPaused]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = () => {
    setIsRecording(true);
    setHasRecording(false);
    setRecordingTime(0);
  };

  const stopRecording = () => {
    setIsRecording(false);
    setIsPaused(false);
    setHasRecording(true);
  };

  const resetRecording = () => {
    setIsRecording(false);
    setIsPaused(false);
    setHasRecording(false);
    setRecordingTime(0);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.9)',
      backdropFilter: 'blur(20px)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 900, padding: 32 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <SubTitle>RECORD_QUESTION</SubTitle>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 8 }}>
            <X size={20} />
          </button>
        </div>

        {/* Question Display */}
        <LiquidMetalCard variant="mercury" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
            QUESTION {question.id} · {question.type.toUpperCase()} · {question.timeLimit} MIN RESPONSE TIME
          </div>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: '#fff', margin: 0 }}>
            {question.text}
          </p>
        </LiquidMetalCard>

        {/* Video Preview */}
        <LiquidMetalCard variant="dark" style={{ marginBottom: 24, overflow: 'hidden' }}>
          <div style={{
            aspectRatio: '16/9',
            background: cameraOn 
              ? 'linear-gradient(135deg, rgba(60,60,80,0.8), rgba(40,40,60,0.9))'
              : 'rgba(20,20,30,0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            {cameraOn ? (
              <>
                {/* Simulated video feed */}
                <div style={{
                  width: 120,
                  height: 120,
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(200,200,220,0.05))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid rgba(255,255,255,0.2)',
                }}>
                  <User size={48} color="rgba(255,255,255,0.3)" />
                </div>
                
                {/* Recording indicator */}
                {isRecording && (
                  <div style={{
                    position: 'absolute',
                    top: 20,
                    left: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <div style={{
                      width: 12,
                      height: 12,
                      background: isPaused ? 'rgba(255,200,100,0.8)' : 'rgba(255,80,80,0.9)',
                      boxShadow: isPaused ? '0 0 12px rgba(255,200,100,0.6)' : '0 0 12px rgba(255,80,80,0.6)',
                      animation: isPaused ? 'none' : 'pulse 1s ease-in-out infinite',
                    }} />
                    <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#fff', fontWeight: 700 }}>
                      {isPaused ? 'PAUSED' : 'REC'}
                    </span>
                  </div>
                )}

                {/* Timer */}
                <div style={{
                  position: 'absolute',
                  top: 20,
                  right: 20,
                  padding: '8px 16px',
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(10px)',
                }}>
                  <span style={{
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}>
                    {formatTime(recordingTime)}
                  </span>
                </div>

                {/* Playback overlay */}
                {hasRecording && !isRecording && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <button 
                      onClick={() => setIsPlaying(!isPlaying)}
                      style={{
                        width: 80,
                        height: 80,
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(200,200,220,0.1))',
                        border: '2px solid rgba(255,255,255,0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      {isPlaying ? <Pause size={32} color="#fff" /> : <Play size={32} color="#fff" style={{ marginLeft: 4 }} />}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <VideoOff size={48} color="rgba(255,255,255,0.2)" />
                <div style={{ fontSize: 10, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginTop: 12 }}>
                  CAMERA OFF
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ padding: 20, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Left controls */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  onClick={() => setCameraOn(!cameraOn)}
                  style={{
                    width: 44,
                    height: 44,
                    background: cameraOn ? 'rgba(255,255,255,0.1)' : 'rgba(255,80,80,0.2)',
                    border: `1px solid ${cameraOn ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.3)'}`,
                    color: cameraOn ? '#fff' : 'rgba(255,80,80,0.9)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
                <button 
                  onClick={() => setMicOn(!micOn)}
                  style={{
                    width: 44,
                    height: 44,
                    background: micOn ? 'rgba(255,255,255,0.1)' : 'rgba(255,80,80,0.2)',
                    border: `1px solid ${micOn ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.3)'}`,
                    color: micOn ? '#fff' : 'rgba(255,80,80,0.9)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {micOn ? <Mic size={18} /> : <MicOff size={18} />}
                </button>
              </div>

              {/* Center controls */}
              <div style={{ display: 'flex', gap: 12 }}>
                {!isRecording && !hasRecording && (
                  <button 
                    onClick={startRecording}
                    style={{
                      padding: '12px 32px',
                      background: 'linear-gradient(135deg, rgba(255,80,80,0.6), rgba(255,100,100,0.4))',
                      border: '1px solid rgba(255,80,80,0.5)',
                      color: '#fff',
                      fontSize: 11,
                      letterSpacing: '0.15em',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <div style={{ width: 10, height: 10, background: '#fff', borderRadius: '50%' }} />
                    START RECORDING
                  </button>
                )}

                {isRecording && (
                  <>
                    <button 
                      onClick={() => setIsPaused(!isPaused)}
                      style={{
                        width: 44,
                        height: 44,
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isPaused ? <Play size={18} /> : <Pause size={18} />}
                    </button>
                    <button 
                      onClick={stopRecording}
                      style={{
                        padding: '12px 32px',
                        background: 'linear-gradient(135deg, rgba(255,80,80,0.6), rgba(255,100,100,0.4))',
                        border: '1px solid rgba(255,80,80,0.5)',
                        color: '#fff',
                        fontSize: 11,
                        letterSpacing: '0.15em',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <Square size={12} fill="#fff" />
                      STOP
                    </button>
                  </>
                )}

                {hasRecording && !isRecording && (
                  <>
                    <button 
                      onClick={resetRecording}
                      style={{
                        padding: '12px 24px',
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: 10,
                        letterSpacing: '0.15em',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <RotateCcw size={14} />
                      RE-RECORD
                    </button>
                    <button 
                      onClick={() => onSave(recordingTime)}
                      style={{
                        padding: '12px 32px',
                        background: 'linear-gradient(135deg, rgba(150,255,150,0.3), rgba(100,200,100,0.2))',
                        border: '1px solid rgba(150,255,150,0.4)',
                        color: '#fff',
                        fontSize: 11,
                        letterSpacing: '0.15em',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <Check size={16} />
                      SAVE RECORDING
                    </button>
                  </>
                )}
              </div>

              {/* Right placeholder */}
              <div style={{ width: 100 }} />
            </div>
          </div>
        </LiquidMetalCard>

        {/* Tips */}
        <div style={{ display: 'flex', gap: 24 }}>
          <LiquidMetalCard variant="default" style={{ flex: 1, padding: 20 }}>
            <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>TIPS</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8 }}>
              <li>Speak clearly and at a moderate pace</li>
              <li>Look directly at the camera</li>
              <li>Keep recordings under 90 seconds</li>
            </ul>
          </LiquidMetalCard>
          <LiquidMetalCard variant="default" style={{ flex: 1, padding: 20 }}>
            <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>CANDIDATE VIEW</div>
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8 }}>
              Candidates will see your video before recording their response. They'll have {question.timeLimit} minutes to answer.
            </p>
          </LiquidMetalCard>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AI QUESTION GENERATOR
// ============================================================================

function AIQuestionGenerator({ onAdd, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState(aiSuggestions);
  const [selectedSuggestions, setSelectedSuggestions] = useState([]);

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setSuggestions([
        'How do you handle disagreements with team members about technical approaches?',
        'Describe a system you designed from scratch. What trade-offs did you make?',
        'How do you stay current with new technologies and industry trends?',
        'Tell me about a time you had to optimize performance in a critical system.',
        'What\'s your approach to mentoring junior engineers?',
      ]);
      setIsGenerating(false);
    }, 1500);
  };

  const toggleSuggestion = (suggestion) => {
    if (selectedSuggestions.includes(suggestion)) {
      setSelectedSuggestions(selectedSuggestions.filter(s => s !== suggestion));
    } else {
      setSelectedSuggestions([...selectedSuggestions, suggestion]);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.9)',
      backdropFilter: 'blur(20px)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 700, padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <SubTitle>AI_QUESTION_GENERATOR</SubTitle>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 8 }}>
            <X size={20} />
          </button>
        </div>

        {/* Prompt input */}
        <LiquidMetalCard variant="mercury" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
            DESCRIBE YOUR IDEAL CANDIDATE
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Senior engineer with distributed systems experience, strong communication skills, experience leading projects..."
            style={{
              width: '100%',
              height: 100,
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
              fontSize: 12,
              lineHeight: 1.7,
              padding: 16,
              resize: 'none',
              outline: 'none',
              fontFamily: '"Space Mono", monospace',
            }}
          />
          <button 
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              marginTop: 16,
              padding: '12px 24px',
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(59, 130, 246, 0.3))',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: isGenerating ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: isGenerating ? 0.7 : 1,
            }}
          >
            {isGenerating ? (
              <>
                <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
                GENERATING...
              </>
            ) : (
              <>
                <Wand2 size={14} />
                GENERATE QUESTIONS
              </>
            )}
          </button>
        </LiquidMetalCard>

        {/* Suggestions */}
        <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
          SUGGESTED QUESTIONS · SELECT TO ADD
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {suggestions.map((suggestion, i) => {
            const isSelected = selectedSuggestions.includes(suggestion);
            return (
              <LiquidMetalCard 
                key={i} 
                variant={isSelected ? 'chrome' : 'dark'} 
                hover 
                onClick={() => toggleSuggestion(suggestion)}
                style={{ padding: 16 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 24,
                    height: 24,
                    background: isSelected ? 'rgba(150,255,150,0.2)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isSelected ? 'rgba(150,255,150,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {isSelected && <Check size={12} color="rgba(150,255,150,0.9)" />}
                  </div>
                  <span style={{ fontSize: 12, color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
                    {suggestion}
                  </span>
                </div>
              </LiquidMetalCard>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 10,
              letterSpacing: '0.15em',
              cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
          <button 
            onClick={() => {
              onAdd(selectedSuggestions);
              onClose();
            }}
            disabled={selectedSuggestions.length === 0}
            style={{
              padding: '12px 24px',
              background: selectedSuggestions.length > 0 
                ? 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))'
                : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: selectedSuggestions.length > 0 ? '#fff' : 'rgba(255,255,255,0.3)',
              fontSize: 10,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: selectedSuggestions.length > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Plus size={14} />
            ADD {selectedSuggestions.length > 0 ? `${selectedSuggestions.length} ` : ''}QUESTIONS
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// QUESTION CARD
// ============================================================================

function QuestionCard({ question, index, onRecord, onDelete, onEdit }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <LiquidMetalCard variant="dark" style={{ marginBottom: 8 }}>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          {/* Drag handle */}
          <button style={{ padding: 4, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'grab', marginTop: 4 }}>
            <GripVertical size={16} />
          </button>

          {/* Question number */}
          <div style={{
            width: 36,
            height: 36,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{index + 1}</span>
          </div>

          {/* Question content */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{
                fontSize: 8,
                letterSpacing: '0.15em',
                padding: '4px 8px',
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
              }}>
                {question.type}
              </span>
              <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>
                {question.timeLimit} MIN RESPONSE
              </span>
              {question.required && (
                <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,100,100,0.6)' }}>REQUIRED</span>
              )}
            </div>
            
            <p style={{ fontSize: 13, color: '#fff', lineHeight: 1.6, margin: 0 }}>
              {question.text}
            </p>

            {/* Recording status */}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
              {question.hasRecording ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 8,
                    height: 8,
                    background: 'rgba(150,255,150,0.8)',
                    boxShadow: '0 0 8px rgba(150,255,150,0.5)',
                  }} />
                  <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(150,255,150,0.8)' }}>
                    RECORDED · {Math.floor(question.recordingDuration / 60)}:{(question.recordingDuration % 60).toString().padStart(2, '0')}
                  </span>
                  <button 
                    onClick={() => onRecord(question)}
                    style={{
                      padding: '4px 10px',
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.4)',
                      fontSize: 8,
                      letterSpacing: '0.1em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Play size={8} />
                    PREVIEW
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => onRecord(question)}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, rgba(255,80,80,0.2), rgba(255,100,100,0.1))',
                    border: '1px solid rgba(255,80,80,0.3)',
                    color: 'rgba(255,100,100,0.9)',
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Video size={12} />
                  RECORD VIDEO
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button 
              onClick={() => onEdit(question)}
              style={{ padding: 8, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}
            >
              <Edit3 size={14} />
            </button>
            <button 
              onClick={() => onDelete(question.id)}
              style={{ padding: 8, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </LiquidMetalCard>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ScreeningStageBuilder() {
  const [activeSection, setActiveSection] = useState('pipeline');
  const [mounted, setMounted] = useState(false);
  const [questions, setQuestions] = useState(initialQuestions);
  const [recordingQuestion, setRecordingQuestion] = useState(null);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSaveRecording = (duration) => {
    setQuestions(questions.map(q => 
      q.id === recordingQuestion.id 
        ? { ...q, hasRecording: true, recordingDuration: duration }
        : q
    ));
    setRecordingQuestion(null);
  };

  const handleDeleteQuestion = (id) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  const handleAddAIQuestions = (newQuestions) => {
    const newQs = newQuestions.map((text, i) => ({
      id: questions.length + i + 1,
      text,
      type: 'general',
      timeLimit: 2,
      required: false,
      hasRecording: false,
      recordingDuration: null,
    }));
    setQuestions([...questions, ...newQs]);
  };

  const handleAddManualQuestion = () => {
    if (!newQuestionText.trim()) return;
    setQuestions([...questions, {
      id: questions.length + 1,
      text: newQuestionText,
      type: 'general',
      timeLimit: 2,
      required: false,
      hasRecording: false,
      recordingDuration: null,
    }]);
    setNewQuestionText('');
    setShowAddManual(false);
  };

  const recordedCount = questions.filter(q => q.hasRecording).length;

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
      <ChromeMeshGrid />

      {/* Video Recorder Modal */}
      {recordingQuestion && (
        <VideoRecorder 
          question={recordingQuestion}
          onSave={handleSaveRecording}
          onClose={() => setRecordingQuestion(null)}
        />
      )}

      {/* AI Generator Modal */}
      {showAIGenerator && (
        <AIQuestionGenerator 
          onAdd={handleAddAIQuestions}
          onClose={() => setShowAIGenerator(false)}
        />
      )}

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
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4 // STAGE 1</span>
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
              SCREENING_QUESTIONS
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
              <Save size={12} />
              SAVE STAGE
            </button>
          </div>
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
          {/* Stats bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            marginBottom: 32,
            paddingBottom: 20,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
          }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>QUESTIONS</div>
              <div style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {questions.length}
              </div>
            </div>
            <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>RECORDED</div>
              <div style={{
                fontSize: 24,
                fontWeight: 800,
                background: recordedCount === questions.length 
                  ? 'linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)'
                  : 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {recordedCount}/{questions.length}
              </div>
            </div>
            <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>EST. TIME</div>
              <div style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {questions.reduce((sum, q) => sum + q.timeLimit, 0)} MIN
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 32 }}>
            {/* Questions list */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <SubTitle>QUESTIONS</SubTitle>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    onClick={() => setShowAIGenerator(true)}
                    style={{
                      padding: '8px 14px',
                      background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.15))',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      color: 'rgba(139, 92, 246, 0.9)',
                      fontSize: 8,
                      letterSpacing: '0.15em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Wand2 size={10} />
                    AI GENERATE
                  </button>
                  <button 
                    onClick={() => setShowAddManual(true)}
                    style={{
                      padding: '8px 14px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: 8,
                      letterSpacing: '0.15em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Plus size={10} />
                    ADD MANUAL
                  </button>
                </div>
              </div>

              {/* Add manual question form */}
              {showAddManual && (
                <LiquidMetalCard variant="mercury" style={{ padding: 20, marginBottom: 16 }}>
                  <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                    NEW QUESTION
                  </div>
                  <textarea
                    value={newQuestionText}
                    onChange={(e) => setNewQuestionText(e.target.value)}
                    placeholder="Enter your question..."
                    style={{
                      width: '100%',
                      height: 80,
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#fff',
                      fontSize: 13,
                      lineHeight: 1.6,
                      padding: 12,
                      resize: 'none',
                      outline: 'none',
                      fontFamily: '"Space Mono", monospace',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button 
                      onClick={() => setShowAddManual(false)}
                      style={{
                        padding: '8px 16px',
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        cursor: 'pointer',
                      }}
                    >
                      CANCEL
                    </button>
                    <button 
                      onClick={handleAddManualQuestion}
                      style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#fff',
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      ADD QUESTION
                    </button>
                  </div>
                </LiquidMetalCard>
              )}

              {/* Questions */}
              {questions.map((question, i) => (
                <div 
                  key={question.id}
                  style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(15px)',
                    transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${i * 60}ms`,
                  }}
                >
                  <QuestionCard 
                    question={question}
                    index={i}
                    onRecord={setRecordingQuestion}
                    onDelete={handleDeleteQuestion}
                    onEdit={() => {}}
                  />
                </div>
              ))}
            </div>

            {/* Right sidebar */}
            <div>
              {/* Recording progress */}
              <LiquidMetalCard variant="mercury" style={{ padding: 24, marginBottom: 16 }}>
                <SubTitle>RECORDING_PROGRESS</SubTitle>
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Videos recorded</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{recordedCount}/{questions.length}</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.06)' }}>
                    <div style={{
                      width: `${(recordedCount / questions.length) * 100}%`,
                      height: '100%',
                      background: recordedCount === questions.length 
                        ? 'linear-gradient(90deg, rgba(150,255,150,0.5), rgba(150,255,150,0.9))'
                        : 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))',
                      boxShadow: recordedCount === questions.length 
                        ? '0 0 12px rgba(150,255,150,0.4)'
                        : '0 0 10px rgba(255,255,255,0.2)',
                      transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                    }} />
                  </div>
                </div>

                {recordedCount === questions.length ? (
                  <div style={{ marginTop: 20, padding: 16, background: 'rgba(150,255,150,0.1)', border: '1px solid rgba(150,255,150,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CheckCircle size={16} color="rgba(150,255,150,0.9)" />
                      <span style={{ fontSize: 11, color: 'rgba(150,255,150,0.9)' }}>All questions recorded!</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 20, padding: 16, background: 'rgba(255,200,100,0.1)', border: '1px solid rgba(255,200,100,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Activity size={16} color="rgba(255,200,100,0.9)" />
                      <span style={{ fontSize: 11, color: 'rgba(255,200,100,0.9)' }}>
                        {questions.length - recordedCount} question{questions.length - recordedCount !== 1 ? 's' : ''} need recording
                      </span>
                    </div>
                  </div>
                )}
              </LiquidMetalCard>

              {/* Tips */}
              <LiquidMetalCard variant="default" style={{ padding: 24 }}>
                <SubTitle>TIPS</SubTitle>
                <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ width: 24, height: 24, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Video size={12} color="rgba(255,255,255,0.4)" />
                    </div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 }}>
                      Record a video for each question to give candidates context
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ width: 24, height: 24, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Clock size={12} color="rgba(255,255,255,0.4)" />
                    </div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 }}>
                      Keep intro videos under 90 seconds for better engagement
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ width: 24, height: 24, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Wand2 size={12} color="rgba(255,255,255,0.4)" />
                    </div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 }}>
                      Use AI to generate role-specific questions quickly
                    </p>
                  </div>
                </div>
              </LiquidMetalCard>
            </div>
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