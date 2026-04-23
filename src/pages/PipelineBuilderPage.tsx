import { useState } from "react";
import {
  Phone,
  Code,
  FileText,
  Users,
  CheckCircle,
  MessageSquare,
  Send,
  PhoneCall,
  Video,
  MonitorPlay,
  Calendar,
  Mail,
  Clock,
  CheckCircle2,
} from "lucide-react";
import {
  Layout,
  ProfileHeader,
  LiquidMetalCard,
  SidebarNav,
  SubTitle,
} from "../components";
import {
  SCREENING_QUESTIONS,
  SCREENING_CATEGORIES,
  type ScreeningCategory,
} from "../content/screeningQuestions";

/**
 * PipelineBuilderPage - Configure assessment pipeline with AI assistance
 *
 * Features:
 * - Stage selection and configuration
 * - AI agent assistance for rubric generation
 * - Preview and save pipeline
 * - Stage-specific configuration panels
 */

// Stage types
type StageType =
  | "SCREENING"
  | "CULTURAL"
  | "CODE_REVIEW"
  | "OPEN_SOURCE"
  | "LIVE_PANEL";

interface StageConfig {
  id: StageType;
  title: string;
  icon: typeof Phone;
  configured: boolean;
  order: number;
}

// Mock stage configurations
const initialStages: StageConfig[] = [
  {
    id: "SCREENING",
    title: "Screening",
    icon: Phone,
    configured: true,
    order: 1,
  },
  {
    id: "CULTURAL",
    title: "Cultural Fit",
    icon: Users,
    configured: false,
    order: 2,
  },
  {
    id: "CODE_REVIEW",
    title: "Code Review",
    icon: Code,
    configured: false,
    order: 3,
  },
  {
    id: "OPEN_SOURCE",
    title: "Open Source",
    icon: FileText,
    configured: false,
    order: 4,
  },
  {
    id: "LIVE_PANEL",
    title: "Live Panel",
    icon: Users,
    configured: false,
    order: 5,
  },
];

// Stage card component
function StageCard({
  stage,
  isSelected,
  onClick,
}: {
  stage: StageConfig;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = stage.icon;

  return (
    <LiquidMetalCard
      variant={isSelected ? "chrome" : "default"}
      hover
      onClick={onClick}
      style={{
        padding: 20,
        cursor: "pointer",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Icon size={18} color={isSelected ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)"} />
        {stage.configured && (
          <CheckCircle size={14} color="rgba(150,255,150,0.8)" />
        )}
      </div>

      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: isSelected ? "var(--pipe-text, #fff)" : "var(--pipe-text-muted)",
          marginBottom: 8,
        }}
      >
        {stage.title.toUpperCase()}
      </div>

      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: stage.configured ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
        }}
      >
        {stage.configured ? "✓" : stage.order}
      </div>
    </LiquidMetalCard>
  );
}

// Helper card components
function RubricCard({ title, points }: { title: string; points: string[] }) {
  return (
    <LiquidMetalCard variant="dark" style={{ padding: 20, marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: "var(--pipe-text-dim)",
          marginBottom: 12,
        }}
      >
        {title.toUpperCase()}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {points.map((point, i) => (
          <li
            key={i}
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              color: "var(--pipe-text-muted)",
              marginBottom: 8,
              paddingLeft: 16,
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                color: "var(--pipe-text-dim)",
              }}
            >
              •
            </span>
            {point}
          </li>
        ))}
      </ul>
    </LiquidMetalCard>
  );
}

function TimeCard({ duration, label }: { duration: string; label: string }) {
  return (
    <LiquidMetalCard variant="dark" style={{ padding: 20 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: "var(--pipe-text-dim)",
          marginBottom: 8,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 800,
          background:
            "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {duration}
      </div>
    </LiquidMetalCard>
  );
}

// Screening format type for the overview display
type ScreeningFormatDisplay = 'PHONE_CALL' | 'VIDEO_CALL' | 'ONLINE';

const FORMAT_INFO: Record<ScreeningFormatDisplay, { label: string; description: string; Icon: typeof Phone; color: string }> = {
  PHONE_CALL: {
    label: 'Phone Call',
    description: 'Recruiter calls the candidate through the app. Recorded and transcribed automatically.',
    Icon: PhoneCall,
    color: '#60a5fa',
  },
  VIDEO_CALL: {
    label: 'Video Call',
    description: 'Live video screening meeting in the browser.',
    Icon: Video,
    color: 'var(--pipe-accent)',
  },
  ONLINE: {
    label: 'Online Questions',
    description: 'Candidate answers screening questions asynchronously.',
    Icon: MonitorPlay,
    color: '#4ade80',
  },
};

// Stage configuration panels
function ScreeningStageConfig() {
  const [selectedFormat, setSelectedFormat] = useState<ScreeningFormatDisplay | null>(null);

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>SCREENING_STAGE</SubTitle>
      </div>

      {/* Format selector cards */}
      {!selectedFormat ? (
        <div>
          <div style={{
            fontSize: 9,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 16,
          }}>
            SELECT FORMAT
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {(Object.entries(FORMAT_INFO) as [ScreeningFormatDisplay, typeof FORMAT_INFO[ScreeningFormatDisplay]][]).map(([key, info]) => {
              const Icon = info.Icon;
              return (
                <LiquidMetalCard
                  key={key}
                  hover
                  onClick={() => setSelectedFormat(key)}
                  style={{ padding: 24, cursor: 'pointer', textAlign: 'center' }}
                >
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: `${info.color}15`,
                    border: `1px solid ${info.color}30`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px',
                  }}>
                    <Icon size={20} color={info.color} />
                  </div>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    color: 'var(--pipe-text, #fff)',
                    marginBottom: 8,
                  }}>
                    {info.label.toUpperCase()}
                  </div>
                  <div style={{
                    fontSize: 10,
                    lineHeight: 1.6,
                    color: 'var(--pipe-text-muted)',
                  }}>
                    {info.description}
                  </div>
                </LiquidMetalCard>
              );
            })}
          </div>
        </div>
      ) : selectedFormat === 'ONLINE' ? (
        <ScreeningOnlineConfig onBack={() => setSelectedFormat(null)} />
      ) : (
        <ScreeningCallOverview format={selectedFormat} onBack={() => setSelectedFormat(null)} />
      )}
    </div>
  );
}

/** Online screening — shows question templates by category */
function ScreeningOnlineConfig({ onBack }: { onBack: () => void }) {
  const categories = Object.entries(SCREENING_CATEGORIES) as [ScreeningCategory, { label: string; description: string }][];

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 24,
          padding: 0,
          background: 'none',
          border: 'none',
          color: 'var(--pipe-text-dim)',
          cursor: 'pointer',
          fontSize: 9,
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.1em',
        }}
      >
        ONLINE QUESTIONS
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
        <div>
          {categories.map(([catKey, catInfo]) => {
            const catQuestions = SCREENING_QUESTIONS.filter((q) => q.category === catKey);
            if (catQuestions.length === 0) return null;
            return (
              <div key={catKey} style={{ marginBottom: 28 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  marginBottom: 12,
                }}>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.15em',
                    color: 'var(--pipe-text-dim)',
                  }}>
                    {catInfo.label.toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: 'var(--pipe-text-dim)',
                    opacity: 0.5,
                  }}>
                    {catInfo.description}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {catQuestions.map((q) => (
                    <LiquidMetalCard key={q.id} variant="dark" style={{ padding: 16 }}>
                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--pipe-text, #fff)',
                        lineHeight: 1.5,
                        marginBottom: 6,
                      }}>
                        {q.text}
                      </div>
                      <div style={{
                        fontSize: 9,
                        color: 'var(--pipe-text-dim)',
                        lineHeight: 1.5,
                      }}>
                        {q.purpose}
                      </div>
                      {q.followUps && q.followUps.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {q.followUps.map((fu, i) => (
                            <div key={i} style={{
                              fontSize: 9,
                              color: 'var(--pipe-text-dim)',
                              opacity: 0.6,
                              paddingLeft: 12,
                              position: 'relative',
                              lineHeight: 1.6,
                            }}>
                              <span style={{ position: 'absolute', left: 0 }}>+</span>
                              {fu}
                            </div>
                          ))}
                        </div>
                      )}
                    </LiquidMetalCard>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TimeCard duration="15m" label="Est. Duration" />
          <LiquidMetalCard variant="dark" style={{ padding: 20 }}>
            <div style={{
              fontSize: 9,
              letterSpacing: '0.15em',
              color: 'var(--pipe-text-dim)',
              marginBottom: 8,
            }}>
              CANDIDATE JOURNEY
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'Receives email with screening link',
                'Answers questions at their own pace',
                'Recruiter reviews responses',
                'Advances to technical challenge',
              ].map((step, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 9,
                  color: 'var(--pipe-text-muted)',
                  lineHeight: 1.5,
                }}>
                  <div style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: 'rgba(74,222,128,0.08)',
                    border: '1px solid rgba(74,222,128,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 7,
                    color: '#4ade80',
                    fontWeight: 700,
                  }}>
                    {i + 1}
                  </div>
                  {step}
                </div>
              ))}
            </div>
          </LiquidMetalCard>
        </div>
      </div>
    </div>
  );
}

/** Phone/Video screening overview — shows the call flow and config */
function ScreeningCallOverview({ format, onBack }: { format: 'PHONE_CALL' | 'VIDEO_CALL'; onBack: () => void }) {
  const info = FORMAT_INFO[format];
  const Icon = info.Icon;
  const isPhone = format === 'PHONE_CALL';

  const flowSteps = isPhone ? [
    { icon: Mail, label: 'INVITE', text: 'Send invitation email to candidate' },
    { icon: Calendar, label: 'SCHEDULE', text: 'Candidate books a time slot' },
    { icon: PhoneCall, label: 'CALL', text: 'Call through the app — recorded and transcribed' },
    { icon: Clock, label: 'REVIEW', text: 'Review transcript, recording, and notes' },
    { icon: CheckCircle2, label: 'DECIDE', text: 'Advance to next stage or reject' },
  ] : [
    { icon: Mail, label: 'INVITE', text: 'Send invitation email to candidate' },
    { icon: Calendar, label: 'SCHEDULE', text: 'Candidate books a time slot' },
    { icon: Video, label: 'MEET', text: 'Live video meeting in browser' },
    { icon: CheckCircle2, label: 'DECIDE', text: 'Advance to next stage or reject' },
  ];

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 24,
          padding: 0,
          background: 'none',
          border: 'none',
          color: 'var(--pipe-text-dim)',
          cursor: 'pointer',
          fontSize: 9,
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.1em',
        }}
      >
        {info.label.toUpperCase()}
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
        <div>
          {/* Format header */}
          <LiquidMetalCard style={{
            padding: 24,
            marginBottom: 24,
            background: `linear-gradient(135deg, ${info.color}08 0%, transparent 60%)`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: `${info.color}15`,
                border: `1px solid ${info.color}30`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Icon size={18} color={info.color} />
              </div>
              <div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--pipe-text, #fff)',
                  letterSpacing: '0.05em',
                }}>
                  {info.label}
                </div>
                <div style={{
                  fontSize: 9,
                  color: 'var(--pipe-text-dim)',
                  marginTop: 2,
                }}>
                  {info.description}
                </div>
              </div>
            </div>
          </LiquidMetalCard>

          {/* Flow steps */}
          <div style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 12,
          }}>
            {isPhone ? 'CALL_FLOW' : 'MEETING_FLOW'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {flowSteps.map((step, i) => {
              const StepIcon = step.icon;
              return (
                <LiquidMetalCard key={i} variant="dark" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: `${info.color}10`,
                      border: `1px solid ${info.color}20`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <StepIcon size={12} color={info.color} />
                    </div>
                    <div>
                      <div style={{
                        fontSize: 8,
                        fontWeight: 700,
                        letterSpacing: '0.12em',
                        color: info.color,
                        marginBottom: 2,
                      }}>
                        {step.label}
                      </div>
                      <div style={{
                        fontSize: 10,
                        color: 'var(--pipe-text-muted)',
                        lineHeight: 1.5,
                      }}>
                        {step.text}
                      </div>
                    </div>
                  </div>
                </LiquidMetalCard>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TimeCard duration={isPhone ? '20m' : '30m'} label="Typical Duration" />
          {isPhone && (
            <LiquidMetalCard variant="dark" style={{ padding: 20 }}>
              <div style={{
                fontSize: 9,
                letterSpacing: '0.15em',
                color: 'var(--pipe-text-dim)',
                marginBottom: 12,
              }}>
                AFTER THE CALL
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  'Voice transcript available immediately',
                  'Recording stored securely',
                  'Recruiter adds notes',
                  'Manual pass/fail decision',
                ].map((item, i) => (
                  <li key={i} style={{
                    fontSize: 10,
                    lineHeight: 1.8,
                    color: 'var(--pipe-text-muted)',
                    paddingLeft: 12,
                    position: 'relative',
                  }}>
                    <span style={{ position: 'absolute', left: 0, color: 'var(--pipe-text-dim)' }}>·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </LiquidMetalCard>
          )}
        </div>
      </div>
    </div>
  );
}

function AICollabStageConfig() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>CULTURAL_STAGE</SubTitle>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}
      >
        <div>
          <RubricCard
            title="AI Tool Usage"
            points={[
              "Strategic use of AI for well-defined subtasks",
              "Asking clarifying questions before using AI",
              "Critical review of AI-generated code",
              "Debugging AI solutions effectively",
            ]}
          />
          <RubricCard
            title="Code Quality"
            points={[
              "Type safety and error handling",
              "Clean, maintainable code structure",
              "Appropriate use of modern patterns",
              "Testing and validation",
            ]}
          />
        </div>

        <div>
          <TimeCard duration="60m" label="Duration" />
        </div>
      </div>
    </div>
  );
}

function CodeReviewStageConfig() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>CODE_REVIEW_EXERCISE</SubTitle>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}
      >
        <div>
          <RubricCard
            title="Review Criteria"
            points={[
              "Identifying security vulnerabilities",
              "Performance bottlenecks and optimizations",
              "Code maintainability and readability",
              "Test coverage and quality",
              "Architectural patterns and best practices",
            ]}
          />
          <RubricCard
            title="Communication"
            points={[
              "Clear, constructive feedback",
              "Priority and severity assessment",
              "Suggested improvements with examples",
            ]}
          />
        </div>

        <div>
          <TimeCard duration="45m" label="Duration" />
        </div>
      </div>
    </div>
  );
}

function PlanningStageConfig() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>OPEN_SOURCE_STAGE</SubTitle>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}
      >
        <div>
          <RubricCard
            title="Architecture"
            points={[
              "Component hierarchy and data flow",
              "State management strategy",
              "API design and integration",
              "Scalability considerations",
              "Error handling and edge cases",
            ]}
          />
          <RubricCard
            title="Planning Process"
            points={[
              "Breaking down complex problems",
              "Identifying dependencies",
              "Technical trade-off analysis",
              "Implementation timeline estimation",
            ]}
          />
        </div>

        <div>
          <TimeCard duration="60m" label="Duration" />
        </div>
      </div>
    </div>
  );
}

export default function PipelineBuilderPage(): JSX.Element {
  const [activeSection] = useState("pipeline");
  const isAgentOpen = false;
  const [selectedStage, setSelectedStage] = useState<StageType>("SCREENING");
  const [stages] = useState<StageConfig[]>(initialStages);
  const [chatMessage, setChatMessage] = useState("");

  const configuredCount = stages.filter((s) => s.configured).length;

  const renderStageConfig = () => {
    switch (selectedStage) {
      case "SCREENING":
        return <ScreeningStageConfig />;
      case "CULTURAL":
        return <AICollabStageConfig />;
      case "CODE_REVIEW":
        return <CodeReviewStageConfig />;
      case "OPEN_SOURCE":
        return <PlanningStageConfig />;
      default:
        return null;
    }
  };

  return (
    <Layout
      header={
        <ProfileHeader
          title="PIPELINE_BUILDER"
        />
      }
      sidebar={
        <SidebarNav
          activeSection={activeSection}
          onRolesClick={() => {
            window.location.href = "/";
          }}
        />
      }
      isAgentOpen={isAgentOpen}
      agentPanel={
        <div
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              color: "rgba(255, 255, 255, 0.45)",
              marginBottom: 8,
            }}
          >
            AI AGENT
          </div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--pipe-text, #fff)",
              margin: "0 0 24px 0",
            }}
          >
            Pipeline Assistant
          </h2>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              marginBottom: 20,
            }}
          >
            <LiquidMetalCard
              variant="dark"
              style={{ padding: 16, marginBottom: 12 }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.05em",
                  color: "var(--pipe-text-dim)",
                  marginBottom: 8,
                }}
              >
                AGENT
              </div>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--pipe-text-muted)",
                  margin: 0,
                }}
              >
                I can help you design rubrics, suggest assessment criteria, and
                refine your pipeline stages. What would you like to configure?
              </p>
            </LiquidMetalCard>
          </div>

          <div style={{ marginTop: "auto" }}>
            <div
              style={{
                display: "flex",
                gap: 8,
                padding: "12px 16px",
                background: "var(--pipe-surface)",
                border: "1px solid var(--pipe-border)",
              }}
            >
              <MessageSquare size={16} color="var(--pipe-text-dim)" />
              <input
                type="text"
                placeholder="Ask about rubrics, criteria..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--pipe-text, #fff)",
                  fontSize: 12,
                  fontFamily: '"Space Mono", monospace',
                }}
              />
              <button
                onClick={() => {
                  console.log("Send message:", chatMessage);
                  setChatMessage("");
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <Send size={16} color="var(--pipe-text-dim)" />
              </button>
            </div>
          </div>
        </div>
      }
    >
      {/* Position Info Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 32,
          paddingBottom: 20,
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.2em",
                color: "var(--pipe-text-dim)",
                marginBottom: 6,
              }}
            >
              POSITION
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--pipe-text, #fff)",
                letterSpacing: "0.05em",
              }}
            >
              SR. SOFTWARE ENGINEER
            </div>
          </div>

          <div
            style={{
              width: 1,
              height: 40,
              background: "var(--pipe-surface-hover)",
            }}
          />

          <div>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.2em",
                color: "var(--pipe-text-dim)",
                marginBottom: 6,
              }}
            >
              STAGES CONFIGURED
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                background:
                  "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {configuredCount}/{stages.length}
            </div>
          </div>
        </div>

        <SubTitle>CONFIGURE_STAGES</SubTitle>
      </div>

      {/* Stage Cards Grid */}
      <section style={{ marginBottom: 60 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
            marginBottom: 40,
          }}
        >
          {stages.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              isSelected={selectedStage === stage.id}
              onClick={() => setSelectedStage(stage.id)}
            />
          ))}
        </div>
      </section>

      {/* Stage Configuration */}
      <section>{renderStageConfig()}</section>
    </Layout>
  );
}
