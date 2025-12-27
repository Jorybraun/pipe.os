import type { Meta, StoryObj } from "@storybook/react";
import { QuestionTab } from "../src/components/QuestionDetail/tabs/QuestionTab";
import { questions } from "../src/mocks/questions";

const meta = {
  title: "Components/QuestionDetail/QuestionTab",
  component: QuestionTab,
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
} satisfies Meta<typeof QuestionTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TechnicalQuestion: Story = {
  args: {
    question: questions[0],
  },
};

export const BehavioralQuestion: Story = {
  args: {
    question: questions[1],
  },
};

export const MotivationQuestion: Story = {
  args: {
    question: questions[2],
  },
};

export const WithVideo: Story = {
  args: {
    question: {
      ...questions[0],
      hasVideo: true,
      videoDuration: 45,
    },
  },
};

export const NotRequired: Story = {
  args: {
    question: {
      ...questions[0],
      isRequired: false,
    },
  },
};

export const LongTimeLimit: Story = {
  args: {
    question: {
      ...questions[0],
      timeLimit: 10,
    },
  },
};
