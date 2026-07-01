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
      total: 1,
      page: 1,
      limit: 100,
      hasMore: false,
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
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts?page=1&limit=100');
  });

  it('loads additional people pages on demand', async () => {
    mocks.api.get
      .mockResolvedValueOnce({
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
        total: 2,
        page: 1,
        limit: 100,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        contacts: [{
          id: 'person-2',
          email: 'sam@example.com',
          name: 'Sam',
          company: 'PIPE',
          role: 'Backend engineer',
          phone: null,
          linkedin: null,
          notes: null,
          type: 'lead',
          created_at: '2026-06-28T10:00:00.000Z',
          updated_at: '2026-06-28T10:00:00.000Z',
        }],
        total: 2,
        page: 2,
        limit: 100,
        hasMore: false,
      });

    renderPeoplePage();

    await screen.findByText('Clayton');
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(mocks.api.get).toHaveBeenNthCalledWith(1, '/api/v1/contacts?page=1&limit=100');
    expect(mocks.api.get).toHaveBeenNthCalledWith(2, '/api/v1/contacts?page=2&limit=100');
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
