import { LiquidMetal } from '@paper-design/shaders-react';

interface PipeLiquidMetalProps {
  speed: number;
  scale?: number;
}

export function PipeLiquidMetal({ speed, scale = 0.6 }: PipeLiquidMetalProps): JSX.Element {
  return (
    <LiquidMetal
      width={1920}
      height={1080}
      image="/mario-pipe.svg"
      fit="cover"
      colorBack="#aaaaac"
      colorTint="#ffffff"
      shape="diamond"
      repetition={2}
      softness={0.1}
      shiftRed={0.3}
      shiftBlue={0.3}
      distortion={0.07}
      contour={0.4}
      angle={70}
      speed={speed}
      scale={scale}
    />
  );
}
