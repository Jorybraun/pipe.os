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

  // Animate speed: start at bg.speed, ease down to 0 over ~8s
  const [speed, setSpeed] = useState(bg.speed);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const animate = useCallback((ts: number) => {
    if (!startRef.current) startRef.current = ts;
    const elapsed = ts - startRef.current;
    const duration = 8000;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    setSpeed(bg.speed * (1 - eased));
    if (progress < 1) {
      rafRef.current = requestAnimationFrame(animate);
    }
  }, [bg.speed]);

  useEffect(() => {
    startRef.current = 0;
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  const ShaderComponent = bg.shader === 'heatmap' ? PipeHeatmap : PipeLiquidMetal;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#0c0c0e' }} />
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
        <ShaderComponent speed={speed} scale={bg.scale} />
      </div>
      <ChromeMeshGrid />
    </>
  );
}
