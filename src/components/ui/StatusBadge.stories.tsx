import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { StatusBadge } from './StatusBadge';

const meta = {
  title: 'Components/StatusBadge',
  component: StatusBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['success', 'warning', 'error', 'info', 'neutral'],
      description: 'Status variant controlling color scheme',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Size of the badge',
    },
    label: {
      control: 'text',
      description: 'Custom label to display',
    },
    dismissible: {
      control: 'boolean',
      description: 'Whether the badge can be dismissed',
    },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default status badge with info status
 */
export const Default: Story = {
  args: {
    label: 'Info Status',
  },
};

/**
 * Success variant
 */
export const Success: Story = {
  args: {
    status: 'success',
    label: 'Approved',
  },
};

/**
 * Warning variant
 */
export const Warning: Story = {
  args: {
    status: 'warning',
    label: 'Pending Review',
  },
};

/**
 * Error variant
 */
export const Error: Story = {
  args: {
    status: 'error',
    label: 'Failed',
  },
};

/**
 * Info variant
 */
export const Info: Story = {
  args: {
    status: 'info',
    label: 'Information',
  },
};

/**
 * Neutral variant (default)
 */
export const Neutral: Story = {
  args: {
    status: 'neutral',
    label: 'Status',
  },
};

/**
 * Small size
 */
export const Small: Story = {
  args: {
    size: 'sm',
    status: 'success',
    label: 'Small',
  },
};

/**
 * Medium size (default)
 */
export const Medium: Story = {
  args: {
    size: 'md',
    status: 'success',
    label: 'Medium',
  },
};

/**
 * Large size
 */
export const Large: Story = {
  args: {
    size: 'lg',
    status: 'success',
    label: 'Large',
  },
};

/**
 * Dismissible badge with callback
 */
export const Dismissible: Story = {
  args: {
    status: 'success',
    label: 'Dismissible Badge',
    dismissible: true,
  },
  render: (args) => {
    const [visible, setVisible] = React.useState(true);
    if (!visible) return <div>Badge dismissed!</div>;
    return <StatusBadge {...args} onDismiss={() => setVisible(false)} />;
  },
};

/**
 * Badge with icon
 */
export const WithIcon: Story = {
  args: {
    status: 'success',
    label: 'Complete',
    icon: '✓',
  },
};

/**
 * All status variants in a row
 */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <StatusBadge status="success" label="Success" />
      <StatusBadge status="warning" label="Warning" />
      <StatusBadge status="error" label="Error" />
      <StatusBadge status="info" label="Info" />
      <StatusBadge status="neutral" label="Neutral" />
    </div>
  ),
};

/**
 * All sizes in a row
 */
export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
      <StatusBadge size="sm" status="info" label="Small" />
      <StatusBadge size="md" status="info" label="Medium" />
      <StatusBadge size="lg" status="info" label="Large" />
    </div>
  ),
};

/**
 * Dismissible variants
 */
export const DismissibleVariants: Story = {
  render: () => {
    const [dismissed, setDismissed] = React.useState<Record<string, boolean>>({});
    return (
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {!dismissed.success && (
          <StatusBadge
            status="success"
            label="Success"
            dismissible
            onDismiss={() => setDismissed((d) => ({ ...d, success: true }))}
          />
        )}
        {!dismissed.warning && (
          <StatusBadge
            status="warning"
            label="Warning"
            dismissible
            onDismiss={() => setDismissed((d) => ({ ...d, warning: true }))}
          />
        )}
        {!dismissed.error && (
          <StatusBadge
            status="error"
            label="Error"
            dismissible
            onDismiss={() => setDismissed((d) => ({ ...d, error: true }))}
          />
        )}
      </div>
    );
  },
};
