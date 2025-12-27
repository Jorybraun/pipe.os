import type { Candidate } from '../types';

/**
 * Mock candidate data for development.
 * This data structure matches the future Amplify Data schema.
 */
export const mockCandidates: Candidate[] = [
  {
    id: 'candidate-1',
    name: 'Alex Johnson',
    email: 'alex.johnson@example.com',
    company: 'TechCorp',
    location: 'San Francisco, CA',
    initials: 'AJ',
    score: 92,
    signal: 'STRONG',
    stages: [
      {
        id: 'cs-1',
        stageId: 'stage-1',
        candidateId: 'candidate-1',
        name: 'Code Review',
        status: 'COMPLETED',
        score: 95,
        completedAt: '2025-12-20T00:00:00Z',
      },
      {
        id: 'cs-2',
        stageId: 'stage-2',
        candidateId: 'candidate-1',
        name: 'Voice Interview',
        status: 'IN_PROGRESS',
      },
      {
        id: 'cs-3',
        stageId: 'stage-3',
        candidateId: 'candidate-1',
        name: 'System Design',
        status: 'PENDING',
      },
    ],
    createdAt: '2025-12-15T00:00:00Z',
  },
  {
    id: 'candidate-2',
    name: 'Morgan Smith',
    email: 'morgan.smith@example.com',
    company: 'StartupXYZ',
    location: 'Austin, TX',
    initials: 'MS',
    score: 78,
    signal: 'YES',
    stages: [
      {
        id: 'cs-4',
        stageId: 'stage-1',
        candidateId: 'candidate-2',
        name: 'Code Review',
        status: 'COMPLETED',
        score: 78,
        completedAt: '2025-12-22T00:00:00Z',
      },
      {
        id: 'cs-5',
        stageId: 'stage-2',
        candidateId: 'candidate-2',
        name: 'Voice Interview',
        status: 'PENDING',
      },
    ],
    createdAt: '2025-12-18T00:00:00Z',
  },
  {
    id: 'candidate-3',
    name: 'Taylor Chen',
    email: 'taylor.chen@example.com',
    company: 'BigTech Inc',
    location: 'Seattle, WA',
    initials: 'TC',
    score: 88,
    signal: 'STRONG',
    stages: [
      {
        id: 'cs-6',
        stageId: 'stage-1',
        candidateId: 'candidate-3',
        name: 'Code Review',
        status: 'COMPLETED',
        score: 90,
        completedAt: '2025-12-21T00:00:00Z',
      },
      {
        id: 'cs-7',
        stageId: 'stage-2',
        candidateId: 'candidate-3',
        name: 'Voice Interview',
        status: 'COMPLETED',
        score: 85,
        completedAt: '2025-12-24T00:00:00Z',
      },
      {
        id: 'cs-8',
        stageId: 'stage-3',
        candidateId: 'candidate-3',
        name: 'System Design',
        status: 'IN_PROGRESS',
      },
    ],
    createdAt: '2025-12-16T00:00:00Z',
  },
  {
    id: 'candidate-4',
    name: 'Jordan Lee',
    email: 'jordan.lee@example.com',
    location: 'New York, NY',
    initials: 'JL',
    score: 65,
    signal: 'MAYBE',
    stages: [
      {
        id: 'cs-9',
        stageId: 'stage-1',
        candidateId: 'candidate-4',
        name: 'Code Review',
        status: 'COMPLETED',
        score: 65,
        completedAt: '2025-12-23T00:00:00Z',
      },
    ],
    createdAt: '2025-12-19T00:00:00Z',
  },
];

/**
 * Get a candidate by their ID.
 * @param id - The candidate ID to look up
 * @returns The candidate if found, undefined otherwise
 */
export function getCandidateById(id: string): Candidate | undefined {
  return mockCandidates.find((candidate) => candidate.id === id);
}

/**
 * Get candidates for a specific pipeline/role.
 * @param _pipelineId - The pipeline ID (unused in mock implementation)
 * @returns Array of candidates in this pipeline
 */
export function getCandidatesByPipelineId(_pipelineId: string): Candidate[] {
  // In a real implementation, this would filter by pipeline relationship
  // For now, return all candidates as they're associated with role-1
  return mockCandidates;
}
