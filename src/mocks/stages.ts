import type { Stage } from "../types";

/**
 * Mock stage data for development.
 * Matches the D1 schema (see workers/api/migrations/).
 */
export const mockStages: Stage[] = [
  {
    id: "stage-1",
    pipelineId: "role-1",
    name: "Code Review",
    type: "CODE_REVIEW",
    order: 1,
    status: "COMPLETED",
    score: 85,
    progress: 100,
    icon: "FileText",
  },
  {
    id: "stage-2",
    pipelineId: "role-1",
    name: "Voice Interview",
    type: "VOICE_INTERVIEW",
    order: 2,
    status: "ACTIVE",
    score: 82,
    progress: 60,
    icon: "MessageSquare",
  },
  {
    id: "stage-3",
    pipelineId: "role-1",
    name: "System Design",
    type: "PLANNING",
    order: 3,
    status: "PENDING",
    progress: 0,
    icon: "GitBranch",
  },
  {
    id: "stage-4",
    pipelineId: "role-1",
    name: "Final Interview",
    type: "VOICE_INTERVIEW",
    order: 4,
    status: "PENDING",
    progress: 0,
    icon: "Users",
  },
];

/**
 * Get stages for a specific pipeline.
 * @param pipelineId - The pipeline ID
 * @returns Array of stages for this pipeline, sorted by order
 */
export function getStagesByPipelineId(pipelineId: string): Stage[] {
  return mockStages
    .filter((stage) => stage.pipelineId === pipelineId)
    .sort((a, b) => a.order - b.order);
}

/**
 * Get a stage by its ID.
 * @param id - The stage ID to look up
 * @returns The stage if found, undefined otherwise
 */
export function getStageById(id: string): Stage | undefined {
  return mockStages.find((stage) => stage.id === id);
}
