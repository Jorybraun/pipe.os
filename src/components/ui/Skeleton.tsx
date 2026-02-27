import { type CSSProperties } from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  circle?: boolean;
  style?: CSSProperties;
  className?: string;
}

/**
 * Skeleton - A placeholder component for loading states with a shimmer animation.
 * Follows the Brutalist Glassmorphic aesthetic.
 */
export function Skeleton({
  width = '100%',
  height = '1rem',
  borderRadius = 4,
  circle = false,
  style = {},
  className = '',
}: SkeletonProps): JSX.Element {
  const combinedStyle: CSSProperties = {
    width,
    height,
    borderRadius: circle ? '50%' : borderRadius,
    ...style,
  };

  return (
    <div 
      className={`skeleton ${className}`} 
      style={combinedStyle} 
      aria-hidden="true" 
    />
  );
}
