import type { Meta, StoryObj } from "@storybook/react";
import { SidebarNav } from "../src/components/shared";

const meta = {
  title: "Components/Profile/SidebarNav",
  component: SidebarNav,
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ height: "600px", width: "280px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SidebarNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    activeSection: "overview",
  },
};

export const AssessmentsActive: Story = {
  args: {
    activeSection: "assessments",
  },
};

export const SignalsActive: Story = {
  args: {
    activeSection: "signals",
  },
};

export const Interactive: Story = {
  args: {
    activeSection: "overview",
    onSectionChange: (section) => console.log("Section changed:", section),
  },
};
