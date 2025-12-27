import type { Meta, StoryObj } from "@storybook/react";
import ProfileExample from "../prototypes/profile-example";

const meta = {
  title: "Prototypes/Profile",
  component: ProfileExample,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ProfileExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullExample: Story = {};
