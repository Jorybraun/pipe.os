import type { Meta, StoryObj } from "@storybook/react";
import { LiquidMetalCard } from "../src/components/ui/LiquidMetalCard";

const meta = {
  title: "Components/UI/LiquidMetalCard",
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
      <div style={{ padding: 60, width: 400 }}>
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
        <h3 style={{ margin: 0, marginBottom: 8, color: "#fff" }}>Default Variant</h3>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          This is the default liquid metal card with subtle gradient background.
        </p>
      </div>
    ),
    variant: "default",
  },
};

export const Chrome: Story = {
  args: {
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ margin: 0, marginBottom: 8, color: "#fff" }}>Chrome Variant</h3>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          Chrome variant with cooler metallic gradient effect.
        </p>
      </div>
    ),
    variant: "chrome",
  },
};

export const Mercury: Story = {
  args: {
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ margin: 0, marginBottom: 8, color: "#fff" }}>Mercury Variant</h3>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          Mercury variant with liquid metallic appearance.
        </p>
      </div>
    ),
    variant: "mercury",
  },
};

export const Dark: Story = {
  args: {
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ margin: 0, marginBottom: 8, color: "#fff" }}>Dark Variant</h3>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          Dark variant with deeper background suitable for danger zones.
        </p>
      </div>
    ),
    variant: "dark",
  },
};

export const Clickable: Story = {
  args: {
    children: (
      <div style={{ padding: 24 }}>
        <h3 style={{ margin: 0, marginBottom: 8, color: "#fff" }}>Clickable Card</h3>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          Click me! This card has an onClick handler.
        </p>
      </div>
    ),
    variant: "default",
    onClick: () => alert("Card clicked!"),
  },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 400 }}>
      <LiquidMetalCard variant="default">
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Default</div>
        </div>
      </LiquidMetalCard>
      <LiquidMetalCard variant="chrome">
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Chrome</div>
        </div>
      </LiquidMetalCard>
      <LiquidMetalCard variant="mercury">
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Mercury</div>
        </div>
      </LiquidMetalCard>
      <LiquidMetalCard variant="dark">
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Dark</div>
        </div>
      </LiquidMetalCard>
    </div>
  ),
};
