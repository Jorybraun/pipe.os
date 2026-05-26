import { describe, it, expect } from 'vitest';
import { buildRoleBrief, buildRoleInstruction } from '../roleAdapter';
import type { ParticipantRole } from '../../../../types';

describe('roleAdapter', () => {
  describe('buildRoleBrief', () => {
    it('builds brief for HIRING_MANAGER with full baseline', () => {
      const brief = buildRoleBrief(
        {
          title: 'Senior Backend Engineer',
          companyName: 'Acme Corp',
          teamSize: 5,
          techStack: ['Node.js', 'PostgreSQL', 'Redis'],
        },
        'HIRING_MANAGER',
      );

      expect(brief.description).toContain('Hiring Manager');
      expect(brief.description).toContain('Acme Corp');
      expect(brief.description).toContain('Senior Backend Engineer');
      expect(brief.description).toContain('5-person team');
      expect(brief.description).toContain('Node.js');
      expect(brief.prioritize).toContain('Codebase & architecture');
      expect(brief.avoid).toContain('Recruiting process details');
      expect(brief.tone).toContain('Direct and technical');
    });

    it('builds brief for TEAM_MEMBER', () => {
      const brief = buildRoleBrief(
        { title: 'Frontend Engineer' },
        'TEAM_MEMBER',
      );

      expect(brief.description).toContain('Team Member');
      expect(brief.description).toContain('Frontend Engineer');
      expect(brief.prioritize).toContain('Their lived experience');
      expect(brief.avoid).toContain('Hiring process');
    });

    it('builds brief for INTERNAL_RECRUITER', () => {
      const brief = buildRoleBrief(
        { title: 'Data Engineer', companyName: 'DataCo' },
        'INTERNAL_RECRUITER',
      );

      expect(brief.description).toContain('Internal Recruiter');
      expect(brief.description).toContain('DataCo');
      expect(brief.prioritize).toContain('What the HM emphasized');
    });

    it('builds brief for EXTERNAL_RECRUITER', () => {
      const brief = buildRoleBrief(
        { title: 'DevOps Engineer' },
        'EXTERNAL_RECRUITER',
      );

      expect(brief.description).toContain('External Recruiter');
      expect(brief.prioritize).toContain('Client brief');
    });

    it('handles missing role gracefully', () => {
      const brief = buildRoleBrief({ title: 'Engineer' }, null);
      expect(brief.description).toContain('participant');
      expect(brief.prioritize).toContain('General context');
    });

    it('handles empty baseline gracefully', () => {
      const brief = buildRoleBrief({}, 'HIRING_MANAGER');
      expect(brief.description).toContain('Hiring Manager');
      expect(brief.description).not.toContain('undefined');
    });

    it('extracts seniority from title', () => {
      const senior = buildRoleBrief({ title: 'Senior Engineer' }, 'HIRING_MANAGER');
      expect(senior.description).toContain('senior');

      const staff = buildRoleBrief({ title: 'Staff Engineer' }, 'HIRING_MANAGER');
      expect(staff.description).toContain('staff+');

      const junior = buildRoleBrief({ title: 'Junior Developer' }, 'HIRING_MANAGER');
      expect(junior.description).toContain('junior');
    });

    it('handles techStack as string', () => {
      const brief = buildRoleBrief(
        { techStack: 'React, TypeScript' },
        'HIRING_MANAGER',
      );
      expect(brief.description).toContain('React');
      expect(brief.description).toContain('TypeScript');
    });
  });

  describe('buildRoleInstruction', () => {
    it('builds instruction block', () => {
      const instruction = buildRoleInstruction(
        { title: 'Engineer', companyName: 'TestCo' },
        'HIRING_MANAGER',
      );

      expect(instruction).toContain('Interviewee Context');
      expect(instruction).toContain('TestCo');
      expect(instruction).toContain('Prioritize:');
      expect(instruction).toContain('Avoid:');
      expect(instruction).toContain('Tone:');
    });
  });
});
