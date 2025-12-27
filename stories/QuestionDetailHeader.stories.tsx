import type { Meta, StoryObj } from "@storybook/react";
import { BrowserRouter } from "react-router-dom";
import { QuestionDetailHeader } from "../src/components/QuestionDetail/QuestionDetailHeader";

const meta = {
  title: "Components/QuestionDetail/QuestionDetailHeader",
  component: QuestionDetailHeader,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <div style={{ padding: 60, width: 800 }}>
          <Story />
        </div>
      </BrowserRouter>
    ),
  ],
} satisfies Meta<typeof QuestionDetailHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    questionId: "question-1",
  },
};

export const WithCallback: Story = {
  args: {
    questionId: "question-5",
    onBack: () => console.log("Back button clicked"),
  },
};

export const DifferentQuestion: Story = {
  args: {
    questionId: "question-15",
  },
};
