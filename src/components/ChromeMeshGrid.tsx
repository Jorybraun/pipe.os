import React from "react";

interface ChromeMeshGridProps {
  opacity?: number;
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Chrome mesh grid background overlay
 * Used across most screens to create the signature grid aesthetic
 */
export function ChromeMeshGrid({
  opacity = 0.015,
  size = 80,
  style = {},
  className = "",
}: ChromeMeshGridProps) {
  return (
    <div
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,${opacity}) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,${opacity}) 1px, transparent 1px)
        `,
        backgroundSize: `${size}px ${size}px`,
        pointerEvents: "none",
        zIndex: 0,
        ...style,
      }}
    />
  );
}
