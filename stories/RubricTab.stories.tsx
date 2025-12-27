import type { Meta, StoryObj } from "@storybook/react";
import { RubricTab } from "../src/components/QuestionDetail/tabs/RubricTab";
import { questions } from "../src/mocks/questions";

const meta = {
  title: "Components/QuestionDetail/RubricTab",
  component: RubricTab,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 60, width: 800 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RubricTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TechnicalRubric: Story = {
  args: {
    rubric: questions[0].rubric,
  },
};

export const BehavioralRubric: Story = {
  args: {
    rubric: questions[1].rubric,
  },
};

export const MotivationRubric: Story = {
  args: {
    rubric: questions[2].rubric,
  },
};

export const FiveDimensions: Story = {
  args: {
    rubric: questions[3].rubric,
  },
};
