import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Play,
  Pause,
  Square,
  RotateCcw,
  Check,
  Trash2,
  User,
} from 'lucide-react';
import { LiquidMetalCard } from './ui/LiquidMetalCard';

/**
 * Video recorder component.
 * Has internal recording state (isRecording, timer, etc.) but parent controls
 * the persisted video data (hasExistingVideo, existingDuration).
 */
export function VideoRecorder({ hasExistingVideo, existingDuration, onSave, onDelete }) {
  // Recording session state (internal)
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const timerRef = useRef(null);

  // Initialize from existing video
  useEffect(() => {
    if (hasExistingVideo && existingDuration) {
      setRecordingTime(existingDuration);
      setHasRecording(true);
    } else {
      setHasRecording(false);
      setRecordingTime(0);
    }
  }, [hasExistingVideo, existingDuration]);

  // Timer management
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
    if (onDelete) {
      onDelete();
    }
  };

  const handleSave = () => {
    if (onSave) {
      onSave(recordingTime);
    }
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
                    onClick={handleSave}
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

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.95); } }
      `}</style>
    </div>
  );
}
