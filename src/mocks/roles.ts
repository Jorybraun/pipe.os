import type { Role } from '../types';

/**
 * Mock role/pipeline data for development.
 * This data structure matches the future Amplify Data schema.
 */
export const mockRoles: Role[] = [
  {
    id: 'role-1',
    title: 'Senior Frontend Engineer',
    department: 'Engineering',
    location: 'San Francisco, CA',
    status: 'ACTIVE',
    candidateCount: 12,
    avgScore: 85,
    stageCount: 4,
    createdAt: '2025-12-01T00:00:00Z',
    updatedAt: '2025-12-26T00:00:00Z',
    progress: 75,
  },
  {
    id: 'role-2',
    title: 'Backend Engineer',
    department: 'Engineering',
    location: 'Remote',
    status: 'ACTIVE',
    candidateCount: 8,
    avgScore: 78,
    stageCount: 3,
    createdAt: '2025-12-15T00:00:00Z',
    updatedAt: '2025-12-26T00:00:00Z',
    progress: 45,
  },
  {
    id: 'role-3',
    title: 'Product Designer',
    department: 'Design',
    location: 'New York, NY',
    status: 'DRAFT',
    candidateCount: 0,
    avgScore: 0,
    stageCount: 2,
    createdAt: '2025-12-20T00:00:00Z',
    updatedAt: '2025-12-26T00:00:00Z',
    progress: 0,
  },
  {
    id: 'role-4',
    title: 'Full Stack Engineer',
    department: 'Engineering',
    location: 'Austin, TX',
    status: 'ACTIVE',
    candidateCount: 15,
    avgScore: 82,
    stageCount: 5,
    createdAt: '2025-11-28T00:00:00Z',
    updatedAt: '2025-12-26T00:00:00Z',
    progress: 60,
  },
  {
    id: 'role-5',
    title: 'DevOps Engineer',
    department: 'Engineering',
    location: 'Seattle, WA',
    status: 'ARCHIVED',
    candidateCount: 5,
    avgScore: 88,
    stageCount: 3,
    createdAt: '2025-11-01T00:00:00Z',
    updatedAt: '2025-12-15T00:00:00Z',
    progress: 100,
  },
];

/**
 * Get a role by its ID.
 * @param id - The role ID to look up
 * @returns The role if found, undefined otherwise
 */
export function getRoleById(id: string): Role | undefined {
  return mockRoles.find((role) => role.id === id);
}

/**
 * Get all active roles.
 * @returns Array of roles with ACTIVE status
 */
export function getActiveRoles(): Role[] {
  return mockRoles.filter((role) => role.status === 'ACTIVE');
}

/**
 * Search roles by title.
 * @param query - Search query string
 * @returns Roles matching the search query
 */
export function searchRoles(query: string): Role[] {
  const lowerQuery = query.toLowerCase();
  return mockRoles.filter((role) =>
    role.title.toLowerCase().includes(lowerQuery) ||
    role.department.toLowerCase().includes(lowerQuery) ||
    role.location.toLowerCase().includes(lowerQuery)
  );
}
