import type { Meta, StoryObj } from "@storybook/react";
import { VideoTab } from "../src/components/QuestionDetail/tabs/VideoTab";
import { questions } from "../src/mocks/questions";

const meta = {
  title: "Components/QuestionDetail/VideoTab",
  component: VideoTab,
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
} satisfies Meta<typeof VideoTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoVideoRecorded: Story = {
  args: {
    question: questions[0],
  },
};

export const VideoRecorded: Story = {
  args: {
    question: {
      ...questions[0],
      hasVideo: true,
      videoDuration: 45,
    },
  },
};

export const LongVideo: Story = {
  args: {
    question: {
      ...questions[0],
      hasVideo: true,
      videoDuration: 180,
    },
  },
};

export const ShortVideo: Story = {
  args: {
    question: {
      ...questions[0],
      hasVideo: true,
      videoDuration: 15,
    },
  },
};
