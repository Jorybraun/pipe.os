import { useState, useRef, useEffect } from "react";
import { Brain, FileText, Send } from "lucide-react";
import LiquidMetalCard from "../LiquidMetalCard";
import { SubTitle } from "../ui/SubTitle";
import type {
  RoleBaseline,
  RoleDynamicContext,
  AgentMessage,
} from "../../types/roleDiscovery";

interface AgentPanelProps {
  baseline: RoleBaseline | null;
  context: RoleDynamicContext;
  progress: number;
  gaps: string[];
}

/**
 * AgentPanel - Interactive panel for role discovery with agent chat and context display
 *
 * Features:
 * - Two-tab interface: AGENT (chat) and CONTEXT (role model view)
 * - Real-time progress tracking and gap indicators
 * - Mock chat interface (Phase 1A - to be replaced with LLM in Phase 1B)
 * - Static mockup with no backend data (Phase 1A)
 *
 * Phase 1A (Current): Static UI with mock agent responses, progress display
 * Phase 1B (Future): Will use baseline/context props to display actual role data from LLM
 *
 * @param baseline - Role baseline data (not used in Phase 1A)
 * @param context - Dynamic context from agent (not used in Phase 1A)
 * @param progress - Completion percentage (0-100)
 * @param gaps - Array of missing section descriptions
 *
 * @example
 * ```tsx
 * <AgentPanel
 *   baseline={null}
 *   context={{}}
 *   progress={75}
 *   gaps={['Team context incomplete']}
 * />
 * ```
 */
export function AgentPanel({
  baseline: _baseline, // TODO Phase 1B: Use to display actual role baseline data
  context: _context, // TODO Phase 1B: Use to display dynamic context from agent
  progress,
  gaps,
}: AgentPanelProps): JSX.Element {
  const [tab, setTab] = useState<"AGENT" | "CONTEXT">("AGENT");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (): void => {
    if (!input.trim()) return;

    const userMessage: AgentMessage = {
      from: "user",
      text: input.trim(),
      timestamp: new Date(),
    };

    setMessages((m) => [...m, userMessage]);
    setInput("");

    // Phase 1A: Mock agent responses
    // TODO Phase 1B: Replace with LLM API call
    setTimeout(() => {
      const query = input.toLowerCase();
      let response = "Ask me about the interview design process.";

      if (query.includes("why")) {
        response =
          "Each field shapes the interview. Title sets difficulty, stack targets questions.";
      } else if (query.includes("skip")) {
        response =
          "60% completeness unlocks Phase 2. More context = better results.";
      } else if (query.includes("next")) {
        response = "Next, we select interview stages based on this role model.";
      }

      const agentMessage: AgentMessage = {
        from: "agent",
        text: response,
        timestamp: new Date(),
      };

      setMessages((m) => [...m, agentMessage]);
    }, 350);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  const completedSections = Math.round(progress / 16.67);

  const tabs = [
    { id: "AGENT" as const, icon: Brain, label: "AGENT" },
    { id: "CONTEXT" as const, icon: FileText, label: "CONTEXT" },
  ];

  return (
    <div style={{ maxWidth: "380px" }}>
      {/* Section Title */}
      <div style={{ marginBottom: 24 }}>
        <SubTitle>AGENT_PANEL</SubTitle>
      </div>

      {/* Main content card with dark variant - matches QuestionDetail */}
      <LiquidMetalCard variant="chrome">
        {/* Top Status Bar - Meta information matching QuestionDetail */}
        <div
          style={{
            padding: 24,
            borderBottom: "1px solid var(--pipe-border)",
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <LiquidMetalCard variant="mercury">
            <span
              style={{
                padding: "6px 12px",
                fontSize: 8,
                fontWeight: 600,
                letterSpacing: "0.15em",
                border: "1px solid rgba(139, 92, 246, 0.3)",
              }}
            >
              PHASE 1
            </span>
          </LiquidMetalCard>
          <span
            style={{
              fontSize: 9,
              color: "var(--pipe-text-dim)",
              letterSpacing: "0.1em",
            }}
          >
            {completedSections}/6 SECTIONS
          </span>
          <span
            style={{
              fontSize: 9,
              color: progress >= 60 ? "#86efac" : "#fcd34d",
              letterSpacing: "0.1em",
            }}
          >
            {progress >= 60 ? "READY" : "IN PROGRESS"}
          </span>

          {/* Divider */}
          <div
            style={{ flex: 1, height: 1, background: "var(--pipe-surface)" }}
          />

          {/* Gaps indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 8,
                height: 8,
                background: gaps.length === 0 ? "#86efac" : "#fcd34d",
                boxShadow:
                  gaps.length === 0 ? "0 0 6px rgba(150,255,150,0.5)" : "none",
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: "var(--pipe-text-dim)",
                letterSpacing: "0.1em",
              }}
            >
              {gaps.length} GAPS
            </span>
          </div>
        </div>

        {/* Tab Navigation - matching QuestionDetail TabNav */}
        <div style={{ padding: "0 24px" }}>
          <div
            style={{
              display: "inline-flex",
              borderBottom: "1px solid var(--pipe-border)",
            }}
          >
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: "16px 28px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      tab === t.id
                        ? "2px solid var(--pipe-text)"
                        : "2px solid transparent",
                    color:
                      tab === t.id
                        ? "var(--pipe-text)"
                        : "var(--pipe-text-dim)",
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    cursor: "pointer",
                    fontFamily: '"Space Mono", monospace',
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    transition: "all 0.2s ease",
                  }}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div style={{ padding: 24 }}>
          {tab === "AGENT" && (
            <>
              {/* Section Label */}
              <div
                ref={chatRef}
                style={{
                  maxHeight: 160,
                  overflowY: "auto",
                  marginBottom: messages.length > 0 ? 18 : 0,
                }}
              >
                {messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 12,
                      marginBottom: 10,
                      background:
                        m.from === "user"
                          ? "var(--pipe-surface)"
                          : "rgba(139, 92, 246, 0.08)",
                      border: `1px solid ${
                        m.from === "user"
                          ? "var(--pipe-surface)"
                          : "rgba(139, 92, 246, 0.15)"
                      }`,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--pipe-text-muted)",
                        lineHeight: 1.6,
                        margin: 0,
                      }}
                    >
                      {m.text}
                    </p>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything..."
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid var(--pipe-border)",
                    color: "var(--pipe-text)",
                    fontSize: 11,
                    fontFamily: '"Space Mono", monospace',
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleSend}
                  style={{
                    padding: "12px 14px",
                    background: "rgba(139, 92, 246, 0.15)",
                    border: "1px solid rgba(139, 92, 246, 0.25)",
                    color: "var(--pipe-text)",
                    cursor: "pointer",
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
            </>
          )}

          {tab === "CONTEXT" && (
            <>
              {/* Section Label */}
              {/* Main Status Card - mercury variant */}

              {/* Stats Row - mercury variant */}
              <div style={{ display: "flex", gap: 14, marginBottom: 20 }}>
                <LiquidMetalCard
                  variant="mercury"
                  style={{ flex: 1, padding: 20 }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: "0.1em",
                      color: "var(--pipe-text-dim)",
                      marginBottom: 12,
                    }}
                  >
                    COMPLETENESS
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 6 }}
                  >
                    <span
                      style={{
                        fontSize: 32,
                        fontWeight: 300,
                        color: "var(--pipe-text)",
                      }}
                    >
                      {progress}
                    </span>
                    <span
                      style={{ fontSize: 13, color: "var(--pipe-text-dim)" }}
                    >
                      %
                    </span>
                  </div>
                </LiquidMetalCard>

                <LiquidMetalCard
                  variant="mercury"
                  style={{ flex: 1, padding: 20 }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: "0.1em",
                      color: "var(--pipe-text-dim)",
                      marginBottom: 12,
                    }}
                  >
                    SECTIONS
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 6 }}
                  >
                    <span
                      style={{
                        fontSize: 32,
                        fontWeight: 300,
                        color: "var(--pipe-text)",
                      }}
                    >
                      {completedSections}
                    </span>
                    <span
                      style={{ fontSize: 13, color: "var(--pipe-text-dim)" }}
                    >
                      /6
                    </span>
                  </div>
                </LiquidMetalCard>
              </div>

              {/* Bottom Row - mercury variant */}
              <div style={{ display: "flex", gap: 14, marginBottom: 28 }}>
                <LiquidMetalCard
                  variant="mercury"
                  style={{ flex: 1, padding: 20 }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: "0.1em",
                      color: "var(--pipe-text-dim)",
                      marginBottom: 12,
                    }}
                  >
                    GAPS
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        background: gaps.length === 0 ? "#86efac" : "#fcd34d",
                      }}
                    />
                    <span
                      style={{ fontSize: 12, color: "var(--pipe-text-muted)" }}
                    >
                      {gaps.length === 0
                        ? "All complete"
                        : `${gaps.length} missing`}
                    </span>
                  </div>
                </LiquidMetalCard>

                <LiquidMetalCard
                  variant="mercury"
                  style={{ flex: 1, padding: 20 }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: "0.1em",
                      color: "var(--pipe-text-dim)",
                      marginBottom: 12,
                    }}
                  >
                    STATUS
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        background: progress >= 60 ? "#86efac" : "#a78bfa",
                      }}
                    />
                    <span
                      style={{ fontSize: 12, color: "var(--pipe-text-muted)" }}
                    >
                      {progress >= 60 ? "Ready" : "Gathering"}
                    </span>
                  </div>
                </LiquidMetalCard>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    width: 5,
                    height: 5,
                    background: "var(--pipe-border)",
                  }}
                />
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    color: "var(--pipe-text-dim)",
                  }}
                >
                  ROLE_MODEL
                </span>
              </div>

              <LiquidMetalCard
                variant="mercury"
                style={{ padding: 24, marginBottom: 20 }}
              >
                <div
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.1em",
                    color: "var(--pipe-text-dim)",
                    marginBottom: 14,
                  }}
                >
                  BASELINE
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--pipe-text-muted)",
                    margin: 0,
                    lineHeight: 1.7,
                  }}
                >
                  Complete the baseline sections to build the role model. This
                  will show the accumulated context from your inputs.
                </p>
              </LiquidMetalCard>

              {/* Gaps */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    width: 5,
                    height: 5,
                    background: "var(--pipe-border)",
                  }}
                />
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    color: "var(--pipe-text-dim)",
                  }}
                >
                  MISSING_SECTIONS
                </span>
              </div>

              {gaps.map((g, i) => (
                <LiquidMetalCard
                  key={i}
                  variant="mercury"
                  style={{ padding: 16, marginBottom: 10 }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <div
                      style={{ width: 5, height: 5, background: "#fcd34d" }}
                    />
                    <span
                      style={{ fontSize: 11, color: "var(--pipe-text-muted)" }}
                    >
                      {g}
                    </span>
                  </div>
                </LiquidMetalCard>
              ))}
            </>
          )}
        </div>

        {/* Bottom accent line - matching QuestionDetail */}
        <div
          style={{
            height: 2,
            background:
              progress >= 60
                ? "linear-gradient(90deg, rgba(134,239,172,0.3), rgba(134,239,172,0.6), rgba(134,239,172,0.3))"
                : "linear-gradient(90deg, rgba(252,211,77,0.2), rgba(252,211,77,0.4), rgba(252,211,77,0.2))",
          }}
        />
      </LiquidMetalCard>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input::placeholder { color: var(--pipe-text-dim); }
        input:focus { border-color: rgba(139, 92, 246, 0.3) !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--pipe-border); }
      `}</style>
    </div>
  );
}

export default AgentPanel;
