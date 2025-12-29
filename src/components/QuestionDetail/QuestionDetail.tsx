import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  FileQuestion,
  Video,
  ClipboardList,
  Settings,
  BarChart3,
  ArrowLeft,
} from "lucide-react";
import { getQuestionById } from "../../mocks/questions";
import { TabNav, type Tab } from "../ui/TabNav";
import { QuestionTab } from "./tabs/QuestionTab";
import { VideoTab } from "./tabs/VideoTab";
import { RubricTab } from "./tabs/RubricTab";
import { SettingsTab } from "./tabs/SettingsTab";
import LiquidMetalCard from "../LiquidMetalCard";
import { SubTitle } from "../ui/SubTitle";

/**
 * Tab identifier type.
 */
type TabId = "question" | "video" | "rubric" | "settings";

/**
 * Main QuestionDetail container component.
 *
 * Fetches question data from mock based on route params and manages
 * tab navigation state. Displays the appropriate tab content based on
 * the active tab.
 */
export function QuestionDetail(): JSX.Element {
  const { questionId } = useParams<{ questionId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("question");

  // Find question from mock data
  const question = questionId ? getQuestionById(questionId) : undefined;

  // Define tabs
  const tabs: Tab[] = [
    { id: "question", label: "QUESTION", icon: <FileQuestion size={14} /> },
    { id: "video", label: "VIDEO", icon: <Video size={14} /> },
    { id: "rubric", label: "RUBRIC", icon: <ClipboardList size={14} /> },
    { id: "settings", label: "SETTINGS", icon: <Settings size={14} /> },
  ];

  // Type colors matching QuestionCard
  const typeColors = {
    technical: {
      bg: "rgba(100, 180, 255, 0.15)",
      color: "rgba(100, 180, 255, 0.9)",
      border: "rgba(100, 180, 255, 0.3)",
    },
    behavioral: {
      bg: "rgba(255, 180, 100, 0.15)",
      color: "rgba(255, 180, 100, 0.9)",
      border: "rgba(255, 180, 100, 0.3)",
    },
    motivation: {
      bg: "rgba(180, 100, 255, 0.15)",
      color: "rgba(180, 100, 255, 0.9)",
      border: "rgba(180, 100, 255, 0.3)",
    },
    situational: {
      bg: "rgba(100, 255, 180, 0.15)",
      color: "rgba(100, 255, 180, 0.9)",
      border: "rgba(100, 255, 180, 0.3)",
    },
  };

  // Handle question not found
  if (!question) {
    return (
      <div>
        <div style={{ textAlign: "center", padding: "64px 0" }}>
          <div
            style={{
              fontSize: 48,
              color: "rgba(255,80,80,0.8)",
              marginBottom: 16,
            }}
          >
            404
          </div>
          <div style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>
            Question not found
          </div>
        </div>
      </div>
    );
  }

  const typeStyle = typeColors[question.type] || typeColors.technical;

  return (
    <div
      style={{
        opacity: 1,
        transition: "opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s",
      }}
    >
      {/* Section title with back button */}
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back to questions list"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.6)",
            padding: "8px 12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 9,
            letterSpacing: "0.1em",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
            e.currentTarget.style.color = "rgba(255,255,255,0.8)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "rgba(255,255,255,0.6)";
          }}
        >
          <ArrowLeft size={12} />
          BACK
        </button>
        <SubTitle>QUESTION_DETAIL</SubTitle>
      </div>

      {/* Main content card with dark variant */}
      <LiquidMetalCard variant="chrome">
        {/* Meta information bar (from QuestionCard) */}
        <div
          style={{
            padding: 24,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            {/* Type badge */}
            <span
              style={{
                fontSize: 8,
                letterSpacing: "0.15em",
                padding: "4px 10px",
                background: typeStyle.bg,
                color: typeStyle.color,
                border: `1px solid ${typeStyle.border}`,
                textTransform: "uppercase",
              }}
            >
              {question.type}
            </span>

            {/* Time limit */}
            <span
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                color: "rgba(255,255,255,0.4)",
              }}
            >
              {question.timeLimit} MIN
            </span>

            {/* Required indicator */}
            {question.isRequired && (
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: "0.1em",
                  color: "rgba(255,100,100,0.7)",
                }}
              >
                REQUIRED
              </span>
            )}

            {/* Divider */}
            <div
              style={{
                flex: 1,
                height: 1,
                background: "rgba(255,255,255,0.06)",
              }}
            />

            {/* Video status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {question.hasVideo ? (
                <>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      background: "rgba(150,255,150,0.8)",
                      boxShadow: "0 0 6px rgba(150,255,150,0.5)",
                    }}
                  />
                  <Video size={12} color="rgba(150,255,150,0.8)" />
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      color: "rgba(150,255,150,0.8)",
                    }}
                  >
                    {Math.floor((question.videoDuration ?? 0) / 60)}:
                    {((question.videoDuration ?? 0) % 60)
                      .toString()
                      .padStart(2, "0")}
                  </span>
                </>
              ) : (
                <>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      background: "rgba(255,200,100,0.6)",
                    }}
                  />
                  <Video size={12} color="rgba(255,200,100,0.6)" />
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      color: "rgba(255,200,100,0.6)",
                    }}
                  >
                    NO VIDEO
                  </span>
                </>
              )}
            </div>

            {/* Rubric criteria count */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BarChart3 size={12} color="rgba(255,255,255,0.4)" />
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color: "rgba(255,255,255,0.4)",
                }}
              >
                {question.rubric.length} CRITERIA
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ padding: "0 24px" }}>
          <TabNav
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as TabId)}
          />
        </div>

        {/* Tab Content */}
        <div
          role="tabpanel"
          aria-labelledby={`${activeTab}-tab`}
          id={`${activeTab}-panel`}
          style={{ padding: 24 }}
        >
          {activeTab === "question" && <QuestionTab question={question} />}
          {activeTab === "video" && <VideoTab question={question} />}
          {activeTab === "rubric" && <RubricTab rubric={question.rubric} />}
          {activeTab === "settings" && (
            <SettingsTab settings={question.settings} />
          )}
        </div>

        {/* Bottom accent line (matching QuestionCard) */}
        <div
          style={{
            height: 2,
            background: question.hasVideo
              ? "linear-gradient(90deg, rgba(150,255,150,0.3), rgba(150,255,150,0.6), rgba(150,255,150,0.3))"
              : "linear-gradient(90deg, rgba(255,200,100,0.2), rgba(255,200,100,0.4), rgba(255,200,100,0.2))",
          }}
        />
      </LiquidMetalCard>
    </div>
  );
}
