import { describe, it, expect } from 'vitest';
import {
  extractExperiences,
  extractEducationBlocks,
  extractCredentials,
  extractProjects,
  type ParsedCV,
} from '../../cvParser';

describe('extractExperiences', () => {
  it('extracts basic work history', () => {
    const text = `
EXPERIENCE

Acme Corp
Senior Engineer — January 2022 – Present
Led backend migration to microservices using TypeScript and Kafka.
Mentored junior engineers and improved CI/CD pipelines.

Beta Inc
Engineer — June 2020 – December 2021
Built payment integration with Stripe.
`;
    const result = extractExperiences(text);
    expect(result).toHaveLength(2);
    expect(result[0].company).toBe('Acme Corp');
    expect(result[0].role).toBe('Senior Engineer');
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].description).toContain('backend migration');
    expect(result[1].company).toBe('Beta Inc');
    expect(result[1].role).toBe('Engineer');
  });

  it('handles missing experience section', () => {
    const text = 'Just some random text about skills and education.';
    expect(extractExperiences(text)).toHaveLength(0);
  });

  it('parses date ranges with slashes', () => {
    const text = `
Work History

Gamma LLC
Developer 01/2020 – 06/2022
Built frontend with React.
`;
    const result = extractExperiences(text);
    expect(result).toHaveLength(1);
    expect(result[0].startDate).toBe('2020');
    expect(result[0].endDate).toBe('2022');
  });
});

describe('extractEducationBlocks', () => {
  it('extracts degree and institution', () => {
    const text = `
Education

B.S. Computer Science, MIT, 2019
M.S. Artificial Intelligence, Stanford, 2021
`;
    const result = extractEducationBlocks(text);
    expect(result).toHaveLength(2);
    expect(result[0].institution).toBe('MIT');
    expect(result[0].degree).toBe('B.S.');
    expect(result[0].field).toBe('Computer Science');
    expect(result[0].year).toBe('2019');
  });

  it('handles dash-separated format', () => {
    const text = `
Education

Stanford — M.S. Computer Science (2021)
`;
    const result = extractEducationBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].institution).toBe('Stanford');
    expect(result[0].degree).toBe('M.S.');
    expect(result[0].field).toBe('Computer Science');
  });
});

describe('extractCredentials', () => {
  it('extracts certifications', () => {
    const text = `
Certifications

AWS Certified Solutions Architect — Amazon, 2020
Google Cloud Professional Data Engineer, Google, 2021
`;
    const result = extractCredentials(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toContain('AWS');
  });
});

describe('extractProjects', () => {
  it('extracts projects from standalone section', () => {
    const text = `
Projects

- Open-source CLI tool — A TypeScript utility for data processing
- Personal blog — Built with Next.js and MDX
`;
    const result = extractProjects(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].name).toContain('CLI');
  });

  it('extracts GitHub URLs from anywhere in the text', () => {
    const text = `
Experience

Built https://github.com/acme/infra-tool for internal deployment automation.
`;
    const result = extractProjects(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((p) => p.url?.includes('github.com/acme/infra-tool'))).toBe(true);
  });
});

describe('ParsedCV structure', () => {
  it('mock data includes all required fields', () => {
    const mock: ParsedCV = {
      name: 'Test',
      skills: ['TypeScript'],
      experiences: [],
      educationBlocks: [],
      credentials: [],
      projects: [],
    };
    expect(mock.skills).toBeDefined();
    expect(mock.experiences).toBeDefined();
    expect(mock.educationBlocks).toBeDefined();
    expect(mock.credentials).toBeDefined();
    expect(mock.projects).toBeDefined();
  });
});
