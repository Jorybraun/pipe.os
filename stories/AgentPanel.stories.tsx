import type { Meta, StoryObj } from "@storybook/react";
import { BrowserRouter } from "react-router-dom";
import AgentPanel from "../src/components/RoleDiscovery/AgentPanel";

/**
 * AgentPanel displays the AI agent status, progress tracking, and chat interface
 * for the role discovery phase. Uses dark and mercury LiquidMetalCard variants
 * to match the QuestionDetail styling.
 */
const meta = {
  title: "Components/AgentPanel",
  component: AgentPanel,
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0a0a0f" }],
    },
  },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <div style={{ minHeight: "100vh", background: "#0a0a0f" }}>
          <Story />
        </div>
      </BrowserRouter>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof AgentPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state with partial progress (33%).
 * Shows 3 incomplete sections and gaps in role discovery.
 */
export const Default: Story = {
  args: {
    baseline: {
      title: "Software Engineer",
      level: "Mid",
      department: "Engineering",
    },
    context: {
      successCriteria: "Deliver MVP in 90 days",
      challenges: "Legacy code migration",
      culture: "Remote-first, async communication",
    },
    progress: 33,
    gaps: [
      "Role identity incomplete",
      "Team context incomplete",
      "Technical environment incomplete",
    ],
  },
};

/**
 * State with 50% completion.
 * Shows moderate progress with 2 remaining gaps.
 */
export const HalfComplete: Story = {
  args: {
    baseline: {
      title: "Software Engineer",
      level: "Mid",
      department: "Engineering",
    },
    context: {
      successCriteria: "Deliver MVP in 90 days",
      challenges: "Legacy code migration",
      culture: "Remote-first, async communication",
    },
    progress: 50,
    gaps: ["Technical stack needs more detail", "Team structure incomplete"],
  },
};

/**
 * Ready state with 60%+ completion.
 * Shows the agent is ready to proceed to Phase 2 with minimal gaps.
 */
export const Ready: Story = {
  args: {
    baseline: {
      title: "Software Engineer",
      level: "Mid",
      department: "Engineering",
    },
    context: {
      successCriteria: "Deliver MVP in 90 days",
      challenges: "Legacy code migration",
      culture: "Remote-first, async communication",
    },
    progress: 67,
    gaps: ["Optional: Add more team context"],
  },
};

/**
 * Fully complete state (100%).
 * Shows all sections complete with no gaps remaining.
 */
export const Complete: Story = {
  args: {
    baseline: {
      title: "Software Engineer",
      level: "Mid",
      department: "Engineering",
    },
    context: {
      successCriteria: "Deliver MVP in 90 days",
      challenges: "Legacy code migration",
      culture: "Remote-first, async communication",
    },
    progress: 100,
    gaps: [],
  },
};

/**
 * Early progress state (16%).
 * Shows minimal completion with many gaps.
 */
export const EarlyProgress: Story = {
  args: {
    baseline: {
      title: "Software Engineer",
      level: "Mid",
      department: "Engineering",
    },
    context: {
      successCriteria: "Deliver MVP in 90 days",
      challenges: "Legacy code migration",
      culture: "Remote-first, async communication",
    },
    progress: 16,
    gaps: [
      "Role identity incomplete",
      "Team context incomplete",
      "Technical environment incomplete",
      "Responsibilities undefined",
      "Skills requirements unclear",
    ],
  },
};
