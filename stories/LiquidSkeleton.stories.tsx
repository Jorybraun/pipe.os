import type { Meta, StoryObj } from "@storybook/react";
import { LiquidSkeleton } from "../src/components/shared/LiquidSkeleton";

const meta = {
  title: "Components/Shared/LiquidSkeleton",
  component: LiquidSkeleton,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LiquidSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
