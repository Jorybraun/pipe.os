import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ButtonGroup } from "../src/components/ui/ButtonGroup";

const meta = {
  title: "Components/UI/ButtonGroup",
  component: ButtonGroup,
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
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const questionTypes = [
  { value: "technical", label: "TECHNICAL" },
  { value: "behavioral", label: "BEHAVIORAL" },
  { value: "motivation", label: "MOTIVATION" },
  { value: "situational", label: "SITUATIONAL" },
];

export const Default: Story = {
  args: {
    options: questionTypes,
    selected: "technical",
  },
};

export const BehavioralSelected: Story = {
  args: {
    options: questionTypes,
    selected: "behavioral",
  },
};

export const Disabled: Story = {
  args: {
    options: questionTypes,
    selected: "technical",
    disabled: true,
  },
};

const InteractiveComponent = () => {
  const [selected, setSelected] = useState("technical");

  return (
    <div>
      <ButtonGroup options={questionTypes} selected={selected} onChange={setSelected} />
      <div style={{ marginTop: 16, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
        Selected type: <strong style={{ color: "#fff" }}>{selected}</strong>
      </div>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveComponent />,
};

const TwoOptionsComponent = () => {
  const [selected, setSelected] = useState("yes");

  return (
    <div>
      <ButtonGroup
        options={[
          { value: "yes", label: "YES" },
          { value: "no", label: "NO" },
        ]}
        selected={selected}
        onChange={setSelected}
      />
      <div style={{ marginTop: 16, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
        Selected: <strong style={{ color: "#fff" }}>{selected}</strong>
      </div>
    </div>
  );
};

export const TwoOptions: Story = {
  render: () => <TwoOptionsComponent />,
};

const ThreeOptionsComponent = () => {
  const [selected, setSelected] = useState("medium");

  return (
    <div>
      <ButtonGroup
        options={[
          { value: "easy", label: "EASY" },
          { value: "medium", label: "MEDIUM" },
          { value: "hard", label: "HARD" },
        ]}
        selected={selected}
        onChange={setSelected}
      />
      <div style={{ marginTop: 16, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
        Difficulty: <strong style={{ color: "#fff" }}>{selected}</strong>
      </div>
    </div>
  );
};

export const ThreeOptions: Story = {
  render: () => <ThreeOptionsComponent />,
};
