import { describe, it, expect } from 'vitest';
import {
  extractExperiences,
  extractEducationBlocks,
  extractCredentials,
  extractProjects,
  parseResumeText,
  parseResume,
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

  it('strips duration in parentheses from role', () => {
    const text = `
Experience

Morgan Stanley
Senior UI Developer : January 2024 - March 2025 (1 year 3 months)
Led frontend work.
`;
    const result = extractExperiences(text);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('Senior UI Developer');
    expect(result[0].company).toBe('Morgan Stanley');
    expect(result[0].startDate).toBe('2024');
    expect(result[0].endDate).toBe('2025');
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

  it('handles multi-line LinkedIn format', () => {
    const text = `
Education

Hyper Island
E-commerce Marketing and Business Management · (2013 - 2014) Stockholm, Sweden
`;
    const result = extractEducationBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].institution).toBe('Hyper Island');
    expect(result[0].degree).toBe('E-commerce Marketing and Business Management');
    expect(result[0].year).toBe('2013');
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

describe('parseResume', () => {
  it('falls back to source-text-only parsing when no AI provider is available', async () => {
    const result = await parseResumeText({
      resumeText: `
Experience

Source Labs
Backend Engineer — January 2021 – Present
Built queue workers for retry handling with TypeScript.
`,
      env: {},
    });

    expect(result).not.toBeNull();
    expect(result!.decompositionResult).toBeNull();
    expect(result!.parsedCV.name).toBeUndefined();
    expect(result!.parsedCV.skills).toEqual([]);
    expect(result!.parsedCV.experiences).toHaveLength(1);
    expect(result!.parsedCV.experiences[0]!.company).toBe('Source Labs');
    expect(result!.parsedCV.experiences[0]!.description).toContain('retry handling');
  });

  it('normalizes partial LLM decomposition responses for text intake', async () => {
    const ai = {
      async run(): Promise<{ response: string }> {
        return {
          response: JSON.stringify({
            candidate_name: 'Riley Retry',
            experiences: [
              {
                company: 'Queue Labs',
                role: 'Backend Engineer',
                narrative: 'Implemented idempotent retry handling for webhook delivery workers.',
                skills_demonstrated: ['TypeScript', 'queues'],
                confidence: 0.82,
              },
            ],
            skills: [
              {
                name: 'TypeScript',
                proficiency: 'proficient',
                confidence: 0.8,
              },
            ],
          }),
        };
      },
    };

    const result = await parseResumeText({
      resumeText: 'Riley Retry implemented idempotent retry handling for webhook delivery workers using TypeScript.',
      env: { AI: ai as unknown as Ai },
    });

    expect(result).not.toBeNull();
    expect(result!.parsedCV.skills).toEqual(['typescript']);
    expect(result!.decompositionResult!.projects).toEqual([]);
    expect(result!.decompositionResult!.education).toEqual([]);
    expect(result!.decompositionResult!.credentials).toEqual([]);
    expect(result!.decompositionResult!.career_arc.narrative).toContain('idempotent retry');
  });

  it('does not fabricate Jane Doe profile data when MOCK_AI disables candidate providers', async () => {
    const result = await parseResumeText({
      resumeText: `
Experience

Real Resume Co
Platform Engineer — 2020 – Present
Maintained deployment workflows and incident tooling.
`,
      env: { MOCK_AI: 'true' },
    });

    expect(result).not.toBeNull();
    expect(result!.decompositionResult).toBeNull();
    expect(result!.parsedCV.name).toBeUndefined();
    expect(result!.parsedCV.currentRole).not.toBe('Senior Frontend Engineer');
    expect(result!.parsedCV.education ?? []).not.toContain('B.S. Computer Science, MIT');
    expect(result!.parsedCV.experiences[0]!.company).toBe('Real Resume Co');
  });

  it('returns null for non-PDF files', async () => {
    const result = await parseResume({
      fileBuffer: new ArrayBuffer(0),
      contentType: 'application/docx',
      env: {},
    });
    expect(result).toBeNull();
  });

  it('falls back to rule-based extraction when no AI provider is available', async () => {
    // A minimal valid PDF header so unpdf doesn't blow up
    const pdfBytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
      0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x0a, 0x2f, 0x54, 0x79, 0x70,
      0x65, 0x20, 0x2f, 0x43, 0x61, 0x74, 0x61, 0x6c, 0x6f, 0x67, 0x0a, 0x2f, 0x50, 0x61, 0x67,
      0x65, 0x73, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x0a, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64,
      0x6f, 0x62, 0x6a, 0x0a, 0x32, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x0a,
      0x2f, 0x54, 0x79, 0x70, 0x65, 0x20, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x0a, 0x2f, 0x4b,
      0x69, 0x64, 0x73, 0x20, 0x5b, 0x33, 0x20, 0x30, 0x20, 0x52, 0x5d, 0x0a, 0x2f, 0x43, 0x6f,
      0x75, 0x6e, 0x74, 0x20, 0x31, 0x0a, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a,
      0x0a, 0x33, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c, 0x0a, 0x2f, 0x54, 0x79,
      0x70, 0x65, 0x20, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x0a, 0x2f, 0x50, 0x61, 0x72, 0x65, 0x6e,
      0x74, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x0a, 0x2f, 0x4d, 0x65, 0x64, 0x69, 0x61, 0x42,
      0x6f, 0x78, 0x20, 0x5b, 0x30, 0x20, 0x30, 0x20, 0x36, 0x31, 0x32, 0x20, 0x37, 0x39, 0x32,
      0x5d, 0x0a, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x78, 0x72, 0x65,
      0x66, 0x0a, 0x30, 0x20, 0x34, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
      0x30, 0x20, 0x36, 0x35, 0x35, 0x33, 0x35, 0x20, 0x66, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30,
      0x30, 0x30, 0x30, 0x31, 0x30, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x0a, 0x30,
      0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x37, 0x39, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30,
      0x20, 0x6e, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31, 0x37, 0x31, 0x20, 0x30,
      0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x0a, 0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72, 0x0a,
      0x3c, 0x3c, 0x0a, 0x2f, 0x53, 0x69, 0x7a, 0x65, 0x20, 0x34, 0x0a, 0x3e, 0x3e, 0x0a, 0x73,
      0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66, 0x0a, 0x32, 0x37, 0x31, 0x0a, 0x25, 0x25,
      0x45, 0x4f, 0x46, 0x0a,
    ]);

    const result = await parseResume({
      fileBuffer: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
      contentType: 'application/pdf',
      env: {},
    });
    // With no AI provider and an empty PDF, it should still return a result (empty) rather than throw
    expect(result).toBeDefined();
  });
});
