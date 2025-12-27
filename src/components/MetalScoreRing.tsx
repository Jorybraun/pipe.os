interface MetalScoreRingProps {
  value: number;
  size?: number;
  label?: string;
}

export function MetalScoreRing({
  value,
  size = 120,
  label,
}: MetalScoreRingProps) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* Glow effect */}
      <div
        style={{
          position: "absolute",
          inset: 10,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(200,210,230,0.15) 0%, transparent 70%)",
          filter: "blur(10px)",
        }}
      />

      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Chrome gradient progress */}
        <defs>
          <linearGradient
            id={`chrome-${label}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
            <stop offset="25%" stopColor="rgba(200,200,220,0.7)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="75%" stopColor="rgba(180,180,200,0.7)" />
            <stop offset="100%" stopColor="rgba(220,220,240,0.9)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#chrome-${label})`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: '"Monument Extended", "Space Grotesk", sans-serif',
            fontSize: 32,
            fontWeight: 800,
            background:
              "linear-gradient(180deg, #fff 0%, rgba(200,200,220,0.8) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
        {label && (
          <span
            style={{
              fontFamily: '"Space Mono", monospace',
              fontSize: 8,
              letterSpacing: "0.25em",
              color: "rgba(255,255,255,0.4)",
              marginTop: 4,
            }}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
