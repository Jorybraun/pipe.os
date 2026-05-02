import { describe, it, expect } from 'vitest';
import { checkQuestion, buildGuardNudge } from '../guard';

describe('question guard', () => {
  describe('role_confusion_responsibilities', () => {
    it('blocks "your primary responsibilities as a team member for this role"', () => {
      const result = checkQuestion({
        text: "What are your primary responsibilities as a team member for this Senior Frontend Engineer role?",
        participantRole: 'TEAM_MEMBER',
      });
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.ruleId === 'role_confusion_responsibilities')).toBe(true);
    });

    it('blocks "what are your responsibilities for this role"', () => {
      const result = checkQuestion({
        text: "What are your responsibilities for this role?",
        participantRole: 'HIRING_MANAGER',
      });
      expect(result.passed).toBe(false);
    });

    it('passes a normal team culture question', () => {
      const result = checkQuestion({
        text: "What does a typical week look like on the team?",
        participantRole: 'TEAM_MEMBER',
      });
      expect(result.passed).toBe(true);
    });
  });

  describe('role_confusion_self_referential', () => {
    it('blocks "You are a team member, what are your... for this engineer"', () => {
      const result = checkQuestion({
        text: "You're a team member, what are your main tasks for this Senior Frontend Engineer?",
        participantRole: 'TEAM_MEMBER',
      });
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.ruleId === 'role_confusion_self_referential')).toBe(true);
    });

    it('passes a question about team dynamics', () => {
      const result = checkQuestion({
        text: "How does the team handle disagreements during code review?",
        participantRole: 'TEAM_MEMBER',
      });
      expect(result.passed).toBe(true);
    });
  });

  describe('brevity', () => {
    it('blocks questions over 30 words', () => {
      const result = checkQuestion({
        text: "When you think about the long-term trajectory of this role and how it might evolve over the next couple of years, what skills do you think will become most important for success?",
      });
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.ruleId === 'brevity_hard_limit')).toBe(true);
    });

    it('warns on questions over 20 words', () => {
      const result = checkQuestion({
        text: "When something breaks in production, what is the very first thing that the team does to resolve it quickly and effectively?",
      });
      expect(result.passed).toBe(true); // warn only
      expect(result.violations.some((v) => v.ruleId === 'brevity_soft_limit')).toBe(true);
    });

    it('passes concise questions', () => {
      const result = checkQuestion({
        text: "What's the first thing the team does when production breaks?",
      });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('ack_stilted_role_reference', () => {
    it('warns on robotic acknowledgment', () => {
      const result = checkQuestion({
        text: "What does a typical week look like?",
        acknowledgment: "You're a team member, which helps me understand the role's scope and responsibilities.",
        participantRole: 'TEAM_MEMBER',
      });
      expect(result.passed).toBe(true); // warn only
      expect(result.violations.some((v) => v.ruleId === 'ack_stilted_role_reference')).toBe(true);
    });

    it('passes natural acknowledgment', () => {
      const result = checkQuestion({
        text: "What does a typical week look like?",
        acknowledgment: "A 12-person platform team is substantial — that gives me a good sense of scale.",
        participantRole: 'TEAM_MEMBER',
      });
      expect(result.violations.every((v) => v.ruleId !== 'ack_stilted_role_reference')).toBe(true);
    });
  });

  describe('redundancy', () => {
    it('warns on near-duplicate questions', () => {
      const result = checkQuestion({
        text: "How does your team usually handle code review?",
        previousQuestions: ["How does your team handle code review?"],
      });
      expect(result.passed).toBe(true); // warn only
      expect(result.violations.some((v) => v.ruleId === 'redundancy_near_duplicate')).toBe(true);
    });

    it('passes on different questions about the same topic', () => {
      const result = checkQuestion({
        text: "What does a truly finished PR look like on your team?",
        previousQuestions: ["How does your team handle code review?"],
      });
      expect(result.violations.every((v) => v.ruleId !== 'redundancy_near_duplicate')).toBe(true);
    });
  });

  describe('leading_question', () => {
    it('warns on questions with leading phrasing', () => {
      const result = checkQuestion({
        text: "Your team probably values clean code, right?",
      });
      expect(result.passed).toBe(true);
      expect(result.violations.some((v) => v.ruleId === 'leading_question')).toBe(true);
    });
  });

  describe('early_turn_meta_question', () => {
    it('warns on abstract scope questions in turn 1', () => {
      const result = checkQuestion({
        text: "Can you give me an overview of this role's scope and responsibilities?",
        previousQuestions: [],
      });
      expect(result.passed).toBe(true);
      expect(result.violations.some((v) => v.ruleId === 'early_turn_meta_question')).toBe(true);
    });

    it('passes the same question in later turns', () => {
      const result = checkQuestion({
        text: "Can you give me an overview of this role's scope and responsibilities?",
        previousQuestions: ["What's the team size?", "How long has the role been open?"],
      });
      expect(result.violations.every((v) => v.ruleId !== 'early_turn_meta_question')).toBe(true);
    });
  });

  describe('buildGuardNudge', () => {
    it('returns empty string when passed', () => {
      const result = checkQuestion({ text: "What does a typical week look like?" });
      expect(buildGuardNudge(result)).toBe('');
    });

    it('includes block reasons in nudge', () => {
      const result = checkQuestion({
        text: "What are your primary responsibilities as a team member for this Senior Frontend Engineer role?",
        participantRole: 'TEAM_MEMBER',
      });
      const nudge = buildGuardNudge(result);
      expect(nudge).toContain('GUARD FAILURE');
      expect(nudge).toContain('REJECTED');
      expect(nudge).toContain('role_confusion_responsibilities');
    });
  });

  describe('combined violations', () => {
    it('catches both role confusion and stilted ack in the user example', () => {
      const result = checkQuestion({
        text: "What are your primary responsibilities as a team member for this Senior Frontend Engineer role?",
        acknowledgment: "You're a team member, which helps me understand the role's scope and responsibilities.",
        participantRole: 'TEAM_MEMBER',
      });
      expect(result.passed).toBe(false);
      const ruleIds = result.violations.map((v) => v.ruleId);
      expect(ruleIds).toContain('role_confusion_responsibilities');
      expect(ruleIds).toContain('ack_stilted_role_reference');
    });
  });
});
