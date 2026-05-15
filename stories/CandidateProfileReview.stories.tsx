import type { Meta, StoryObj } from '@storybook/react';
import { CandidateProfileReview } from '../src/components/Assessment/CandidateProfileReview';

const meta: Meta<typeof CandidateProfileReview> = {
  title: 'Assessment/CandidateProfileReview',
  component: CandidateProfileReview,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof CandidateProfileReview>;

const mockProfile = {
  careerTimeline: [
    {
      company: 'Stripe',
      role: 'Senior Backend Engineer',
      startDate: '2021-03',
      endDate: null,
      durationMonths: 42,
      teamSize: 8,
      scope: 'Payments infrastructure',
      keyAccomplishments: ['Reduced latency by 40%', 'Led migration to microservices'],
      technologies: ['Go', 'PostgreSQL', 'Kafka', 'Kubernetes'],
    },
    {
      company: 'Meta',
      role: 'Software Engineer',
      startDate: '2018-06',
      endDate: '2021-02',
      durationMonths: 32,
      teamSize: 12,
      scope: 'Ads ranking',
      keyAccomplishments: ['Shipped ranking model v3', 'Mentored 2 interns'],
      technologies: ['Python', 'PyTorch', 'C++'],
    },
  ],
  skillsInventory: [
    { skill: 'Go', proficiency: 'expert' as const, evidence: 'Built core payment services at Stripe', yearsExperience: 5 },
    { skill: 'Python', proficiency: 'working' as const, evidence: 'ML pipelines at Meta', yearsExperience: 4 },
    { skill: 'React', proficiency: 'exposure' as const, evidence: 'Internal dashboards', yearsExperience: 2 },
  ],
  projectPortfolio: [
    {
      name: 'Payment Orchestration Layer',
      description: 'Rebuilt the payment routing system to support multiple processors with fallback logic.',
      technologies: ['Go', 'gRPC', 'Redis'],
      outcome: '99.99% uptime, $2M saved in processor fees',
    },
  ],
  workingStyle: {
    collaboration: 'Prefers pair programming for complex features, async for routine work',
    autonomy: 'Thrives with clear goals and minimal micromanagement',
    communication: 'Writes detailed RFCs, concise Slack messages',
    decisionMaking: 'Data-driven, seeks input from stakeholders',
    feedbackReceptiveness: 'Actively requests 1:1s, takes critical feedback well',
  },
  motivation: {
    primaryDrivers: ['Technical depth', 'Impact', 'Autonomy'],
    dealbreakers: ['Toxic culture', 'No growth path'],
    growthTrajectory: 'Staff engineer within 2 years, then engineering management',
  },
  behavioralEvidence: [
    { dimension: 'ownership', evidence: 'Took initiative to fix a critical bug during on-call without being asked', confidence: 0.92 },
    { dimension: 'collaboration', evidence: 'Coordinated with 3 teams to deliver cross-functional feature', confidence: 0.85 },
  ],
};

export const Default: Story = {
  args: {
    profile: mockProfile,
    onConfirm: () => console.log('confirmed'),
    onEdit: () => console.log('edit requested'),
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: '100vh', background: '#0c0c0e' }}>
        <Story />
      </div>
    ),
  ],
};
