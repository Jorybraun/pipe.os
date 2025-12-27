import type { Meta, StoryObj } from "@storybook/react";
import {
  Layout,
  ProfileHeader,
  LiquidMetalCard,
  MetalScoreRing,
} from "../src/components/shared/index";

// Layout Story
const LayoutMeta = {
  title: "Components/Profile/ProfileLayout",
  component: Layout,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof Layout>;

export default LayoutMeta;
type LayoutStory = StoryObj<typeof LayoutMeta>;

export const Default: LayoutStory = {
  args: {
    header: <ProfileHeader />,
    children: (
      <div style={{ padding: 40 }}>
        <h2 style={{ color: "#fff", marginBottom: 20 }}>Content goes here</h2>
        <p style={{ color: "rgba(255,255,255,0.6)" }}>
          This is the main content area. Add your profile sections here.
        </p>
      </div>
    ),
  },
};

export const CustomHeader: LayoutStory = {
  args: {
    header: (
      <ProfileHeader title="ENGINEERING_TEAM" subtitle="SYSTEM // V.1.0.0" />
    ),
    children: (
      <div style={{ padding: 40 }}>
        <LiquidMetalCard variant="chrome" hover style={{ padding: 30 }}>
          <h3 style={{ color: "#fff", margin: 0 }}>Custom Content</h3>
        </LiquidMetalCard>
      </div>
    ),
  },
};
