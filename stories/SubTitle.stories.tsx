import type { Meta, StoryObj } from "@storybook/react";
import { SubTitle } from "../src/components/ui/SubTitle";

const meta = {
  title: "Components/UI/SubTitle",
  component: SubTitle,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 60, width: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SubTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "QUESTION_CONTENT",
  },
};

export const ScoringRubric: Story = {
  args: {
    children: "SCORING_RUBRIC",
  },
};

export const QuestionSettings: Story = {
  args: {
    children: "QUESTION_SETTINGS",
  },
};

export const DangerZone: Story = {
  args: {
    children: "DANGER_ZONE",
  },
};

export const Multiple: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <SubTitle>SECTION_ONE</SubTitle>
      <div style={{ height: 40, background: "rgba(255,255,255,0.05)", borderRadius: 4 }} />
      <SubTitle>SECTION_TWO</SubTitle>
      <div style={{ height: 40, background: "rgba(255,255,255,0.05)", borderRadius: 4 }} />
      <SubTitle>SECTION_THREE</SubTitle>
      <div style={{ height: 40, background: "rgba(255,255,255,0.05)", borderRadius: 4 }} />
    </div>
  ),
};
