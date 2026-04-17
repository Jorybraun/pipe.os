/**
 * EQVisualizer — 8-bar frequency meter driven by an AnalyserNode.
 *
 * Uses direct DOM style updates via refs so RAF doesn't trigger React renders.
 * Inherits `color` from its parent via `currentColor`.
 */

import { useEffect, useRef } from 'react';
import type { JSX } from 'react';

const EQ_BAR_COUNT = 8;
const MAX_HEIGHT_PX = 36;

interface Props {
  analyserRef: React.RefObject<AnalyserNode | null>;
  /** Height cap in px (default 36). */
  maxHeight?: number;
}

export function EQVisualizer({ analyserRef, maxHeight = MAX_HEIGHT_PX }: Props): JSX.Element {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let rafId = 0;
    const tick = (): void => {
      const analyser = analyserRef.current;
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < EQ_BAR_COUNT; i++) {
          const start = Math.floor((i / EQ_BAR_COUNT) * data.length);
          const end = Math.floor(((i + 1) / EQ_BAR_COUNT) * data.length);
          let sum = 0;
          for (let j = start; j < end; j++) sum += data[j] ?? 0;
          const avg = sum / Math.max(1, end - start);
          const level = avg / 255;
          const bar = barsRef.current[i];
          if (bar) bar.style.height = `${Math.max(3, level * maxHeight)}px`;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [analyserRef, maxHeight]);

  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: maxHeight + 4 }}>
      {Array.from({ length: EQ_BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          style={{
            width: 3,
            height: 3,
            background: 'currentColor',
            borderRadius: 2,
            transition: 'height 60ms linear',
          }}
        />
      ))}
    </div>
  );
}
