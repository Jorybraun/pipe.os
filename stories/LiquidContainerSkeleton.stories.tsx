import type { Meta, StoryObj } from "@storybook/react";
import { LiquidContainerSkeleton } from "../src/components/shared/LiquidContainerSkeleton";

const meta = {
  title: "Components/Shared/LiquidContainerSkeleton",
  component: LiquidContainerSkeleton,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LiquidContainerSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
