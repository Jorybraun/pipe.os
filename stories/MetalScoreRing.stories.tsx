import type { Meta, StoryObj } from "@storybook/react";
import { MetalScoreRing } from "../src/components/shared";

const meta = {
  title: "Components/Profile/MetalScoreRing",
  component: MetalScoreRing,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 60 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MetalScoreRing>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 85,
    label: "SCORE",
  },
};

export const High: Story = {
  args: {
    value: 95,
    label: "HIGH",
  },
};

export const Medium: Story = {
  args: {
    value: 65,
    label: "MED",
  },
};

export const Low: Story = {
  args: {
    value: 35,
    label: "LOW",
  },
};

export const Large: Story = {
  args: {
    value: 91,
    size: 180,
    label: "AVG",
  },
};

export const Small: Story = {
  args: {
    value: 78,
    size: 80,
    label: "MIN",
  },
};

export const NoLabel: Story = {
  args: {
    value: 88,
  },
};

export const Multiple: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
      <MetalScoreRing value={91} size={140} label="ROLE" />
      <MetalScoreRing value={85} size={140} label="CULTURE" />
      <MetalScoreRing value={88} size={140} label="GROWTH" />
    </div>
  ),
};
