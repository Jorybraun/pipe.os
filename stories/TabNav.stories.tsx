import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TabNav } from "../src/components/ui/TabNav";
import { FileQuestion, Video, ClipboardList, Settings } from "lucide-react";

const meta = {
  title: "Components/UI/TabNav",
  component: TabNav,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0c0c0e" }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 60, width: 600 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TabNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tabs: [
      { id: "question", label: "QUESTION", icon: <FileQuestion size={14} /> },
      { id: "video", label: "VIDEO", icon: <Video size={14} /> },
      { id: "rubric", label: "RUBRIC", icon: <ClipboardList size={14} /> },
      { id: "settings", label: "SETTINGS", icon: <Settings size={14} /> },
    ],
    activeTab: "question",
    onTabChange: (tabId) => console.log("Tab changed:", tabId),
  },
};

export const WithoutIcons: Story = {
  args: {
    tabs: [
      { id: "overview", label: "OVERVIEW" },
      { id: "details", label: "DETAILS" },
      { id: "analytics", label: "ANALYTICS" },
    ],
    activeTab: "overview",
    onTabChange: (tabId) => console.log("Tab changed:", tabId),
  },
};

const InteractiveComponent = () => {
  const [activeTab, setActiveTab] = useState("question");

  return (
    <div>
      <TabNav
        tabs={[
          { id: "question", label: "QUESTION", icon: <FileQuestion size={14} /> },
          { id: "video", label: "VIDEO", icon: <Video size={14} /> },
          { id: "rubric", label: "RUBRIC", icon: <ClipboardList size={14} /> },
          { id: "settings", label: "SETTINGS", icon: <Settings size={14} /> },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div style={{ marginTop: 32, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
        Active tab: <strong style={{ color: "#fff" }}>{activeTab}</strong>
        <div style={{ marginTop: 8, fontSize: 12 }}>
          Try clicking tabs or using keyboard navigation (Arrow Left/Right, Home/End)
        </div>
      </div>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveComponent />,
};
