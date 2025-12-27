import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Toggle } from "../src/components/ui/Toggle";

const meta = {
  title: "Components/UI/Toggle",
  component: Toggle,
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
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {
  args: {
    checked: false,
    ariaLabel: "Toggle setting",
  },
};

export const Checked: Story = {
  args: {
    checked: true,
    ariaLabel: "Toggle setting",
  },
};

export const Disabled: Story = {
  args: {
    checked: false,
    disabled: true,
    ariaLabel: "Disabled toggle",
  },
};

export const DisabledChecked: Story = {
  args: {
    checked: true,
    disabled: true,
    ariaLabel: "Disabled checked toggle",
  },
};

const InteractiveComponent = () => {
  const [checked, setChecked] = useState(false);

  return (
    <div>
      <Toggle checked={checked} onChange={setChecked} ariaLabel="Interactive toggle" />
      <div style={{ marginTop: 16, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
        Status: <strong style={{ color: "#fff" }}>{checked ? "ON" : "OFF"}</strong>
      </div>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveComponent />,
};

const WithLabelComponent = () => {
  const [checked, setChecked] = useState(true);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
        Allow Re-recording
      </div>
      <Toggle checked={checked} onChange={setChecked} ariaLabel="Allow re-recording" />
    </div>
  );
};

export const WithLabel: Story = {
  render: () => <WithLabelComponent />,
};

const MultipleComponent = () => {
  const [settings, setSettings] = useState({
    rerecording: true,
    autoAdvance: false,
    notifications: true,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: 300 }}>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          Allow Re-recording
        </div>
        <Toggle
          checked={settings.rerecording}
          onChange={(val) => setSettings({ ...settings, rerecording: val })}
          ariaLabel="Allow re-recording"
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: 300 }}>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          Auto-Advance
        </div>
        <Toggle
          checked={settings.autoAdvance}
          onChange={(val) => setSettings({ ...settings, autoAdvance: val })}
          ariaLabel="Auto-advance"
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: 300 }}>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
          Notifications
        </div>
        <Toggle
          checked={settings.notifications}
          onChange={(val) => setSettings({ ...settings, notifications: val })}
          ariaLabel="Notifications"
        />
      </div>
    </div>
  );
};

export const Multiple: Story = {
  render: () => <MultipleComponent />,
};
