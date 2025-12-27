import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle,
  Play,
  Pause,
  Video,
  VideoOff,
  Mic,
  MicOff,
  User,
  Clock,
  ChevronRight,
  RotateCcw,
  Square,
  Building,
  Calendar,
  FileText,
  AlertCircle,
  Volume2,
  Check,
} from 'lucide-react';

// ============================================================================
// DESIGN SYSTEM COMPONENTS
// ============================================================================

function LiquidMetalCard({ children, style = {}, variant = 'default' }) {
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
    <div style={{
      background: v.background,
      backdropFilter: 'blur(40px) saturate(150%)',
      WebkitBackdropFilter: 'blur(40px) saturate(150%)',
      border: v.border,
      position: 'relative',
      overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
      ...style,
    }}>
      {children}
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

function SubTitle({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
      <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{children}</span>
    </div>
  );
}

// ============================================================================
// PROGRESS BAR COMPONENT
// ============================================================================

function ProgressBar({ currentQuestion, totalQuestions, completedQuestions }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      padding: '16px 32px',
      background: 'rgba(12, 12, 14, 0.9)',
      backdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)' }}>
          QUESTION {currentQuestion} OF {totalQuestions}
        </div>
      </div>
      
      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 8 }}>
        {Array.from({ length: totalQuestions }, (_, i) => {
          const isCompleted = completedQuestions.includes(i + 1);
          const isCurrent = i + 1 === currentQuestion;
          return (
            <div key={i} style={{
              width: isCurrent ? 32 : 12,
              height: 12,
              background: isCompleted 
                ? 'linear-gradient(90deg, rgba(150,255,150,0.6), rgba(150,255,150,0.9))'
                : isCurrent 
                  ? 'linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.7))'
                  : 'rgba(255,255,255,0.1)',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              boxShadow: isCompleted ? '0 0 8px rgba(150,255,150,0.4)' : 'none',
            }} />
          );
        })}
      </div>
      
      <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)' }}>
        SR. SOFTWARE ENGINEER
      </div>
    </div>
  );
}

// ============================================================================
// WELCOME SCREEN
// ============================================================================

function WelcomeScreen({ role, questionCount, estimatedTime, onStart }) {
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [checkingPermissions, setCheckingPermissions] = useState(false);

  const checkPermissions = async () => {
    setCheckingPermissions(true);
    // Simulate permission check
    setTimeout(() => {
      setPermissionsGranted(true);
      setCheckingPermissions(false);
    }, 1500);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    }}>
      <LiquidMetalCard variant="mercury" style={{ maxWidth: 600, width: '100%', padding: 48 }}>
        {/* Company logo placeholder */}
        <div style={{
          width: 64,
          height: 64,
          background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
          border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 32,
        }}>
          <Building size={28} color="rgba(255,255,255,0.6)" />
        </div>

        <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
          VIDEO SCREENING FOR
        </div>
        
        <h1 style={{
          fontSize: 36,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          margin: '0 0 24px',
          background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 50%, #fff 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          {role}
        </h1>

        <p style={{
          fontSize: 13,
          lineHeight: 1.8,
          color: 'rgba(255,255,255,0.6)',
          margin: '0 0 32px',
        }}>
          You'll be asked {questionCount} questions. For each question, you'll first watch a brief video from the hiring team, then record your response.
        </p>

        {/* Info cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 32 }}>
          <LiquidMetalCard variant="dark" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <FileText size={16} color="rgba(255,255,255,0.4)" />
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{questionCount}</div>
                <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)' }}>QUESTIONS</div>
              </div>
            </div>
          </LiquidMetalCard>
          <LiquidMetalCard variant="dark" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Clock size={16} color="rgba(255,255,255,0.4)" />
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{estimatedTime}</div>
                <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)' }}>MINUTES</div>
              </div>
            </div>
          </LiquidMetalCard>
        </div>

        {/* Permissions check */}
        <LiquidMetalCard variant="default" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Video size={16} color={permissionsGranted ? 'rgba(150,255,150,0.8)' : 'rgba(255,255,255,0.4)'} />
                <Mic size={16} color={permissionsGranted ? 'rgba(150,255,150,0.8)' : 'rgba(255,255,255,0.4)'} />
              </div>
              <span style={{ fontSize: 11, color: permissionsGranted ? 'rgba(150,255,150,0.8)' : 'rgba(255,255,255,0.6)' }}>
                {permissionsGranted ? 'Camera & microphone ready' : 'Camera & microphone access required'}
              </span>
            </div>
            {!permissionsGranted && (
              <button 
                onClick={checkPermissions}
                disabled={checkingPermissions}
                style={{
                  padding: '8px 16px',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  cursor: checkingPermissions ? 'wait' : 'pointer',
                }}
              >
                {checkingPermissions ? 'CHECKING...' : 'ENABLE'}
              </button>
            )}
            {permissionsGranted && <CheckCircle size={18} color="rgba(150,255,150,0.8)" />}
          </div>
        </LiquidMetalCard>

        {/* Start button */}
        <button 
          onClick={onStart}
          disabled={!permissionsGranted}
          style={{
            width: '100%',
            padding: '16px 32px',
            background: permissionsGranted 
              ? 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))'
              : 'rgba(255,255,255,0.05)',
            border: `1px solid ${permissionsGranted ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'}`,
            color: permissionsGranted ? '#fff' : 'rgba(255,255,255,0.3)',
            fontSize: 12,
            letterSpacing: '0.15em',
            fontWeight: 700,
            cursor: permissionsGranted ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          BEGIN SCREENING
          <ChevronRight size={18} />
        </button>
      </LiquidMetalCard>
    </div>
  );
}

// ============================================================================
// QUESTION DISPLAY SCREEN
// ============================================================================

function QuestionDisplay({ question, questionNumber, totalQuestions, onReady }) {
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [videoEnded, setVideoEnded] = useState(false);

  // Simulate video playback
  useEffect(() => {
    if (videoPlaying) {
      const timer = setTimeout(() => {
        setVideoEnded(true);
        setVideoPlaying(false);
      }, 3000); // Simulate 3 second video
      return () => clearTimeout(timer);
    }
  }, [videoPlaying]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 32px 32px',
    }}>
      <div style={{ maxWidth: 800, width: '100%' }}>
        <SubTitle>QUESTION {questionNumber} OF {totalQuestions}</SubTitle>
        
        {/* Recruiter video */}
        <LiquidMetalCard variant="dark" style={{ marginTop: 20, marginBottom: 24, overflow: 'hidden' }}>
          <div style={{
            aspectRatio: '16/9',
            background: 'linear-gradient(135deg, rgba(60,60,80,0.8), rgba(40,40,60,0.9))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            {/* Simulated recruiter avatar */}
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

            {/* Playing indicator */}
            {videoPlaying && (
              <div style={{
                position: 'absolute',
                bottom: 20,
                left: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <Volume2 size={14} color="rgba(255,255,255,0.6)" />
                <div style={{ display: 'flex', gap: 2 }}>
                  {[1,2,3,4].map(i => (
                    <div key={i} style={{
                      width: 3,
                      height: 12 + Math.random() * 8,
                      background: 'rgba(255,255,255,0.6)',
                      animation: `soundWave 0.5s ease-in-out ${i * 0.1}s infinite alternate`,
                    }} />
                  ))}
                </div>
              </div>
            )}

            {/* Video ended overlay */}
            {videoEnded && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <button 
                  onClick={() => { setVideoEnded(false); setVideoPlaying(true); }}
                  style={{
                    padding: '12px 24px',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <RotateCcw size={14} />
                  REPLAY
                </button>
              </div>
            )}
          </div>
        </LiquidMetalCard>

        {/* Question card */}
        <LiquidMetalCard variant="mercury" style={{ padding: 32, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{
              fontSize: 8,
              letterSpacing: '0.15em',
              padding: '4px 10px',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.5)',
              textTransform: 'uppercase',
            }}>
              {question.type}
            </span>
            <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>
              {question.timeLimit} MIN TO RESPOND
            </span>
          </div>
          
          <p style={{
            fontSize: 18,
            lineHeight: 1.7,
            color: '#fff',
            margin: 0,
          }}>
            {question.text}
          </p>
        </LiquidMetalCard>

        {/* Ready button */}
        <button 
          onClick={onReady}
          style={{
            width: '100%',
            padding: '16px 32px',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff',
            fontSize: 12,
            letterSpacing: '0.15em',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          I'M READY TO ANSWER
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// COUNTDOWN SCREEN
// ============================================================================

function CountdownScreen({ question, onCountdownComplete }) {
  const [countdown, setCountdown] = useState(5);
  const [cameraOn, setCameraOn] = useState(true);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      onCountdownComplete();
    }
  }, [countdown, onCountdownComplete]);

  const skipCountdown = () => {
    setCountdown(0);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 32px 32px',
    }}>
      <div style={{ maxWidth: 900, width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 32 }}>
          {/* Countdown display */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>
              GET READY
            </div>
            
            <div style={{
              fontSize: 160,
              fontWeight: 900,
              lineHeight: 1,
              background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.6) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 4px 60px rgba(200,210,230,0.3))',
              animation: 'countdownPulse 1s ease-in-out infinite',
            }}>
              {countdown}
            </div>
            
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 24 }}>
              Recording will begin automatically
            </div>

            <button 
              onClick={skipCountdown}
              style={{
                marginTop: 32,
                padding: '10px 24px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 10,
                letterSpacing: '0.15em',
                cursor: 'pointer',
              }}
            >
              START NOW
            </button>
          </div>

          {/* Camera preview */}
          <div>
            <LiquidMetalCard variant="dark" style={{ overflow: 'hidden' }}>
              <div style={{
                aspectRatio: '4/3',
                background: cameraOn 
                  ? 'linear-gradient(135deg, rgba(60,60,80,0.8), rgba(40,40,60,0.9))'
                  : 'rgba(20,20,30,0.95)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {cameraOn ? (
                  <div style={{
                    width: 80,
                    height: 80,
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(200,200,220,0.05))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid rgba(255,255,255,0.2)',
                  }}>
                    <User size={32} color="rgba(255,255,255,0.3)" />
                  </div>
                ) : (
                  <VideoOff size={32} color="rgba(255,255,255,0.2)" />
                )}
              </div>
              
              <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    onClick={() => setCameraOn(!cameraOn)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: cameraOn ? 'rgba(255,255,255,0.1)' : 'rgba(255,80,80,0.2)',
                      border: `1px solid ${cameraOn ? 'rgba(255,255,255,0.15)' : 'rgba(255,80,80,0.3)'}`,
                      color: cameraOn ? '#fff' : 'rgba(255,80,80,0.9)',
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {cameraOn ? <Video size={14} /> : <VideoOff size={14} />}
                    {cameraOn ? 'ON' : 'OFF'}
                  </button>
                  <button style={{
                    flex: 1,
                    padding: '10px',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}>
                    <Mic size={14} />
                    ON
                  </button>
                </div>
              </div>
            </LiquidMetalCard>

            {/* Question reminder */}
            <LiquidMetalCard variant="default" style={{ padding: 16, marginTop: 12 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>
                QUESTION
              </div>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', margin: 0, lineHeight: 1.6 }}>
                {question.text}
              </p>
            </LiquidMetalCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RECORDING SCREEN
// ============================================================================

function RecordingScreen({ question, timeLimit, onStopRecording }) {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isWarning, setIsWarning] = useState(false);
  const maxTime = timeLimit * 60; // Convert minutes to seconds

  useEffect(() => {
    const timer = setInterval(() => {
      setRecordingTime(t => {
        const newTime = t + 1;
        if (maxTime - newTime <= 30) {
          setIsWarning(true);
        }
        if (newTime >= maxTime) {
          clearInterval(timer);
          onStopRecording();
        }
        return newTime;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [maxTime, onStopRecording]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const remainingTime = maxTime - recordingTime;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      padding: '80px 32px 32px',
    }}>
      {/* Main recording area */}
      <div style={{ flex: 1, display: 'flex', gap: 32, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {/* Video feed */}
        <div style={{ flex: 1 }}>
          <LiquidMetalCard variant="dark" style={{ height: '100%', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              minHeight: 400,
              background: 'linear-gradient(135deg, rgba(60,60,80,0.8), rgba(40,40,60,0.9))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}>
              {/* Simulated camera feed */}
              <div style={{
                width: 150,
                height: 150,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(200,200,220,0.05))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid rgba(255,255,255,0.2)',
              }}>
                <User size={60} color="rgba(255,255,255,0.3)" />
              </div>

              {/* Recording indicator */}
              <div style={{
                position: 'absolute',
                top: 24,
                left: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                background: 'rgba(255,80,80,0.2)',
                border: '1px solid rgba(255,80,80,0.3)',
              }}>
                <div style={{
                  width: 12,
                  height: 12,
                  background: 'rgba(255,80,80,0.9)',
                  boxShadow: '0 0 12px rgba(255,80,80,0.6)',
                  animation: 'pulse 1s ease-in-out infinite',
                }} />
                <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#fff', fontWeight: 700 }}>REC</span>
              </div>

              {/* Elapsed time */}
              <div style={{
                position: 'absolute',
                top: 24,
                right: 24,
                padding: '8px 16px',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(10px)',
              }}>
                <span style={{
                  fontSize: 28,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.8) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  {formatTime(recordingTime)}
                </span>
              </div>

              {/* Time remaining warning */}
              {isWarning && (
                <div style={{
                  position: 'absolute',
                  bottom: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '10px 20px',
                  background: 'rgba(255,80,80,0.2)',
                  border: '1px solid rgba(255,80,80,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <AlertCircle size={16} color="rgba(255,80,80,0.9)" />
                  <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'rgba(255,80,80,0.9)' }}>
                    {formatTime(remainingTime)} REMAINING
                  </span>
                </div>
              )}
            </div>
          </LiquidMetalCard>
        </div>

        {/* Side panel */}
        <div style={{ width: 320 }}>
          {/* Question */}
          <LiquidMetalCard variant="mercury" style={{ padding: 24, marginBottom: 16 }}>
            <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
              QUESTION
            </div>
            <p style={{ fontSize: 13, color: '#fff', margin: 0, lineHeight: 1.7 }}>
              {question.text}
            </p>
          </LiquidMetalCard>

          {/* Time info */}
          <LiquidMetalCard variant="default" style={{ padding: 24, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>ELAPSED</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{formatTime(recordingTime)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>REMAINING</div>
                <div style={{ 
                  fontSize: 20, 
                  fontWeight: 800, 
                  color: isWarning ? 'rgba(255,80,80,0.9)' : '#fff' 
                }}>
                  {formatTime(remainingTime)}
                </div>
              </div>
            </div>
            
            {/* Progress bar */}
            <div style={{ height: 4, background: 'rgba(255,255,255,0.1)' }}>
              <div style={{
                width: `${(recordingTime / maxTime) * 100}%`,
                height: '100%',
                background: isWarning 
                  ? 'linear-gradient(90deg, rgba(255,80,80,0.6), rgba(255,80,80,0.9))'
                  : 'linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.8))',
                transition: 'width 1s linear',
              }} />
            </div>
          </LiquidMetalCard>

          {/* Stop button */}
          <button 
            onClick={onStopRecording}
            style={{
              width: '100%',
              padding: '16px 32px',
              background: 'linear-gradient(135deg, rgba(255,80,80,0.3), rgba(255,100,100,0.2))',
              border: '1px solid rgba(255,80,80,0.4)',
              color: '#fff',
              fontSize: 12,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            <Square size={14} fill="#fff" />
            FINISH RECORDING
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// REVIEW SCREEN
// ============================================================================

function ReviewScreen({ question, recordingDuration, onReRecord, onSubmit }) {
  const [isPlaying, setIsPlaying] = useState(false);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 32px 32px',
    }}>
      <div style={{ maxWidth: 800, width: '100%' }}>
        <SubTitle>REVIEW YOUR RESPONSE</SubTitle>

        {/* Video playback */}
        <LiquidMetalCard variant="dark" style={{ marginTop: 20, marginBottom: 24, overflow: 'hidden' }}>
          <div style={{
            aspectRatio: '16/9',
            background: 'linear-gradient(135deg, rgba(60,60,80,0.8), rgba(40,40,60,0.9))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
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

            {/* Play button overlay */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.3)',
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

            {/* Duration */}
            <div style={{
              position: 'absolute',
              bottom: 16,
              right: 16,
              padding: '6px 12px',
              background: 'rgba(0,0,0,0.6)',
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
            }}>
              {formatTime(recordingDuration)}
            </div>
          </div>
        </LiquidMetalCard>

        {/* Question reminder */}
        <LiquidMetalCard variant="default" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>
            QUESTION
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.6 }}>
            {question.text}
          </p>
        </LiquidMetalCard>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button 
            onClick={onReRecord}
            style={{
              flex: 1,
              padding: '16px 32px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)',
              fontSize: 11,
              letterSpacing: '0.15em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <RotateCcw size={16} />
            RE-RECORD
          </button>
          <button 
            onClick={onSubmit}
            style={{
              flex: 2,
              padding: '16px 32px',
              background: 'linear-gradient(135deg, rgba(150,255,150,0.2), rgba(100,200,100,0.15))',
              border: '1px solid rgba(150,255,150,0.3)',
              color: '#fff',
              fontSize: 11,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <Check size={16} />
            SUBMIT & CONTINUE
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPLETION SCREEN
// ============================================================================

function CompletionScreen({ totalQuestions }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    }}>
      <LiquidMetalCard variant="chrome" style={{ maxWidth: 600, width: '100%', padding: 60, textAlign: 'center' }}>
        {/* Success icon */}
        <div style={{
          width: 80,
          height: 80,
          background: 'linear-gradient(135deg, rgba(150,255,150,0.2), rgba(100,200,100,0.15))',
          border: '1px solid rgba(150,255,150,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 32px',
        }}>
          <CheckCircle size={36} color="rgba(150,255,150,0.9)" />
        </div>

        <div style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>
          SCREENING COMPLETE
        </div>

        <h1 style={{
          fontSize: 36,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          margin: '0 0 24px',
          background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 50%, #fff 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          THANK YOU!
        </h1>

        <p style={{
          fontSize: 14,
          lineHeight: 1.8,
          color: 'rgba(255,255,255,0.6)',
          margin: '0 0 32px',
        }}>
          Your responses have been submitted successfully. The hiring team will review your screening and get back to you within 5-7 business days.
        </p>

        {/* Summary */}
        <LiquidMetalCard variant="dark" style={{ padding: 24, marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{totalQuestions}</div>
              <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)' }}>QUESTIONS ANSWERED</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'rgba(150,255,150,0.9)' }}>✓</div>
              <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)' }}>SUBMITTED</div>
            </div>
          </div>
        </LiquidMetalCard>

        {/* Next steps */}
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
            NEXT STEPS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              'Your responses are being reviewed by the hiring team',
              'You\'ll receive an email within 5-7 business days',
              'If selected, you\'ll be invited to the next interview stage',
            ].map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  width: 20,
                  height: 20,
                  background: 'rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.4)',
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const mockQuestions = [
  { 
    id: 1, 
    text: 'Tell me about your experience with distributed systems and how you\'ve applied that knowledge in previous roles.', 
    type: 'technical', 
    timeLimit: 3,
  },
  { 
    id: 2, 
    text: 'Why are you interested in this role and what excites you about our company?', 
    type: 'motivation', 
    timeLimit: 2,
  },
  { 
    id: 3, 
    text: 'Describe a challenging technical problem you solved recently. Walk me through your approach.', 
    type: 'behavioral', 
    timeLimit: 3,
  },
];

export default function CandidateScreeningView() {
  const [screen, setScreen] = useState('welcome'); // welcome, question, countdown, recording, review, complete
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [completedQuestions, setCompletedQuestions] = useState([]);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const currentQuestion = mockQuestions[currentQuestionIndex];
  const totalQuestions = mockQuestions.length;

  const handleStartScreening = () => {
    setScreen('question');
  };

  const handleReadyToAnswer = () => {
    setScreen('countdown');
  };

  const handleCountdownComplete = () => {
    setScreen('recording');
  };

  const handleStopRecording = () => {
    setRecordingDuration(Math.floor(Math.random() * 60) + 30); // Random duration for demo
    setScreen('review');
  };

  const handleReRecord = () => {
    setScreen('countdown');
  };

  const handleSubmitAnswer = () => {
    setCompletedQuestions([...completedQuestions, currentQuestionIndex + 1]);
    
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setScreen('question');
    } else {
      setScreen('complete');
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0c0c0e', 
      fontFamily: '"Space Mono", monospace', 
      color: '#fff',
      position: 'relative',
    }}>
      <ChromeMeshGrid />

      {/* Progress bar - show on all screens except welcome and complete */}
      {!['welcome', 'complete'].includes(screen) && (
        <ProgressBar 
          currentQuestion={currentQuestionIndex + 1}
          totalQuestions={totalQuestions}
          completedQuestions={completedQuestions}
        />
      )}

      {/* Screens */}
      {screen === 'welcome' && (
        <WelcomeScreen 
          role="SR. SOFTWARE ENGINEER"
          questionCount={totalQuestions}
          estimatedTime={mockQuestions.reduce((sum, q) => sum + q.timeLimit, 0) + 5}
          onStart={handleStartScreening}
        />
      )}

      {screen === 'question' && (
        <QuestionDisplay 
          question={currentQuestion}
          questionNumber={currentQuestionIndex + 1}
          totalQuestions={totalQuestions}
          onReady={handleReadyToAnswer}
        />
      )}

      {screen === 'countdown' && (
        <CountdownScreen 
          question={currentQuestion}
          onCountdownComplete={handleCountdownComplete}
        />
      )}

      {screen === 'recording' && (
        <RecordingScreen 
          question={currentQuestion}
          timeLimit={currentQuestion.timeLimit}
          onStopRecording={handleStopRecording}
        />
      )}

      {screen === 'review' && (
        <ReviewScreen 
          question={currentQuestion}
          recordingDuration={recordingDuration}
          onReRecord={handleReRecord}
          onSubmit={handleSubmitAnswer}
        />
      )}

      {screen === 'complete' && (
        <CompletionScreen totalQuestions={totalQuestions} />
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        @keyframes pulse { 
          0%, 100% { opacity: 1; transform: scale(1); } 
          50% { opacity: 0.6; transform: scale(0.95); } 
        }
        @keyframes countdownPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes soundWave {
          0% { height: 8px; }
          100% { height: 16px; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>
    </div>
  );
}