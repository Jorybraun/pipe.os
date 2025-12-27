import type { Meta, StoryObj } from "@storybook/react";
import { LiquidMetalCard } from "../src/components/shared";

const meta = {
  title: "Components/Profile/LiquidMetalCard",
  component: LiquidMetalCard,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 40, minWidth: 400 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LiquidMetalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ color: "#fff", margin: 0, marginBottom: 8 }}>
          Default Card
        </h3>
        <p style={{ color: "rgba(255,255,255,0.6)", margin: 0, fontSize: 14 }}>
          This is a default liquid metal card with subtle chrome gradient.
        </p>
      </div>
    ),
  },
};

export const Chrome: Story = {
  args: {
    variant: "chrome",
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ color: "#fff", margin: 0, marginBottom: 8 }}>
          Chrome Variant
        </h3>
        <p style={{ color: "rgba(255,255,255,0.6)", margin: 0, fontSize: 14 }}>
          Brighter chrome effect with enhanced metallic sheen.
        </p>
      </div>
    ),
  },
};

export const Mercury: Story = {
  args: {
    variant: "mercury",
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ color: "#fff", margin: 0, marginBottom: 8 }}>
          Mercury Variant
        </h3>
        <p style={{ color: "rgba(255,255,255,0.6)", margin: 0, fontSize: 14 }}>
          Liquid mercury effect with flowing gradient.
        </p>
      </div>
    ),
  },
};

export const Dark: Story = {
  args: {
    variant: "dark",
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ color: "#fff", margin: 0, marginBottom: 8 }}>
          Dark Variant
        </h3>
        <p style={{ color: "rgba(255,255,255,0.6)", margin: 0, fontSize: 14 }}>
          Darker background for contrast or nested content.
        </p>
      </div>
    ),
  },
};

export const WithHover: Story = {
  args: {
    variant: "chrome",
    hover: true,
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ color: "#fff", margin: 0, marginBottom: 8 }}>
          Hover Effect
        </h3>
        <p style={{ color: "rgba(255,255,255,0.6)", margin: 0, fontSize: 14 }}>
          Hover over this card to see the chrome sweep animation.
        </p>
      </div>
    ),
  },
};

export const AllVariants: Story = {
  render: () => (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16, width: 500 }}
    >
      <LiquidMetalCard variant="default" hover>
        <div style={{ padding: 20 }}>
          <strong style={{ color: "#fff" }}>Default</strong>
        </div>
      </LiquidMetalCard>
      <LiquidMetalCard variant="chrome" hover>
        <div style={{ padding: 20 }}>
          <strong style={{ color: "#fff" }}>Chrome</strong>
        </div>
      </LiquidMetalCard>
      <LiquidMetalCard variant="mercury" hover>
        <div style={{ padding: 20 }}>
          <strong style={{ color: "#fff" }}>Mercury</strong>
        </div>
      </LiquidMetalCard>
      <LiquidMetalCard variant="dark" hover>
        <div style={{ padding: 20 }}>
          <strong style={{ color: "#fff" }}>Dark</strong>
        </div>
      </LiquidMetalCard>
    </div>
  ),
};
