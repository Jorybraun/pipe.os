import { LiquidMetal } from "@paper-design/shaders-react";

export const LiquidContainerSkeleton = () => {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c0c0e",
        padding: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        flexWrap: "wrap",
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {/* Card 1: Profile Card Style */}
      <div
        style={{
          width: 380,
          height: 540,
          position: "relative",
          borderRadius: 24,
          overflow: "hidden",
          background: "#000",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Liquid Metal Background confined to this div */}
        <div style={{ position: "absolute", inset: 0 }}>
          <LiquidMetal
            width={380}
            height={600}
            image="/square.svg"
            colorBack="#000000"
            colorTint="#ffffff"
            shape="circle"
            repetition={2}
            softness={0.1}
            shiftRed={0.3}
            shiftBlue={0.3}
            distortion={0.07}
            contour={0.4}
            angle={70}
            speed={0.5}
            scale={0.8}
            fit="cover"
          />
        </div>

        {/* Overlay Content */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            padding: 32,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.8) 100%)",
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              marginBottom: 24,
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.2)",
              animation: "pulse 2s infinite",
            }}
          />

          <div
            style={{
              width: "70%",
              height: 32,
              background: "rgba(255,255,255,0.15)",
              borderRadius: 4,
              marginBottom: 16,
              animation: "pulse 2s infinite 0.2s",
            }}
          />

          <div
            style={{
              width: "100%",
              height: 12,
              background: "rgba(255,255,255,0.1)",
              borderRadius: 2,
              marginBottom: 8,
              animation: "pulse 2s infinite 0.3s",
            }}
          />
          <div
            style={{
              width: "90%",
              height: 12,
              background: "rgba(255,255,255,0.1)",
              borderRadius: 2,
              marginBottom: 8,
              animation: "pulse 2s infinite 0.4s",
            }}
          />
          <div
            style={{
              width: "60%",
              height: 12,
              background: "rgba(255,255,255,0.1)",
              borderRadius: 2,
              marginBottom: 32,
              animation: "pulse 2s infinite 0.5s",
            }}
          />

          <div style={{ marginTop: "auto", display: "flex", gap: 12 }}>
            <div
              style={{
                flex: 1,
                height: 48,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 12,
                animation: "pulse 2s infinite 0.6s",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
            <div
              style={{
                flex: 1,
                height: 48,
                background: "rgba(255,255,255,0.2)",
                borderRadius: 12,
                animation: "pulse 2s infinite 0.7s",
                border: "1px solid rgba(255,255,255,0.2)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Card 2: Feature/Detail Card Style */}
      <div
        style={{
          width: 380,
          height: 540,
          position: "relative",
          borderRadius: 24,
          overflow: "hidden",
          background: "#000",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Liquid Metal Background confined to this div */}
        <div style={{ position: "absolute", inset: 0 }}>
          <LiquidMetal
            width={380}
            height={540}
            image="/mario-pipe.svg"
            colorBack="#111111"
            colorTint="#666666"
            shape="diamond"
            repetition={0}
            softness={0.2}
            shiftRed={0.1}
            shiftBlue={0.8}
            distortion={0.1}
            contour={0.2}
            angle={120}
            speed={0.3}
            scale={1}
            fit="contain"
          />
        </div>

        {/* Overlay Content */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            padding: 32,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)",
          }}
        >
          <div
            style={{
              width: "100%",
              height: 200,
              background: "rgba(255,255,255,0.05)",
              borderRadius: 16,
              marginBottom: 32,
              border: "1px solid rgba(255,255,255,0.1)",
              animation: "pulse 2s infinite",
            }}
          />

          <div
            style={{
              width: "50%",
              height: 24,
              background: "rgba(255,255,255,0.2)",
              borderRadius: 4,
              marginBottom: 16,
              animation: "pulse 2s infinite 0.2s",
            }}
          />

          <div
            style={{
              width: "100%",
              height: 12,
              background: "rgba(255,255,255,0.1)",
              borderRadius: 2,
              marginBottom: 8,
              animation: "pulse 2s infinite 0.3s",
            }}
          />
          <div
            style={{
              width: "80%",
              height: 12,
              background: "rgba(255,255,255,0.1)",
              borderRadius: 2,
              marginBottom: 8,
              animation: "pulse 2s infinite 0.4s",
            }}
          />

          <div
            style={{
              marginTop: "auto",
              width: "100%",
              height: 56,
              background: "rgba(255,255,255,0.15)",
              borderRadius: 28,
              animation: "pulse 2s infinite 0.5s",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.4; }
          50% { opacity: 0.8; }
          100% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};
