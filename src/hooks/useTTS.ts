/**
 * useTTS — shared Text-to-Speech hook (Google Cloud Neural2 via /api/v1/tts).
 *
 * Queue-based so consecutive speak() calls play in order. Wires an AnalyserNode
 * to the currently playing audio so an EQ visualizer can read frequency data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const BASE_URL = import.meta.env?.VITE_API_URL || '';
const TTS_URL = `${BASE_URL}/api/v1/tts`;

interface ClerkWindow extends Window {
  Clerk?: {
    session?: {
      getToken: () => Promise<string>;
    };
  };
}

export interface UseTTSResult {
  /** Enqueue text for speech. No-op if disabled or text is empty. */
  speak: (text: string) => void;
  /** Stop current audio + clear the queue. */
  cancel: () => void;
  /** True while audio is playing. */
  isPlaying: boolean;
  /** Ref to the current AnalyserNode — pass to EQVisualizer. */
  analyserRef: React.RefObject<AnalyserNode | null>;
}

export function useTTS(enabled: boolean): UseTTSResult {
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const cancel = useCallback((): void => {
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const processQueue = useCallback(async (): Promise<void> => {
    if (playingRef.current || queueRef.current.length === 0) return;
    const text = queueRef.current.shift()!;
    playingRef.current = true;
    try {
      const clerkWindow = window as ClerkWindow;
      const token = await clerkWindow.Clerk?.session?.getToken();
      const resp = await fetch(TTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) {
        console.error('[useTTS] HTTP error:', resp.status);
        playingRef.current = false;
        processQueue();
        return;
      }
      const { audioContent } = (await resp.json()) as { audioContent: string };
      const audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
      audioRef.current = audio;

      try {
        if (!audioCtxRef.current) {
          const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          audioCtxRef.current = new Ctor();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') await ctx.resume();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;
      } catch (err) {
        console.warn('[useTTS] AnalyserNode setup failed, continuing without EQ:', err);
      }

      audio.onended = () => {
        playingRef.current = false;
        audioRef.current = null;
        setIsPlaying(false);
        processQueue();
      };
      setIsPlaying(true);
      await audio.play().catch((err) => {
        console.error('[useTTS] play error:', err);
        playingRef.current = false;
        setIsPlaying(false);
        processQueue();
      });
    } catch (err) {
      console.error('[useTTS] fetch error:', err);
      playingRef.current = false;
      setIsPlaying(false);
      processQueue();
    }
  // Reads mutable refs only — no deps required.
   
  }, []);

  const speak = useCallback((text: string): void => {
    if (!enabled || !text.trim()) return;
    queueRef.current.push(text);
    void processQueue();
  }, [enabled, processQueue]);

  // Cancel on unmount.
  useEffect(() => cancel, [cancel]);

  return { speak, cancel, isPlaying, analyserRef };
}
