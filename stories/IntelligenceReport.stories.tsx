import type { Meta, StoryObj } from '@storybook/react';
import { IntelligenceReportRenderer, IntelligenceBlockConfig } from '../src/components/Analytics/IntelligenceReportBlock';

const meta: Meta<typeof IntelligenceReportRenderer> = {
  title: 'Analytics/IntelligenceReport',
  component: IntelligenceReportRenderer,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div style={{ padding: '40px', background: '#0c0c0e', minHeight: '100vh' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof IntelligenceReportRenderer>;

const mockBlocks: IntelligenceBlockConfig[] = [
  {
    id: '1',
    type: 'HIRE_RECOMMENDATION',
    title: 'Final Verdict',
    width: 'half',
    priority: 1,
    data: {
      score: 88,
      signal: 'STRONG'
    }
  },
  {
    id: '2',
    type: 'EXECUTIVE_SUMMARY',
    title: 'Executive Summary',
    width: 'full',
    priority: 0,
    data: {
      summary: "Alex is a highly analytical engineer with exceptional attention to detail in code reviews. They identified 100% of the critical bugs in the Slopify challenge and provided actionable, high-quality feedback. Their communication during the follow-up session demonstrated deep architectural reasoning."
    }
  },
  {
    id: '3',
    type: 'STRENGTHS_CONCERNS',
    title: 'Evaluation Highlights',
    width: 'full',
    priority: 2,
    data: {
      strengths: [
        "Flawless identification of security vulnerabilities",
        "Clear and empathetic communication style",
        "Deep understanding of React performance patterns"
      ],
      concerns: [
        "Slightly slower completion time than average",
        "Could provide more detail on testing strategies"
      ]
    }
  },
  {
    id: '4',
    type: 'PERFORMANCE_TIMELINE',
    title: 'Stage Performance',
    width: 'full',
    priority: 3,
    data: {
      points: [
        { label: 'Screening', value: 95 },
        { label: 'Code Review', value: 88 },
        { label: 'Implementation', value: 82 },
        { label: 'Final Interview', value: 90 }
      ]
    }
  },
  {
    id: '5',
    type: 'KEY_FINDINGS',
    title: 'Technical Observations',
    width: 'full',
    priority: 4,
    data: {
      findings: [
        { title: 'Concurrent State Logic', detail: 'Alex correctly identified a race condition in the async state update logic that most candidates miss.' },
        { title: 'Security: SQL Injection', detail: 'Caught a subtle unsanitized input in the legacy database connector module.' },
        { title: 'API Design', detail: 'Proposed a superior RESTful structure for the coupon management endpoints.' }
      ]
    }
  }
];

export const DynamicReport: Story = {
  args: {
    blocks: mockBlocks,
  },
};
