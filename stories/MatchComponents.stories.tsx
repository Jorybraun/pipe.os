import type { Meta, StoryObj } from '@storybook/react-vite';
import { RequirementMatchCard } from '../src/components/Match/RequirementMatchCard';
import { EvidenceNodeBadge } from '../src/components/Match/EvidenceNodeBadge';
import { DealbreakerAlert } from '../src/components/Match/DealbreakerAlert';
import { RequirementMatchList } from '../src/components/Match/RequirementMatchList';

const meta: Meta = {
  title: 'Match/Components',
  parameters: {
    layout: 'padded',
  },
};

export default meta;

// ─── EvidenceNodeBadge ──────────────────────────────────────────────────────

export const EvidenceBadgeResume: StoryObj = {
  render: () => <EvidenceNodeBadge sourceType="resume" nodeType="Experience" />,
};

export const EvidenceBadgeCodeReview: StoryObj = {
  render: () => <EvidenceNodeBadge sourceType="code_review_session" nodeType="TechnicalDemonstration" />,
};

export const EvidenceBadgeCulture: StoryObj = {
  render: () => <EvidenceNodeBadge sourceType="culture_interview" nodeType="CulturalSignal" />,
};

// ─── DealbreakerAlert ───────────────────────────────────────────────────────

export const DealbreakerAlertStory: StoryObj = {
  render: () => (
    <DealbreakerAlert
      failure={{
        dealbreakerId: 'db-1',
        narrative: 'Must be legally authorized to work in the EU',
        matchedSimilarity: 0.32,
      }}
    />
  ),
};

// ─── RequirementMatchCard ───────────────────────────────────────────────────

const mockEvidence = [
  {
    nodeId: 'n1',
    nodeType: 'Experience' as const,
    narrative: 'Built event-streaming pipeline with Kafka at Stripe',
    similarity: 0.89,
    sourceType: 'resume',
    capturedAt: '2024-03-15T00:00:00Z',
  },
  {
    nodeId: 'n2',
    nodeType: 'TechnicalDemonstration' as const,
    narrative: 'Demonstrated async/await pattern understanding',
    similarity: 0.82,
    barsScore: 4.5,
    sourceType: 'code_review_session',
    capturedAt: '2024-04-02T00:00:00Z',
  },
  {
    nodeId: 'n3',
    nodeType: 'Skill' as const,
    narrative: 'Apache Kafka, RabbitMQ, Redis Streams',
    similarity: 0.71,
    sourceType: 'resume',
    capturedAt: '2024-03-15T00:00:00Z',
  },
];

export const RequirementCardExpanded: StoryObj = {
  render: () => (
    <RequirementMatchCard
      requirementText="Kafka & Event Streaming"
      score={0.89}
      weight={0.4}
      matchCount={3}
      evidence={mockEvidence}
      isExpanded
    />
  ),
};

export const RequirementCardCollapsed: StoryObj = {
  render: () => (
    <RequirementMatchCard
      requirementText="Kafka & Event Streaming"
      score={0.89}
      weight={0.4}
      matchCount={3}
      evidence={mockEvidence}
      isExpanded={false}
    />
  ),
};

export const RequirementCardLowScore: StoryObj = {
  render: () => (
    <RequirementMatchCard
      requirementText="Leadership & Mentoring"
      score={0.25}
      weight={0.3}
      matchCount={1}
      evidence={[
        {
          nodeId: 'n4',
          nodeType: 'Experience' as const,
          narrative: 'Mentored 2 junior developers during internship',
          similarity: 0.25,
          sourceType: 'resume',
          capturedAt: '2024-03-15T00:00:00Z',
        },
      ]}
      isExpanded
    />
  ),
};

export const RequirementCardNoEvidence: StoryObj = {
  render: () => (
    <RequirementMatchCard
      requirementText="Rust Systems Programming"
      score={0.0}
      weight={0.2}
      matchCount={0}
      evidence={[]}
      isExpanded
    />
  ),
};

// ─── RequirementMatchList ───────────────────────────────────────────────────

const mockRequirements = [
  {
    requirementId: 'r1',
    requirementText: 'Kafka & Event Streaming',
    score: 0.89,
    weight: 0.4,
    matchCount: 3,
    evidence: mockEvidence,
  },
  {
    requirementId: 'r2',
    requirementText: 'React & TypeScript',
    score: 0.72,
    weight: 0.3,
    matchCount: 2,
    evidence: [
      {
        nodeId: 'n4',
        nodeType: 'Experience' as const,
        narrative: 'Built design-system component library in React + TS',
        similarity: 0.78,
        sourceType: 'resume',
        capturedAt: '2024-03-15T00:00:00Z',
      },
      {
        nodeId: 'n5',
        nodeType: 'TechnicalDemonstration' as const,
        narrative: 'Implemented hooks-based state management pattern',
        similarity: 0.65,
        sourceType: 'code_review_session',
        capturedAt: '2024-04-02T00:00:00Z',
      },
    ],
  },
  {
    requirementId: 'r3',
    requirementText: 'Leadership & Mentoring',
    score: 0.45,
    weight: 0.2,
    matchCount: 1,
    evidence: [
      {
        nodeId: 'n6',
        nodeType: 'Experience' as const,
        narrative: 'Led a team of 3 engineers for 6 months',
        similarity: 0.45,
        sourceType: 'resume',
        capturedAt: '2024-03-15T00:00:00Z',
      },
    ],
  },
  {
    requirementId: 'r4',
    requirementText: 'Rust Systems Programming',
    score: 0.12,
    weight: 0.1,
    matchCount: 0,
    evidence: [],
  },
];

export const RequirementMatchListStory: StoryObj = {
  render: () => (
    <RequirementMatchList
      overallScore={0.72}
      requirementMatches={mockRequirements}
      dealbreakerFailures={[
        {
          dealbreakerId: 'db-1',
          narrative: 'Must be legally authorized to work in the EU',
          matchedSimilarity: 0.32,
        },
      ]}
    />
  ),
};

export const RequirementMatchListNoDealbreakers: StoryObj = {
  render: () => (
    <RequirementMatchList
      overallScore={0.87}
      requirementMatches={mockRequirements}
      dealbreakerFailures={[]}
    />
  ),
};
