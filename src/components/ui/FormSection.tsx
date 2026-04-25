import { type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { LiquidMetalCard } from "./LiquidMetalCard";

interface FormSectionProps {
  icon: LucideIcon;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  isComplete?: boolean;
  children: ReactNode;
}

/**
 * FormSection - Collapsible form section with icon and completion indicator
 *
 * Features:
 * - Icon display in header
 * - Collapsible content
 * - Completion indicator (green dot)
 * - Smooth expand/collapse animation
 */
export function FormSection({
  icon: Icon,
  title,
  isOpen,
  onToggle,
  isComplete = false,
  children,
}: FormSectionProps): JSX.Element {
  return (
    <LiquidMetalCard variant="chrome" style={{ marginBottom: 8 }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          padding: 20,
          background: "transparent",
          border: "none",
          display: "flex",
          alignItems: "center",
          gap: 16,
          cursor: "pointer",
          fontFamily: '"Space Mono", monospace',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            background: "var(--pipe-surface)",
            border: "1px solid var(--pipe-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--pipe-text-dim)",
          }}
        >
          <Icon size={16} />
        </div>
        <span
          style={{
            flex: 1,
            textAlign: "left",
            fontSize: 10,
            letterSpacing: "0.15em",
            color: isOpen ? "var(--pipe-text, #fff)" : "var(--pipe-text-muted)",
          }}
        >
          {title}
        </span>
        {isComplete && (
          <div
            style={{
              width: 8,
              height: 8,
              background: "rgba(150,255,150,0.8)",
              boxShadow: "0 0 8px rgba(150,255,150,0.5)",
            }}
          />
        )}
        <div
          style={{
            color: "var(--pipe-text-dim)",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <ChevronDown size={14} />
        </div>
      </button>
      {isOpen && <div style={{ padding: "0 20px 24px 72px" }}>{children}</div>}
    </LiquidMetalCard>
  );
}
