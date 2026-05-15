import type { Meta, StoryObj } from '@storybook/react';
import { WaitingForMatch } from '../src/components/Assessment/WaitingForMatch';

const meta: Meta<typeof WaitingForMatch> = {
  title: 'Assessment/WaitingForMatch',
  component: WaitingForMatch,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof WaitingForMatch>;

export const Default: Story = {
  args: {
    title: 'Building your personalized challenge',
    instructions: 'We are analyzing your profile to find the best open-source project match. This takes 2–3 minutes.',
    config: {
      autoRefresh: true,
      refreshIntervalSeconds: 30,
      estimatedSecondsRemaining: 180,
    },
    onRefresh: () => console.log('refresh'),
    sessionToken: 'mock-token',
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', background: '#0c0c0e' }}>
        <Story />
      </div>
    ),
  ],
};

export const ShortWait: Story = {
  args: {
    title: 'Preparing your challenge',
    instructions: 'Just a moment while we set things up.',
    config: {
      autoRefresh: true,
      refreshIntervalSeconds: 10,
      estimatedSecondsRemaining: 30,
    },
    onRefresh: () => console.log('refresh'),
  },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', background: '#0c0c0e' }}>
        <Story />
      </div>
    ),
  ],
};
