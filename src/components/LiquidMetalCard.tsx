import { useState, CSSProperties, ReactNode } from "react";

interface LiquidMetalCardProps {
  children: ReactNode;
  style?: CSSProperties;
  variant?: "default" | "chrome" | "mercury" | "dark";
  hover?: boolean;
  className?: string;
  onClick?: () => void;
  "data-testid"?: string;
}

export function LiquidMetalCard({
  children,
  style = {},
  variant = "default",
  hover = false,
  className = "",
  onClick,
  "data-testid": dataTestId,
}: LiquidMetalCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Borders use `var(--pipe-border)` so they remain visible in both light and
  // dark mode. Backgrounds stay as variant-specific gradients.
  const variants = {
    default: {
      background: `
        linear-gradient(135deg,
          rgba(180, 180, 190, 0.08) 0%,
          rgba(120, 120, 140, 0.04) 25%,
          rgba(200, 200, 210, 0.08) 50%,
          rgba(100, 100, 120, 0.04) 75%,
          rgba(160, 160, 180, 0.08) 100%
        )
      `,
      border: "1px solid var(--pipe-border)",
    },
    chrome: {
      background: `
        linear-gradient(135deg,
          rgba(220, 220, 230, 0.15) 0%,
          rgba(180, 180, 200, 0.08) 20%,
          rgba(255, 255, 255, 0.2) 40%,
          rgba(160, 160, 180, 0.08) 60%,
          rgba(200, 200, 220, 0.12) 80%,
          rgba(140, 140, 160, 0.08) 100%
        )
      `,
      border: "1px solid var(--pipe-border)",
    },
    mercury: {
      background: `
        linear-gradient(160deg,
          rgba(200, 210, 230, 0.12) 0%,
          rgba(180, 190, 220, 0.06) 30%,
          rgba(220, 225, 240, 0.15) 50%,
          rgba(170, 180, 210, 0.08) 70%,
          rgba(190, 200, 225, 0.1) 100%
        )
      `,
      border: "1px solid var(--pipe-border)",
    },
    dark: {
      background: `
        linear-gradient(135deg,
          rgba(40, 40, 50, 0.6) 0%,
          rgba(60, 60, 80, 0.5) 50%,
          rgba(30, 30, 40, 0.7) 100%
        )
      `,
      border: "1px solid var(--pipe-border)",
    },
  };

  const v = variants[variant];

  return (
    <div
      className={className}
      data-testid={dataTestId}
      onMouseEnter={() => hover && setIsHovered(true)}
      onMouseLeave={() => hover && setIsHovered(false)}
      onClick={onClick}
      style={{
        background: v.background,
        backdropFilter: "blur(40px) saturate(150%)",
        WebkitBackdropFilter: "blur(40px) saturate(150%)",
        border: v.border,
        position: "relative",
        overflow: "hidden",
        transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        transform: isHovered ? "translateY(-2px)" : "none",
        boxShadow: isHovered
          ? "0 8px 24px var(--pipe-shadow)"
          : "none",
        ...style,
      }}
    >
      {/* Chrome reflection sweep */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: isHovered ? "100%" : "-100%",
          width: "50%",
          height: "100%",
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)",
          transition: "left 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
          pointerEvents: "none",
        }}
      />

      {children}
    </div>
  );
}

export default LiquidMetalCard;
