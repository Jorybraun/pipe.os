/**
 * TypeScript type definitions for mock data.
 * These types will align with future Amplify Data schema for easy migration.
 */

export interface Role {
  id: string;
  title: string;
  department: string;
  location: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  candidateCount: number;
  avgScore: number;
  stageCount: number;
  createdAt: string;
  updatedAt: string;
  progress: number; // 0-100
}

export interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  type: 'CODE_REVIEW' | 'VOICE_INTERVIEW' | 'PLANNING';
  order: number;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED';
  score?: number;
  progress: number; // 0-100
  icon: string; // lucide icon name
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  company?: string;
  location?: string;
  initials: string;
  score: number;
  signal: 'STRONG' | 'YES' | 'MAYBE' | 'NO';
  stages: CandidateStage[];
  createdAt: string;
}

export interface CandidateStage {
  id: string;
  stageId: string;
  candidateId: string;
  name: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  score?: number;
  completedAt?: string;
}

export interface Screening {
  id: string;
  candidateId: string;
  questions: ScreeningQuestion[];
  currentQuestionIndex: number;
  progress: number;
}

export interface ScreeningQuestion {
  id: string;
  question: string;
  type: 'VIDEO' | 'TEXT' | 'CODE';
  duration?: number; // seconds for video questions
  answered: boolean;
}
