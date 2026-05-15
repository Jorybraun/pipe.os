import type { Meta, StoryObj } from '@storybook/react';
import { CoverageProgress } from '../src/components/Assessment/CoverageProgress';

const meta: Meta<typeof CoverageProgress> = {
  title: 'Assessment/CoverageProgress',
  component: CoverageProgress,
};

export default meta;
type Story = StoryObj<typeof CoverageProgress>;

export const RoleFit: Story = {
  args: {
    coverage: {
      ownership: 2,
      collaboration: 1,
      'learning-orientation': 0,
      'conflict-handling': 3,
      'self-awareness': 1,
    },
    phase: 'probing',
    turnsAsked: 3,
    totalBudget: 10,
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', background: '#0c0c0e', padding: 24 }}>
        <Story />
      </div>
    ),
  ],
};

export const ProfileBuilder: Story = {
  args: {
    coverage: {
      career_history: 2,
      behavioral_depth: 1,
      cultural: 0,
      technical: 3,
      motivation: 1,
      context: 0,
    },
    phase: 'rapport_building',
    turnsAsked: 2,
    totalBudget: 8,
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', background: '#0c0c0e', padding: 24 }}>
        <Story />
      </div>
    ),
  ],
};

export const NearComplete: Story = {
  args: {
    coverage: {
      ownership: 3,
      collaboration: 3,
      'learning-orientation': 2,
      'conflict-handling': 3,
      'self-awareness': 2,
    },
    phase: 'wrap_up',
    turnsAsked: 8,
    totalBudget: 10,
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', background: '#0c0c0e', padding: 24 }}>
        <Story />
      </div>
    ),
  ],
};
