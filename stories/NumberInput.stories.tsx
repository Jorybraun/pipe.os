import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { NumberInput } from "../src/components/ui/NumberInput";

const meta = {
  title: "Components/UI/NumberInput",
  component: NumberInput,
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
} satisfies Meta<typeof NumberInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 5,
    unit: "MIN",
  },
};

export const WithSeconds: Story = {
  args: {
    value: 30,
    unit: "SEC",
  },
};

export const WithMinMax: Story = {
  args: {
    value: 5,
    min: 1,
    max: 10,
    unit: "MIN",
  },
};

export const CustomStep: Story = {
  args: {
    value: 15,
    step: 5,
    unit: "MIN",
  },
};

export const Disabled: Story = {
  args: {
    value: 3,
    disabled: true,
    unit: "MIN",
  },
};

const InteractiveComponent = () => {
  const [value, setValue] = useState(3);

  return (
    <div>
      <NumberInput value={value} onChange={setValue} min={1} max={10} unit="MIN" />
      <div style={{ marginTop: 16, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
        Time limit: <strong style={{ color: "#fff" }}>{value} minutes</strong>
      </div>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveComponent />,
};

const PreparationTimeComponent = () => {
  const [value, setValue] = useState(30);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, minWidth: 150 }}>
        Preparation Countdown
      </div>
      <NumberInput value={value} onChange={setValue} min={0} max={120} step={15} unit="SEC" />
    </div>
  );
};

export const PreparationTime: Story = {
  render: () => <PreparationTimeComponent />,
};
