import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PipelineNewRoutePage from './PipelineNewRoutePage';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('../providers', () => ({
  useAuth: () => ({ getSessionToken: mocks.getToken }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

describe('PipelineNewRoutePage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.getToken.mockResolvedValue('test-token');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a source-backed role context, auto-builds selected stages, and navigates to the pipeline', async () => {
    const warnings = [{ code: 'W-NO-NON-NEGOTIABLE-SKILLS', severity: 'warn', message: 'No selected terms.' }];
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'role-context-1',
        selectedTerms: ['React'],
        baseline: { title: 'Frontend Engineer' },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pipeline: { id: 'pipeline-1' },
        warnings,
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }));

    render(
      <MemoryRouter>
        <PipelineNewRoutePage />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Senior Frontend Engineer'), 'Frontend Engineer');
    await user.type(screen.getByPlaceholderText('Acme Corp'), 'Acme');
    await user.type(screen.getByPlaceholderText('Remote / NYC / Berlin'), 'Remote');
    await user.type(
      screen.getByPlaceholderText('Paste role expectations, constraints, and technical requirements.'),
      'Build React interfaces and review frontend architecture decisions.',
    );

    await user.click(screen.getByRole('button', { name: /live coding/i }));
    await user.click(screen.getByRole('button', { name: /create role/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/api/v1/role-contexts/simple-job-description'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      title: 'Frontend Engineer',
      jobDescriptionMd: [
        '## Role Title\nFrontend Engineer',
        '## Company\nAcme',
        '## Location\nRemote',
        '## Role Scope\nBuild React interfaces and review frontend architecture decisions.',
      ].join('\n\n'),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/v1/pipelines/auto-build'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      role_context_id: 'role-context-1',
      pipeline_title: 'Frontend Engineer',
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'moderate',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: ['React'],
      },
      selected_stages: ['SCREENING', 'CODE_REVIEW'],
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/pipeline/pipeline-1', {
        state: { autoBuildWarnings: warnings },
      });
    });
  });
});
