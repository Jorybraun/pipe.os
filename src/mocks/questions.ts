import type { Question, QuestionType, RubricDimension } from '../types/question';

/**
 * Generates rubric dimensions for a question based on type and count.
 */
function generateRubric(count: number, type: QuestionType): RubricDimension[] {
  const technicalDimensions = [
    { name: 'Problem Understanding', description: 'Ability to understand and clarify the problem' },
    { name: 'Solution Design', description: 'Quality of the proposed solution architecture' },
    { name: 'Code Quality', description: 'Code structure, readability, and best practices' },
    { name: 'Edge Case Handling', description: 'Consideration of edge cases and error handling' },
    { name: 'Complexity Analysis', description: 'Understanding of time and space complexity' },
    { name: 'Scalability', description: 'Consideration of scale and performance' },
    { name: 'Trade-off Analysis', description: 'Understanding of technical trade-offs' },
  ];

  const behavioralDimensions = [
    { name: 'Clarity', description: 'How clearly the candidate explains their thinking' },
    { name: 'Depth', description: 'Depth of analysis and critical thinking' },
    { name: 'Relevance', description: 'Relevance to the question asked' },
    { name: 'Impact', description: 'Demonstrated impact of the decision or action' },
    { name: 'Self-awareness', description: 'Reflection and learning from the experience' },
  ];

  const motivationDimensions = [
    { name: 'Authenticity', description: 'Genuineness and honesty in response' },
    { name: 'Alignment', description: 'Alignment with role and company values' },
    { name: 'Enthusiasm', description: 'Passion and energy for the opportunity' },
  ];

  const baseDimensions =
    type === 'technical'
      ? technicalDimensions
      : type === 'behavioral'
        ? behavioralDimensions
        : motivationDimensions;

  const selectedDimensions = baseDimensions.slice(0, count);
  const weight = Math.floor(100 / count);
  const lastWeight = 100 - weight * (count - 1);

  return selectedDimensions.map((dim, index) => ({
    id: index + 1,
    name: dim.name,
    weight: index === count - 1 ? lastWeight : weight,
    description: dim.description,
  }));
}

/**
 * Mock questions data matching the Question interface.
 *
 * Each question includes:
 * - Full Question interface fields
 * - Generated rubric dimensions based on type
 * - Mock settings and timestamps
 */
export const questions: Question[] = [
  {
    id: 'question-1',
    text: 'Tell me about a time when you made short-term sacrifices for long-term gains.',
    type: 'behavioral' as QuestionType,
    timeLimit: 3,
    isRequired: true,
    hasVideo: false,
    videoDuration: 0,
    rubric: generateRubric(4, 'behavioral'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:00:00Z'),
    updatedAt: new Date('2025-01-15T10:00:00Z'),
  },
  {
    id: 'question-2',
    text: 'Find the minimum characters to insert to make a string a palindrome.',
    type: 'technical' as QuestionType,
    timeLimit: 45,
    isRequired: true,
    hasVideo: true,
    videoDuration: 180,
    rubric: generateRubric(5, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 60,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:05:00Z'),
    updatedAt: new Date('2025-01-15T10:05:00Z'),
  },
  {
    id: 'question-3',
    text: 'Design Google Docs.',
    type: 'technical' as QuestionType,
    timeLimit: 60,
    isRequired: true,
    hasVideo: true,
    videoDuration: 240,
    rubric: generateRubric(6, 'technical'),
    settings: {
      allowRerecording: false,
      preparationTime: 120,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:10:00Z'),
    updatedAt: new Date('2025-01-15T10:10:00Z'),
  },
  {
    id: 'question-4',
    text: 'Why do you think we should not hire you?',
    type: 'behavioral' as QuestionType,
    timeLimit: 2,
    isRequired: false,
    hasVideo: false,
    videoDuration: 0,
    rubric: generateRubric(3, 'behavioral'),
    settings: {
      allowRerecording: true,
      preparationTime: 15,
      autoAdvance: true,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:15:00Z'),
    updatedAt: new Date('2025-01-15T10:15:00Z'),
  },
  {
    id: 'question-5',
    text: 'Given a sorted array of integers (which may include negatives), return the squares of the numbers in sorted order. As a follow-up, find the k-th smallest squared value.',
    type: 'technical' as QuestionType,
    timeLimit: 30,
    isRequired: true,
    hasVideo: true,
    videoDuration: 150,
    rubric: generateRubric(5, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 45,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:20:00Z'),
    updatedAt: new Date('2025-01-15T10:20:00Z'),
  },
  {
    id: 'question-6',
    text: 'Why do you want to switch jobs now?',
    type: 'motivation' as QuestionType,
    timeLimit: 3,
    isRequired: true,
    hasVideo: true,
    videoDuration: 120,
    rubric: generateRubric(3, 'motivation'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:25:00Z'),
    updatedAt: new Date('2025-01-15T10:25:00Z'),
  },
  {
    id: 'question-7',
    text: 'Tell me about a time you made a mistake.',
    type: 'behavioral' as QuestionType,
    timeLimit: 5,
    isRequired: true,
    hasVideo: false,
    videoDuration: 0,
    rubric: generateRubric(4, 'behavioral'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:30:00Z'),
    updatedAt: new Date('2025-01-15T10:30:00Z'),
  },
  {
    id: 'question-8',
    text: 'Given an array of integers and a number N, find the length of the longest contiguous subarray such that the difference between any two elements in the subarray is less than N.',
    type: 'technical' as QuestionType,
    timeLimit: 40,
    isRequired: false,
    hasVideo: true,
    videoDuration: 200,
    rubric: generateRubric(5, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 60,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:35:00Z'),
    updatedAt: new Date('2025-01-15T10:35:00Z'),
  },
  {
    id: 'question-9',
    text: 'Design an inference batching system for a single GPU that can handle up to 100 inputs per batch while users wait synchronously, maximizing utilization under compute constraints.',
    type: 'technical' as QuestionType,
    timeLimit: 60,
    isRequired: true,
    hasVideo: true,
    videoDuration: 300,
    rubric: generateRubric(7, 'technical'),
    settings: {
      allowRerecording: false,
      preparationTime: 120,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:40:00Z'),
    updatedAt: new Date('2025-01-15T10:40:00Z'),
  },
  {
    id: 'question-10',
    text: 'Design a system to log messages in order.',
    type: 'technical' as QuestionType,
    timeLimit: 50,
    isRequired: true,
    hasVideo: false,
    videoDuration: 0,
    rubric: generateRubric(5, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 90,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:45:00Z'),
    updatedAt: new Date('2025-01-15T10:45:00Z'),
  },
  {
    id: 'question-11',
    text: 'Edit distance.',
    type: 'technical' as QuestionType,
    timeLimit: 35,
    isRequired: true,
    hasVideo: true,
    videoDuration: 180,
    rubric: generateRubric(4, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 45,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:50:00Z'),
    updatedAt: new Date('2025-01-15T10:50:00Z'),
  },
  {
    id: 'question-12',
    text: 'Tell me about a time you disagreed with someone and how you resolved it.',
    type: 'behavioral' as QuestionType,
    timeLimit: 5,
    isRequired: true,
    hasVideo: true,
    videoDuration: 240,
    rubric: generateRubric(5, 'behavioral'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T10:55:00Z'),
    updatedAt: new Date('2025-01-15T10:55:00Z'),
  },
  {
    id: 'question-13',
    text: 'Design a document processing pipeline.',
    type: 'technical' as QuestionType,
    timeLimit: 55,
    isRequired: false,
    hasVideo: false,
    videoDuration: 0,
    rubric: generateRubric(6, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 90,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:00:00Z'),
    updatedAt: new Date('2025-01-15T11:00:00Z'),
  },
  {
    id: 'question-14',
    text: 'Find the closest palindrome of a given number.',
    type: 'technical' as QuestionType,
    timeLimit: 30,
    isRequired: true,
    hasVideo: true,
    videoDuration: 165,
    rubric: generateRubric(4, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 45,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:05:00Z'),
    updatedAt: new Date('2025-01-15T11:05:00Z'),
  },
  {
    id: 'question-15',
    text: 'Design a distributed logging system.',
    type: 'technical' as QuestionType,
    timeLimit: 60,
    isRequired: true,
    hasVideo: true,
    videoDuration: 280,
    rubric: generateRubric(6, 'technical'),
    settings: {
      allowRerecording: false,
      preparationTime: 120,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:10:00Z'),
    updatedAt: new Date('2025-01-15T11:10:00Z'),
  },
  {
    id: 'question-16',
    text: 'Tell me about a time you took a calculated risk when speed was critical.',
    type: 'behavioral' as QuestionType,
    timeLimit: 3,
    isRequired: true,
    hasVideo: true,
    videoDuration: 135,
    rubric: generateRubric(4, 'behavioral'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:15:00Z'),
    updatedAt: new Date('2025-01-15T11:15:00Z'),
  },
  {
    id: 'question-17',
    text: 'Maximum Number of Visible Points.',
    type: 'technical' as QuestionType,
    timeLimit: 25,
    isRequired: false,
    hasVideo: false,
    videoDuration: 0,
    rubric: generateRubric(4, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: true,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:20:00Z'),
    updatedAt: new Date('2025-01-15T11:20:00Z'),
  },
  {
    id: 'question-18',
    text: 'Reverse a linked list.',
    type: 'technical' as QuestionType,
    timeLimit: 20,
    isRequired: true,
    hasVideo: true,
    videoDuration: 90,
    rubric: generateRubric(3, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:25:00Z'),
    updatedAt: new Date('2025-01-15T11:25:00Z'),
  },
  {
    id: 'question-19',
    text: 'Tell me about a time when you solved a complex problem and how you went about it.',
    type: 'behavioral' as QuestionType,
    timeLimit: 5,
    isRequired: true,
    hasVideo: true,
    videoDuration: 200,
    rubric: generateRubric(5, 'behavioral'),
    settings: {
      allowRerecording: true,
      preparationTime: 30,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:30:00Z'),
    updatedAt: new Date('2025-01-15T11:30:00Z'),
  },
  {
    id: 'question-20',
    text: 'Design Instagram.',
    type: 'technical' as QuestionType,
    timeLimit: 60,
    isRequired: true,
    hasVideo: false,
    videoDuration: 0,
    rubric: generateRubric(7, 'technical'),
    settings: {
      allowRerecording: true,
      preparationTime: 120,
      autoAdvance: false,
    },
    status: 'active',
    createdAt: new Date('2025-01-15T11:35:00Z'),
    updatedAt: new Date('2025-01-15T11:35:00Z'),
  },
];

/**
 * Helper function to find a question by ID.
 */
export function getQuestionById(id: string): Question | undefined {
  return questions.find((q) => q.id === id);
}
