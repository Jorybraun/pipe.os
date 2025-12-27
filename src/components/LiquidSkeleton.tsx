import React from "react";
import { LiquidMetal } from "@paper-design/shaders-react";

interface PaperMeshProps {
  opacity?: number;
  size?: number;
}

export const PaperMesh: React.FC<PaperMeshProps> = ({
  opacity = 0.03,
  size = 40,
}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      backgroundImage: `
      linear-gradient(rgba(255,255,255,${opacity}) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,${opacity}) 1px, transparent 1px)
    `,
      backgroundSize: `${size}px ${size}px`,
      pointerEvents: "none",
      zIndex: 1,
    }}
  />
);

interface LiquidSkeletonProps {
  showLiquid?: boolean;
}

export const LiquidSkeleton: React.FC<LiquidSkeletonProps> = ({
  showLiquid = true,
}) => {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c0c0e",
        fontFamily: '"Space Mono", monospace',
        color: "#fff",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background */}
      {showLiquid && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            opacity: 0.3,
          }}
        >
          <LiquidMetal
            width={1920}
            height={1080}
            image="/mario-pipe.svg"
            colorBack="#000000"
            colorTint="#444444"
            shape="diamond"
            repetition={2}
            softness={0.1}
            shiftRed={0.3}
            shiftBlue={0.3}
            distortion={0.07}
            contour={0.4}
            angle={70}
            speed={0.5}
            scale={0.5}
            fit="contain"
          />
        </div>
      )}

      <PaperMesh />

      {/* Content Skeleton */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          padding: 40,
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        {/* Header Skeleton */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 60,
          }}
        >
          <div>
            <div
              style={{
                width: 150,
                height: 12,
                background: "rgba(255,255,255,0.1)",
                marginBottom: 16,
                borderRadius: 2,
              }}
            />
            <div
              style={{
                width: 400,
                height: 48,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <div
              style={{
                width: 120,
                height: 40,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 4,
              }}
            />
            <div
              style={{
                width: 120,
                height: 40,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 4,
              }}
            />
          </div>
        </div>

        {/* Main Grid Skeleton */}
        <div
          style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: 24 }}
        >
          {/* Left Column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Identity Card */}
            <div
              style={{
                height: 300,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 0,
                animation: "pulse 2s infinite ease-in-out",
              }}
            />

            {/* Scores */}
            <div
              style={{
                height: 200,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                animation: "pulse 2s infinite ease-in-out 0.2s",
              }}
            />
          </div>

          {/* Right Column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Summary */}
            <div
              style={{
                height: 180,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                animation: "pulse 2s infinite ease-in-out 0.4s",
              }}
            />

            {/* Signals Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 24,
              }}
            >
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 140,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    animation: `pulse 2s infinite ease-in-out ${
                      0.4 + i * 0.1
                    }s`,
                  }}
                />
              ))}
            </div>

            {/* Pipeline */}
            <div
              style={{
                height: 120,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                animation: "pulse 2s infinite ease-in-out 0.8s",
              }}
            />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};
