import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  LiquidMetalCard,
  SubTitle,
} from "../components";
import { questions } from "../mocks/questions";
import QuestionCard from "../components/QuestionCard";

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
  | "AI_COLLAB"
  | "CODE_REVIEW"
  | "PLANNING"
  | "VOICE"
  | "PANEL";

// Helper card components
function RubricCard({ title, points }: { title: string; points: string[] }) {
  return (
    <LiquidMetalCard variant="dark" style={{ padding: 20, marginBottom: 12 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: "rgba(255,255,255,0.3)",
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
              color: "rgba(255,255,255,0.6)",
              marginBottom: 8,
              paddingLeft: 16,
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                color: "rgba(255,255,255,0.3)",
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
          color: "rgba(255,255,255,0.3)",
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

// Stage configuration panels
function ScreeningStageConfig() {
  const navigate = useNavigate();
  const { id, stage } = useParams<{ id: string; stage: string }>();

  const handleQuestionClick = (questionId: string): void => {
    navigate(`/pipeline/${id}/${stage}/${questionId}`);
  };

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>SCREENING_QUESTIONS</SubTitle>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}
      >
        <div>
          {questions.map((question, index) => {
            return (
              <QuestionCard
                key={question.id}
                question={question}
                index={index}
                onClick={() => handleQuestionClick(question.id)}
              />
            );
          })}
        </div>

        <div>
          <TimeCard duration="30m" label="Duration" />
        </div>
      </div>
    </div>
  );
}

function AICollabStageConfig() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>AI_COLLABORATION_ASSESSMENT</SubTitle>
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
        <SubTitle>SYSTEM_DESIGN_&amp;_PLANNING</SubTitle>
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

function VoiceStageConfig() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>VOICE_INTERVIEW</SubTitle>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}
      >
        <div>
          <RubricCard
            title="Technical Discussion"
            points={[
              "Explaining complex technical concepts clearly",
              "Discussing past projects and decisions",
              "Problem-solving approach and methodology",
              "Learning from failures and mistakes",
            ]}
          />
          <RubricCard
            title="Collaboration & Culture"
            points={[
              "Team collaboration experience",
              "Mentoring and knowledge sharing",
              "Handling feedback and disagreements",
              "Alignment with team values",
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

function PanelStageConfig() {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <SubTitle>PANEL_INTERVIEW</SubTitle>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}
      >
        <div>
          <RubricCard
            title="Cross-Functional Assessment"
            points={[
              "Product thinking and user empathy",
              "Cross-team collaboration experience",
              "Technical leadership potential",
              "Strategic thinking and prioritization",
            ]}
          />
          <RubricCard
            title="Growth & Impact"
            points={[
              "Career growth trajectory",
              "Impact on previous teams/projects",
              "Continuous learning mindset",
              "Long-term potential and fit",
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

export default function PipelineDetailPage(): JSX.Element {
  const [selectedStage] = useState<StageType>("SCREENING");

  const renderStageConfig = () => {
    switch (selectedStage) {
      case "SCREENING":
        return <ScreeningStageConfig />;
      case "AI_COLLAB":
        return <AICollabStageConfig />;
      case "CODE_REVIEW":
        return <CodeReviewStageConfig />;
      case "PLANNING":
        return <PlanningStageConfig />;
      case "VOICE":
        return <VoiceStageConfig />;
      case "PANEL":
        return <PanelStageConfig />;
      default:
        return null;
    }
  };

  return <div>{renderStageConfig()}</div>;
}
