import type { Meta, StoryObj } from "@storybook/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QuestionDetail } from "../src/components/QuestionDetail/QuestionDetail";

const meta = {
  title: "Components/QuestionDetail/QuestionDetail",
  component: QuestionDetail,
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <Routes>
          <Route path="/pipeline/:id/:stage/:questionId" element={<Story />} />
          <Route path="*" element={<Story />} />
        </Routes>
      </BrowserRouter>
    ),
  ],
} satisfies Meta<typeof QuestionDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TechnicalQuestion: Story = {
  parameters: {
    reactRouter: {
      routePath: "/pipeline/:id/:stage/:questionId",
      routeParams: { id: "pipeline-1", stage: "questions", questionId: "question-1" },
    },
  },
};

export const BehavioralQuestion: Story = {
  parameters: {
    reactRouter: {
      routePath: "/pipeline/:id/:stage/:questionId",
      routeParams: { id: "pipeline-1", stage: "questions", questionId: "question-2" },
    },
  },
};

export const MotivationQuestion: Story = {
  parameters: {
    reactRouter: {
      routePath: "/pipeline/:id/:stage/:questionId",
      routeParams: { id: "pipeline-1", stage: "questions", questionId: "question-3" },
    },
  },
};

export const NotFound: Story = {
  parameters: {
    reactRouter: {
      routePath: "/pipeline/:id/:stage/:questionId",
      routeParams: { id: "pipeline-1", stage: "questions", questionId: "question-999" },
    },
  },
};
