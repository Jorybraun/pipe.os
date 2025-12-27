import type { Meta, StoryObj } from "@storybook/react";
import { SettingsTab } from "../src/components/QuestionDetail/tabs/SettingsTab";
import { questions } from "../src/mocks/questions";

const meta = {
  title: "Components/QuestionDetail/SettingsTab",
  component: SettingsTab,
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
} satisfies Meta<typeof SettingsTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    settings: questions[0].settings,
  },
};

export const AllEnabled: Story = {
  args: {
    settings: {
      allowRerecording: true,
      preparationTime: 60,
      autoAdvance: true,
    },
  },
};

export const AllDisabled: Story = {
  args: {
    settings: {
      allowRerecording: false,
      preparationTime: 0,
      autoAdvance: false,
    },
  },
};

export const LongPreparation: Story = {
  args: {
    settings: {
      allowRerecording: true,
      preparationTime: 120,
      autoAdvance: false,
    },
  },
};

export const AutoAdvanceOnly: Story = {
  args: {
    settings: {
      allowRerecording: false,
      preparationTime: 30,
      autoAdvance: true,
    },
  },
};
