import { Heatmap } from '@paper-design/shaders-react';
import type { HeatmapColorTheme } from '../../../contexts/ThemeContext';

const THEME_CONFIGS: Record<HeatmapColorTheme, { colorBack: string; colors: string[] }> = {
  aurora: {
    colorBack: '#2a2a3e',
    colors: ['#c4a8ff', '#88c0ff', '#ff9999', '#ffe066'],
  },
  neon: {
    colorBack: '#0a0a1a',
    colors: ['#00d4ff', '#0066ff', '#00ffcc', '#3344ff'],
  },
  calm: {
    colorBack: '#1a1a2e',
    colors: ['#5c6b73', '#9db4c0', '#c2dfe3', '#e0e0e0'],
  },
};

interface PipeHeatmapProps {
  speed: number;
  scale?: number;
  colorTheme?: HeatmapColorTheme;
}

export function PipeHeatmap({ speed, scale = 0.6, colorTheme = 'aurora' }: PipeHeatmapProps): JSX.Element {
  const { colorBack, colors } = THEME_CONFIGS[colorTheme];

  return (
    <Heatmap
      width={1920}
      height={1080}
      image="/pipe-filled.svg"
      fit="cover"
      colorBack={colorBack}
      colors={colors}
      contour={0.8}
      noise={0.3}
      innerGlow={0.8}
      outerGlow={0.7}
      angle={70}
      speed={speed}
      scale={scale}
    />
  );
}
