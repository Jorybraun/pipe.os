/**
 * AppBackground — Dark base + shader pipe + chrome mesh grid.
 *
 * Rendered once at the app root. Reads settings from ThemeContext.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChromeMeshGrid } from '../ChromeMeshGrid';
import { PipeLiquidMetal } from './shaders/PipeLiquidMetal';
import { PipeHeatmap } from './shaders/PipeHeatmap';
import { useTheme } from '../../contexts/ThemeContext';

export function AppBackground(): JSX.Element {
  const { theme } = useTheme();
  const bg = theme.background;

  // Animate speed: start at bg.speed, ease down to 0 over ~8s (unless animateForever)
  const [speed, setSpeed] = useState(bg.speed);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const animate = useCallback((ts: number) => {
    if (bg.animateForever) {
      setSpeed(bg.speed);
      return;
    }
    if (!startRef.current) startRef.current = ts;
    const elapsed = ts - startRef.current;
    const duration = 8000;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    setSpeed(bg.speed * (1 - eased));
    if (progress < 1) {
      rafRef.current = requestAnimationFrame(animate);
    }
  }, [bg.speed, bg.animateForever]);

  useEffect(() => {
    if (bg.animateForever) {
      setSpeed(bg.speed);
      return;
    }
    startRef.current = 0;
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate, bg.animateForever, bg.speed]);

  const shader = bg.shader === 'heatmap'
    ? <PipeHeatmap speed={speed} scale={bg.scale} colorTheme={bg.heatmapTheme} />
    : bg.shader === 'anatomy-spine'
    ? (
      <img
        src="/bg-spine.png"
        alt=""
        style={{
          width: '60%',
          height: '60%',
          objectFit: 'contain',
          objectPosition: 'center',
          filter: theme.mode === 'anatomy-dark'
            ? 'invert(1) grayscale(0.5) sepia(0.1) contrast(0.7) brightness(0.6)'
            : 'grayscale(0.5) sepia(0.1) contrast(0.7) brightness(1.1)',
          mixBlendMode: theme.mode === 'anatomy-dark' ? 'screen' : 'multiply',
          opacity: 0.7,
        }}
      />
    )
    : <PipeLiquidMetal speed={speed} scale={bg.scale} />;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'var(--pipe-bg, #0c0c0e)' }} />
      {bg.enabled && (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: bg.opacity,
            }}
          >
            {shader}
          </div>
          {/* Readability overlay — ensures text contrast over the pipe image */}
          {bg.shader === 'anatomy-spine' && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 0,
                pointerEvents: 'none',
                background: theme.mode === 'anatomy-dark'
                  ? 'radial-gradient(ellipse at center, rgba(26,18,8,0.3) 0%, rgba(26,18,8,0.7) 100%)'
                  : 'radial-gradient(ellipse at center, rgba(243,234,213,0.2) 0%, rgba(243,234,213,0.6) 100%)',
              }}
            />
          )}
          <ChromeMeshGrid />
        </>
      )}
    </>
  );
}
