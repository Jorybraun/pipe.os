import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ProgressBar } from './ProgressBar';

const meta = {
  title: 'Components/ProgressBar',
  component: ProgressBar,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
      description: 'Current progress value (0-100). null for indeterminate state.',
    },
    max: {
      control: { type: 'range', min: 1, max: 1000, step: 1 },
      description: 'Maximum progress value',
    },
    status: {
      control: 'select',
      options: ['success', 'warning', 'error', 'info'],
      description: 'Status variant controlling color',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Size of the progress bar',
    },
    label: {
      control: 'text',
      description: 'Custom label to display',
    },
    showPercentage: {
      control: 'boolean',
      description: 'Whether to show percentage text',
    },
    animated: {
      control: 'boolean',
      description: 'Whether to show shimmer animation',
    },
    striped: {
      control: 'boolean',
      description: 'Whether to show diagonal stripe pattern',
    },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default progress bar at 65%
 */
export const Default: Story = {
  args: {
    value: 65,
  },
};

/**
 * Empty progress bar (0%)
 */
export const Empty: Story = {
  args: {
    value: 0,
    label: '0% complete',
  },
};

/**
 * Half progress (50%)
 */
export const HalfProgress: Story = {
  args: {
    value: 50,
    label: 'Processing',
  },
};

/**
 * Complete progress (100%)
 */
export const Complete: Story = {
  args: {
    value: 100,
    label: 'Complete!',
  },
};

/**
 * Indeterminate state (loading)
 */
export const Indeterminate: Story = {
  args: {
    value: null,
    label: 'Loading...',
  },
};

/**
 * Success status
 */
export const Success: Story = {
  args: {
    value: 100,
    status: 'success',
    label: 'Upload complete',
  },
};

/**
 * Warning status
 */
export const Warning: Story = {
  args: {
    value: 75,
    status: 'warning',
    label: 'Processing...',
  },
};

/**
 * Error status
 */
export const Error: Story = {
  args: {
    value: 25,
    status: 'error',
    label: 'Error: retrying...',
  },
};

/**
 * Info status
 */
export const Info: Story = {
  args: {
    value: 50,
    status: 'info',
    label: 'Downloading',
  },
};

/**
 * Small size
 */
export const Small: Story = {
  args: {
    value: 65,
    size: 'sm',
    label: 'Small progress bar',
  },
};

/**
 * Medium size (default)
 */
export const Medium: Story = {
  args: {
    value: 65,
    size: 'md',
    label: 'Medium progress bar',
  },
};

/**
 * Large size
 */
export const Large: Story = {
  args: {
    value: 65,
    size: 'lg',
    label: 'Large progress bar',
  },
};

/**
 * Animated with shimmer effect
 */
export const Animated: Story = {
  args: {
    value: 50,
    animated: true,
    label: 'Uploading...',
  },
};

/**
 * Striped pattern
 */
export const Striped: Story = {
  args: {
    value: 65,
    striped: true,
    label: 'Processing with stripes',
  },
};

/**
 * Animated and striped combination
 */
export const AnimatedStriped: Story = {
  args: {
    value: 50,
    animated: true,
    striped: true,
    label: 'Active processing...',
  },
};

/**
 * Without percentage label
 */
export const NoPercentage: Story = {
  args: {
    value: 75,
    showPercentage: false,
    label: 'Processing files',
  },
};

/**
 * All status variants
 */
export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '300px' }}>
      <div>
        <ProgressBar value={100} status="success" label="Success" />
      </div>
      <div>
        <ProgressBar value={75} status="warning" label="Warning" />
      </div>
      <div>
        <ProgressBar value={50} status="info" label="Info" />
      </div>
      <div>
        <ProgressBar value={25} status="error" label="Error" />
      </div>
    </div>
  ),
};

/**
 * All sizes
 */
export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '300px' }}>
      <div>
        <ProgressBar value={65} size="sm" label="Small (sm)" />
      </div>
      <div>
        <ProgressBar value={65} size="md" label="Medium (md)" />
      </div>
      <div>
        <ProgressBar value={65} size="lg" label="Large (lg)" />
      </div>
    </div>
  ),
};

/**
 * Interactive demo with value slider
 */
export const Interactive: Story = {
  render: () => {
    const [value, setValue] = React.useState(50);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '300px' }}>
        <ProgressBar value={value} animated label={`${value}% complete`} />
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>
    );
  },
};

/**
 * Different max values
 */
export const CustomMax: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '300px' }}>
      <div>
        <ProgressBar value={25} max={50} label="25/50" />
      </div>
      <div>
        <ProgressBar value={500} max={1000} label="500/1000" />
      </div>
      <div>
        <ProgressBar value={75} max={150} label="75/150" />
      </div>
    </div>
  ),
};

/**
 * State transitions (determinate to indeterminate)
 */
export const StateTransition: Story = {
  render: () => {
    const [isLoading, setIsLoading] = React.useState(false);
    const [progress, setProgress] = React.useState(0);

    React.useEffect(() => {
      if (!isLoading) return;
      const interval = setInterval(() => {
        setProgress((p) => (p >= 90 ? 90 : p + 10));
      }, 500);
      return () => clearInterval(interval);
    }, [isLoading]);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '300px' }}>
        <ProgressBar
          value={isLoading ? null : progress}
          status={isLoading ? 'info' : progress === 100 ? 'success' : 'info'}
          label={isLoading ? 'Processing...' : `${progress}% complete`}
        />
        <button onClick={() => setIsLoading(!isLoading)} style={{ padding: '8px 16px' }}>
          {isLoading ? 'Stop' : 'Start'}
        </button>
        <button onClick={() => setProgress(0)} style={{ padding: '8px 16px' }}>
          Reset
        </button>
      </div>
    );
  },
};
