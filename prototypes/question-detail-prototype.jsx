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
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Play,
  Pause,
  Square,
  Edit3,
  Trash2,
  Save,
  X,
  RotateCcw,
  BarChart3,
  Sliders,
  AlertCircle,
  Check,
  Copy,
  Eye,
  Settings,
  HelpCircle,
  Percent,
  Star,
  Minus,
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
// TAB NAVIGATION
// ============================================================================

function TabNav({ activeTab, onTabChange, tabs }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 24 }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            padding: '12px 24px',
            background: activeTab === tab.id 
              ? 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(200,200,220,0.08))'
              : 'transparent',
            border: `1px solid ${activeTab === tab.id ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
            borderBottom: activeTab === tab.id ? '2px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.06)',
            color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            letterSpacing: '0.15em',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <tab.icon size={14} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// VIDEO RECORDER COMPONENT
// ============================================================================

function VideoRecorder({ hasExistingVideo, existingDuration, onSave }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [hasRecording, setHasRecording] = useState(hasExistingVideo);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    if (hasExistingVideo && existingDuration) {
      setRecordingTime(existingDuration);
    }
  }, [hasExistingVideo, existingDuration]);

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
    <div>
      {/* Video preview */}
      <LiquidMetalCard variant="dark" style={{ marginBottom: 16, overflow: 'hidden' }}>
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
              <div style={{
                width: 100,
                height: 100,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(200,200,220,0.05))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid rgba(255,255,255,0.2)',
              }}>
                <User size={40} color="rgba(255,255,255,0.3)" />
              </div>
              
              {/* Recording indicator */}
              {isRecording && (
                <div style={{
                  position: 'absolute',
                  top: 16,
                  left: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  background: 'rgba(255,80,80,0.2)',
                  border: '1px solid rgba(255,80,80,0.3)',
                }}>
                  <div style={{
                    width: 10,
                    height: 10,
                    background: isPaused ? 'rgba(255,200,100,0.8)' : 'rgba(255,80,80,0.9)',
                    boxShadow: isPaused ? '0 0 8px rgba(255,200,100,0.6)' : '0 0 8px rgba(255,80,80,0.6)',
                    animation: isPaused ? 'none' : 'pulse 1s ease-in-out infinite',
                  }} />
                  <span style={{ fontSize: 10, letterSpacing: '0.1em', color: '#fff', fontWeight: 700 }}>
                    {isPaused ? 'PAUSED' : 'REC'}
                  </span>
                </div>
              )}

              {/* Timer */}
              <div style={{
                position: 'absolute',
                top: 16,
                right: 16,
                padding: '6px 12px',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(10px)',
              }}>
                <span style={{
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  {formatTime(recordingTime)}
                </span>
              </div>

              {/* Playback overlay for existing recording */}
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
                      width: 64,
                      height: 64,
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(200,200,220,0.1))',
                      border: '2px solid rgba(255,255,255,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    {isPlaying ? <Pause size={24} color="#fff" /> : <Play size={24} color="#fff" style={{ marginLeft: 2 }} />}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <VideoOff size={40} color="rgba(255,255,255,0.2)" />
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>
                CAMERA OFF
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Camera/Mic controls */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                onClick={() => setCameraOn(!cameraOn)}
                style={{
                  width: 40,
                  height: 40,
                  background: cameraOn ? 'rgba(255,255,255,0.1)' : 'rgba(255,80,80,0.2)',
                  border: `1px solid ${cameraOn ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.3)'}`,
                  color: cameraOn ? '#fff' : 'rgba(255,80,80,0.9)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {cameraOn ? <Video size={16} /> : <VideoOff size={16} />}
              </button>
              <button 
                onClick={() => setMicOn(!micOn)}
                style={{
                  width: 40,
                  height: 40,
                  background: micOn ? 'rgba(255,255,255,0.1)' : 'rgba(255,80,80,0.2)',
                  border: `1px solid ${micOn ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.3)'}`,
                  color: micOn ? '#fff' : 'rgba(255,80,80,0.9)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {micOn ? <Mic size={16} /> : <MicOff size={16} />}
              </button>
            </div>

            {/* Recording controls */}
            <div style={{ display: 'flex', gap: 8 }}>
              {!isRecording && !hasRecording && (
                <button 
                  onClick={startRecording}
                  style={{
                    padding: '10px 24px',
                    background: 'linear-gradient(135deg, rgba(255,80,80,0.4), rgba(255,100,100,0.3))',
                    border: '1px solid rgba(255,80,80,0.5)',
                    color: '#fff',
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ width: 8, height: 8, background: '#fff', borderRadius: '50%' }} />
                  RECORD
                </button>
              )}

              {isRecording && (
                <>
                  <button 
                    onClick={() => setIsPaused(!isPaused)}
                    style={{
                      width: 40,
                      height: 40,
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isPaused ? <Play size={16} /> : <Pause size={16} />}
                  </button>
                  <button 
                    onClick={stopRecording}
                    style={{
                      padding: '10px 24px',
                      background: 'linear-gradient(135deg, rgba(255,80,80,0.4), rgba(255,100,100,0.3))',
                      border: '1px solid rgba(255,80,80,0.5)',
                      color: '#fff',
                      fontSize: 10,
                      letterSpacing: '0.15em',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Square size={10} fill="#fff" />
                    STOP
                  </button>
                </>
              )}

              {hasRecording && !isRecording && (
                <>
                  <button 
                    onClick={resetRecording}
                    style={{
                      padding: '10px 20px',
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: 9,
                      letterSpacing: '0.15em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <RotateCcw size={12} />
                    RE-RECORD
                  </button>
                  <button 
                    onClick={() => onSave && onSave(recordingTime)}
                    style={{
                      padding: '10px 20px',
                      background: 'linear-gradient(135deg, rgba(150,255,150,0.2), rgba(100,200,100,0.15))',
                      border: '1px solid rgba(150,255,150,0.3)',
                      color: '#fff',
                      fontSize: 9,
                      letterSpacing: '0.15em',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Check size={12} />
                    SAVE
                  </button>
                </>
              )}
            </div>

            {/* Delete existing */}
            {hasRecording && !isRecording && (
              <button 
                onClick={resetRecording}
                style={{
                  width: 40,
                  height: 40,
                  background: 'transparent',
                  border: '1px solid rgba(255,80,80,0.2)',
                  color: 'rgba(255,80,80,0.6)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </LiquidMetalCard>

      {/* Tips */}
      <LiquidMetalCard variant="default" style={{ padding: 16 }}>
        <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>TIPS</div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.8 }}>
          <li>Keep recordings under 90 seconds</li>
          <li>Speak clearly and look at the camera</li>
          <li>Provide context to help candidates understand</li>
        </ul>
      </LiquidMetalCard>
    </div>
  );
}

// ============================================================================
// RUBRIC EDITOR COMPONENT
// ============================================================================

function RubricEditor({ rubric, onChange }) {
  const [dimensions, setDimensions] = useState(rubric || [
    { id: 1, name: 'Technical Knowledge', weight: 30, description: 'Demonstrates understanding of relevant technical concepts' },
    { id: 2, name: 'Problem Solving', weight: 25, description: 'Shows logical approach to breaking down problems' },
    { id: 3, name: 'Communication', weight: 25, description: 'Explains concepts clearly and concisely' },
    { id: 4, name: 'Experience Relevance', weight: 20, description: 'Provides relevant examples from past work' },
  ]);

  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);

  const updateDimension = (id, field, value) => {
    setDimensions(dimensions.map(d => 
      d.id === id ? { ...d, [field]: value } : d
    ));
  };

  const addDimension = () => {
    const newId = Math.max(...dimensions.map(d => d.id)) + 1;
    setDimensions([...dimensions, {
      id: newId,
      name: 'New Criterion',
      weight: 0,
      description: 'Enter description...',
    }]);
  };

  const removeDimension = (id) => {
    if (dimensions.length > 1) {
      setDimensions(dimensions.filter(d => d.id !== id));
    }
  };

  return (
    <div>
      {/* Weight status */}
      <LiquidMetalCard 
        variant={totalWeight === 100 ? 'mercury' : 'default'} 
        style={{ padding: 20, marginBottom: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Percent size={18} color={totalWeight === 100 ? 'rgba(150,255,150,0.8)' : 'rgba(255,200,100,0.8)'} />
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)' }}>TOTAL WEIGHT</div>
              <div style={{ 
                fontSize: 24, 
                fontWeight: 800,
                color: totalWeight === 100 ? 'rgba(150,255,150,0.9)' : 'rgba(255,200,100,0.9)',
              }}>
                {totalWeight}%
              </div>
            </div>
          </div>
          {totalWeight !== 100 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,200,100,0.8)' }}>
              <AlertCircle size={14} />
              <span style={{ fontSize: 10, letterSpacing: '0.1em' }}>
                {totalWeight < 100 ? `ADD ${100 - totalWeight}%` : `REMOVE ${totalWeight - 100}%`}
              </span>
            </div>
          )}
          {totalWeight === 100 && (
            <CheckCircle size={20} color="rgba(150,255,150,0.8)" />
          )}
        </div>
      </LiquidMetalCard>

      {/* Dimensions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {dimensions.map((dimension, i) => (
          <LiquidMetalCard key={dimension.id} variant="dark" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              {/* Order indicator */}
              <div style={{
                width: 32,
                height: 32,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{i + 1}</span>
              </div>

              {/* Content */}
              <div style={{ flex: 1 }}>
                {/* Name input */}
                <input
                  type="text"
                  value={dimension.name}
                  onChange={(e) => updateDimension(dimension.id, 'name', e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    padding: '4px 0',
                    outline: 'none',
                    fontFamily: '"Space Mono", monospace',
                    marginBottom: 8,
                  }}
                />

                {/* Description input */}
                <textarea
                  value={dimension.description}
                  onChange={(e) => updateDimension(dimension.id, 'description', e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 11,
                    lineHeight: 1.6,
                    padding: 10,
                    resize: 'none',
                    outline: 'none',
                    fontFamily: '"Space Mono", monospace',
                    height: 60,
                  }}
                />
              </div>

              {/* Weight control */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)' }}>WEIGHT</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button 
                    onClick={() => updateDimension(dimension.id, 'weight', Math.max(0, dimension.weight - 5))}
                    style={{
                      width: 28,
                      height: 28,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Minus size={12} />
                  </button>
                  <div style={{
                    width: 48,
                    height: 36,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{dimension.weight}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>%</span>
                  </div>
                  <button 
                    onClick={() => updateDimension(dimension.id, 'weight', Math.min(100, dimension.weight + 5))}
                    style={{
                      width: 28,
                      height: 28,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                {/* Remove button */}
                <button 
                  onClick={() => removeDimension(dimension.id)}
                  disabled={dimensions.length <= 1}
                  style={{
                    marginTop: 8,
                    padding: '4px 8px',
                    background: 'transparent',
                    border: 'none',
                    color: dimensions.length > 1 ? 'rgba(255,80,80,0.5)' : 'rgba(255,255,255,0.2)',
                    cursor: dimensions.length > 1 ? 'pointer' : 'not-allowed',
                    fontSize: 8,
                    letterSpacing: '0.1em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Trash2 size={10} />
                  REMOVE
                </button>
              </div>
            </div>

            {/* Weight bar */}
            <div style={{ marginTop: 16, height: 3, background: 'rgba(255,255,255,0.06)' }}>
              <div style={{
                width: `${dimension.weight}%`,
                height: '100%',
                background: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.6))',
                transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </div>
          </LiquidMetalCard>
        ))}
      </div>

      {/* Add dimension button */}
      <button 
        onClick={addDimension}
        style={{
          width: '100%',
          marginTop: 12,
          padding: 20,
          background: 'transparent',
          border: '1px dashed rgba(255,255,255,0.15)',
          color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontSize: 10,
          letterSpacing: '0.15em',
        }}
      >
        <Plus size={14} />
        ADD CRITERION
      </button>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function QuestionDetail() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('question');
  const [hasChanges, setHasChanges] = useState(false);
  
  // Question state
  const [questionText, setQuestionText] = useState(
    'Tell me about your experience with distributed systems and how you\'ve applied that knowledge in previous roles.'
  );
  const [questionType, setQuestionType] = useState('technical');
  const [timeLimit, setTimeLimit] = useState(3);
  const [isRequired, setIsRequired] = useState(true);
  const [hasVideo, setHasVideo] = useState(true);
  const [videoDuration, setVideoDuration] = useState(45);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const tabs = [
    { id: 'question', label: 'QUESTION', icon: Edit3 },
    { id: 'video', label: 'VIDEO', icon: Video },
    { id: 'rubric', label: 'RUBRIC', icon: BarChart3 },
    { id: 'settings', label: 'SETTINGS', icon: Settings },
  ];

  const typeOptions = ['technical', 'behavioral', 'motivation', 'situational'];

  const handleSave = () => {
    setHasChanges(false);
    // Save logic here
  };

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
                SCREENING
              </button>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.6)' }}>QUESTION 1</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
              <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4</span>
            </div>
            <h1 style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '8px 0 0',
              background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))',
            }}>
              EDIT_QUESTION
            </h1>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {hasChanges && (
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,200,100,0.8)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={12} />
                UNSAVED CHANGES
              </span>
            )}
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
            <button 
              onClick={handleSave}
              style={{
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
              }}
            >
              <Save size={12} />
              SAVE QUESTION
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ 
        padding: '32px', 
        maxWidth: 1000, 
        margin: '0 auto',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s',
      }}>
        {/* Tabs */}
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />

        {/* Question Tab */}
        {activeTab === 'question' && (
          <div>
            <SubTitle>QUESTION_CONTENT</SubTitle>
            
            {/* Question text */}
            <LiquidMetalCard variant="mercury" style={{ padding: 24, marginTop: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                QUESTION TEXT
              </div>
              <textarea
                value={questionText}
                onChange={(e) => { setQuestionText(e.target.value); setHasChanges(true); }}
                style={{
                  width: '100%',
                  height: 120,
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: 15,
                  lineHeight: 1.7,
                  padding: 16,
                  resize: 'none',
                  outline: 'none',
                  fontFamily: '"Space Mono", monospace',
                }}
              />
            </LiquidMetalCard>

            {/* Question settings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Type */}
              <LiquidMetalCard variant="default" style={{ padding: 20 }}>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                  QUESTION TYPE
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {typeOptions.map(type => (
                    <button
                      key={type}
                      onClick={() => { setQuestionType(type); setHasChanges(true); }}
                      style={{
                        padding: '8px 14px',
                        background: questionType === type ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${questionType === type ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
                        color: questionType === type ? '#fff' : 'rgba(255,255,255,0.5)',
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </LiquidMetalCard>

              {/* Time limit */}
              <LiquidMetalCard variant="default" style={{ padding: 20 }}>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                  RESPONSE TIME LIMIT
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button 
                    onClick={() => { setTimeLimit(Math.max(1, timeLimit - 1)); setHasChanges(true); }}
                    style={{
                      width: 36,
                      height: 36,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Minus size={14} />
                  </button>
                  <div style={{
                    flex: 1,
                    height: 48,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{timeLimit}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>MIN</span>
                  </div>
                  <button 
                    onClick={() => { setTimeLimit(Math.min(10, timeLimit + 1)); setHasChanges(true); }}
                    style={{
                      width: 36,
                      height: 36,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </LiquidMetalCard>

              {/* Required toggle */}
              <LiquidMetalCard variant="default" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                      REQUIRED
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                      Candidates must answer this question
                    </div>
                  </div>
                  <button 
                    onClick={() => { setIsRequired(!isRequired); setHasChanges(true); }}
                    style={{
                      width: 56,
                      height: 28,
                      background: isRequired ? 'rgba(150,255,150,0.3)' : 'rgba(255,255,255,0.1)',
                      border: `1px solid ${isRequired ? 'rgba(150,255,150,0.5)' : 'rgba(255,255,255,0.15)'}`,
                      cursor: 'pointer',
                      position: 'relative',
                      padding: 2,
                    }}
                  >
                    <div style={{
                      width: 22,
                      height: 22,
                      background: isRequired ? 'rgba(150,255,150,0.9)' : 'rgba(255,255,255,0.4)',
                      position: 'absolute',
                      left: isRequired ? 'calc(100% - 24px)' : '2px',
                      transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    }} />
                  </button>
                </div>
              </LiquidMetalCard>

              {/* Video status */}
              <LiquidMetalCard variant={hasVideo ? 'mercury' : 'default'} style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {hasVideo ? (
                      <div style={{ width: 8, height: 8, background: 'rgba(150,255,150,0.8)', boxShadow: '0 0 6px rgba(150,255,150,0.5)' }} />
                    ) : (
                      <div style={{ width: 8, height: 8, background: 'rgba(255,200,100,0.6)' }} />
                    )}
                    <div>
                      <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                        VIDEO
                      </div>
                      <div style={{ fontSize: 11, color: hasVideo ? 'rgba(150,255,150,0.8)' : 'rgba(255,200,100,0.8)' }}>
                        {hasVideo ? `Recorded · ${Math.floor(videoDuration / 60)}:${(videoDuration % 60).toString().padStart(2, '0')}` : 'No video recorded'}
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setActiveTab('video')}
                    style={{
                      padding: '8px 14px',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff',
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Video size={12} />
                    {hasVideo ? 'EDIT' : 'RECORD'}
                  </button>
                </div>
              </LiquidMetalCard>
            </div>
          </div>
        )}

        {/* Video Tab */}
        {activeTab === 'video' && (
          <div>
            <SubTitle>VIDEO_RECORDING</SubTitle>
            <div style={{ marginTop: 16 }}>
              <VideoRecorder 
                hasExistingVideo={hasVideo}
                existingDuration={videoDuration}
                onSave={(duration) => { 
                  setHasVideo(true); 
                  setVideoDuration(duration); 
                  setHasChanges(true); 
                }}
              />
            </div>
          </div>
        )}

        {/* Rubric Tab */}
        {activeTab === 'rubric' && (
          <div>
            <SubTitle>SCORING_RUBRIC</SubTitle>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: '16px 0 24px' }}>
              Define the criteria used to evaluate candidate responses. Each criterion has a weight that contributes to the overall score.
            </p>
            <RubricEditor onChange={() => setHasChanges(true)} />
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div>
            <SubTitle>QUESTION_SETTINGS</SubTitle>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <LiquidMetalCard variant="default" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Allow Re-recording</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Candidates can re-record their response before submitting</div>
                  </div>
                  <button style={{
                    width: 56,
                    height: 28,
                    background: 'rgba(150,255,150,0.3)',
                    border: '1px solid rgba(150,255,150,0.5)',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: 2,
                  }}>
                    <div style={{
                      width: 22,
                      height: 22,
                      background: 'rgba(150,255,150,0.9)',
                      position: 'absolute',
                      right: 2,
                    }} />
                  </button>
                </div>
              </LiquidMetalCard>

              <LiquidMetalCard variant="default" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Preparation Countdown</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Time given to prepare before recording starts</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>30</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>SEC</span>
                  </div>
                </div>
              </LiquidMetalCard>

              <LiquidMetalCard variant="default" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Auto-Advance</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Automatically move to next question after time limit</div>
                  </div>
                  <button style={{
                    width: 56,
                    height: 28,
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: 2,
                  }}>
                    <div style={{
                      width: 22,
                      height: 22,
                      background: 'rgba(255,255,255,0.4)',
                      position: 'absolute',
                      left: 2,
                    }} />
                  </button>
                </div>
              </LiquidMetalCard>

              {/* Danger zone */}
              <div style={{ marginTop: 24 }}>
                <SubTitle>DANGER_ZONE</SubTitle>
                <LiquidMetalCard variant="dark" style={{ padding: 24, marginTop: 16, border: '1px solid rgba(255,80,80,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,80,80,0.9)', marginBottom: 4 }}>Delete Question</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>This action cannot be undone</div>
                    </div>
                    <button style={{
                      padding: '10px 20px',
                      background: 'rgba(255,80,80,0.1)',
                      border: '1px solid rgba(255,80,80,0.3)',
                      color: 'rgba(255,80,80,0.9)',
                      fontSize: 9,
                      letterSpacing: '0.15em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <Trash2 size={12} />
                      DELETE
                    </button>
                  </div>
                </LiquidMetalCard>
              </div>
            </div>
          </div>
        )}
      </main>

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