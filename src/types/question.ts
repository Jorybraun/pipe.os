/**
 * Question type definitions for the screening system.
 */

/**
 * Available question types for screening.
 */
export type QuestionType = 'technical' | 'behavioral' | 'motivation' | 'situational';

/**
 * Question status in the pipeline.
 */
export type QuestionStatus = 'draft' | 'active' | 'archived';

/**
 * Rubric dimension for scoring candidate responses.
 */
export interface RubricDimension {
  id: number;
  name: string;
  weight: number;
  description: string;
}

/**
 * Core question data.
 */
export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  timeLimit: number; // in minutes
  isRequired: boolean;
  hasVideo: boolean;
  videoDuration?: number; // in seconds
  rubric: RubricDimension[];
  settings: QuestionSettings;
  status: QuestionStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Question settings.
 */
export interface QuestionSettings {
  allowRerecording: boolean;
  preparationTime: number; // in seconds
  autoAdvance: boolean;
}

/**
 * Form state for creating/editing a question.
 */
export interface QuestionFormData {
  text: string;
  type: QuestionType;
  timeLimit: number;
  isRequired: boolean;
  hasVideo: boolean;
  videoDuration: number;
  rubric: RubricDimension[];
  settings: QuestionSettings;
}
