import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactsPage from './ContactsPage';

const mocks = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  getToken: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}));

vi.mock('../lib/api/client', () => ({
  createApiClient: () => mocks.api,
}));

vi.mock('../components/Candidate/LivingContextGraph', () => ({
  LivingContextGraph: () => <div data-testid="mock-living-context-graph" />,
}));

function renderPeoplePage(): void {
  render(
    <MemoryRouter>
      <ContactsPage />
    </MemoryRouter>,
  );
}

describe('ContactsPage recruiter surface', () => {
  beforeEach(() => {
    mocks.getToken.mockReset();
    mocks.api.get.mockReset();
    mocks.api.post.mockReset();
    mocks.api.patch.mockReset();
    mocks.api.del.mockReset();
    mocks.api.get.mockResolvedValue({
      contacts: [{
        id: 'person-1',
        email: 'clayton@example.com',
        name: 'Clayton',
        company: 'PIPE',
        role: 'Frontend engineer',
        phone: null,
        linkedin: null,
        notes: null,
        type: 'candidate',
        created_at: '2026-06-28T10:00:00.000Z',
        updated_at: '2026-06-28T10:00:00.000Z',
      }],
    });
  });

  it('uses the same recruiter shell as the person profile', async () => {
    renderPeoplePage();

    const surface = await screen.findByTestId('people-surface');
    expect(surface).toHaveStyle('max-width: 1180px');
    expect(surface).toHaveStyle('border-radius: 8px');
    expect(surface).toHaveStyle('background: var(--pipe-surface-elevated)');

    const listShell = screen.getByTestId('people-list-shell');
    expect(listShell).toHaveStyle('border-radius: 8px');
    expect(listShell).toHaveStyle('background: var(--pipe-surface-solid)');

    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByText(/1 person in the relationship graph/i)).toBeInTheDocument();
    expect(screen.getByText('Clayton')).toBeInTheDocument();
  });

  it('keeps the consolidated shell when switching to source search', async () => {
    renderPeoplePage();

    await screen.findByText('Clayton');
    fireEvent.click(screen.getByRole('tab', { name: 'Find' }));

    expect(screen.getByRole('heading', { name: 'Find people' })).toBeInTheDocument();
    expect(screen.getByTestId('people-surface')).toHaveStyle('max-width: 1180px');
    expect(screen.getByTestId('people-list-shell')).toHaveStyle('border-radius: 8px');
    expect(screen.getByPlaceholderText('e.g. software engineer at Stripe in united states')).toBeInTheDocument();
  });
});
