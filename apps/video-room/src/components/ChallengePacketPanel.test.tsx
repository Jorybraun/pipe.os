// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChallengePacketPanel } from './ChallengePacketPanel';
import type { RoomWorkspaceChallengePacket } from '../types';

const packet: RoomWorkspaceChallengePacket = {
  sourceRefType: 'open_source_challenge_packet',
  evidenceRole: 'assigned_challenge',
  exactText: [
    'Repo: https://github.com/pipe/source-backed-worker',
    'Base commit: dddddddddddddddddddddddddddddddddddddddd',
    'Task: Fix the source-backed worker retry path.',
    'Success criteria:',
    '- Retry order remains deterministic',
    '- Existing worker tests pass',
    'Expected evidence:',
    '- Commit SHA on assessment branch',
    '- Test command output',
  ].join('\n'),
  locator: {
    repositoryUrl: 'https://github.com/pipe/source-backed-worker',
    githubPrNumber: 144,
    baseCommitSha: 'dddddddddddddddddddddddddddddddddddddddd',
  },
  contentHash: 'sha256:packet-content-hash',
};

describe('ChallengePacketPanel', () => {
  it('renders the assigned open-source challenge packet with source-backed provenance', () => {
    render(<ChallengePacketPanel packet={packet} />);

    expect(screen.getByText('Open-source challenge')).not.toBeNull();
    expect(screen.getByText('https://github.com/pipe/source-backed-worker')).not.toBeNull();
    expect(screen.getByText('#144')).not.toBeNull();
    expect(screen.getByText('dddddddddddddddddddddddddddddddddddddddd')).not.toBeNull();
    expect(screen.getByTestId('challenge-packet-exact-text').textContent).toContain(
      'Fix the source-backed worker retry path.',
    );
    expect(screen.getByText('sha256:packet-content-hash')).not.toBeNull();
  });

  it('does not invent missing locator fields', () => {
    render(<ChallengePacketPanel packet={{ ...packet, locator: {}, contentHash: 'sha256:only-hash' }} compact />);

    expect(screen.queryByText('https://github.com/pipe/source-backed-worker')).toBeNull();
    expect(screen.queryByText('#144')).toBeNull();
    expect(screen.getByText('sha256:only-hash')).not.toBeNull();
    expect(screen.getByTestId('challenge-packet-exact-text').textContent).toContain(
      'Commit SHA on assessment branch',
    );
  });

  it('accepts alternate persisted locator names from source-backed packets', () => {
    render(<ChallengePacketPanel packet={{
      ...packet,
      locator: {
        githubRepoUrl: 'https://github.com/pipe/alternate-worker',
        prNumber: '145',
        baseCommit: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
    }} />);

    expect(screen.getByText('https://github.com/pipe/alternate-worker')).not.toBeNull();
    expect(screen.getByText('#145')).not.toBeNull();
    expect(screen.getByText('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).not.toBeNull();
  });
});
