import { Heatmap } from '@paper-design/shaders-react';

interface PipeHeatmapProps {
  speed: number;
  scale?: number;
}

export function PipeHeatmap({ speed, scale = 0.6 }: PipeHeatmapProps): JSX.Element {
  return (
    <Heatmap
      width={1920}
      height={1080}
      image="/mario-pipe.svg"
      fit="cover"
      colorBack="#1a1a2e"
      colors={['#a78bfa', '#60a5fa', '#f87171', '#fbbf24']}
      contour={0.6}
      noise={0.4}
      innerGlow={0.6}
      outerGlow={0.5}
      angle={70}
      speed={speed}
      scale={scale}
    />
  );
}
