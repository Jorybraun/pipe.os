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
    'Match proof:',
    '- Review packet quality 92% from source-backed repo analysis.',
    '- 2 source-backed repo demands in the selected PR packet.',
    'Assessment fit:',
    '- focused review calibrated for senior candidates.',
    '- 30 minute target from deterministic engineering prior.',
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

  it('renders the task, success criteria, and expected evidence from exact packet text', () => {
    render(<ChallengePacketPanel packet={packet} />);

    const contract = screen.getByTestId('challenge-packet-contract');
    expect(contract.textContent).toContain('Task');
    expect(contract.textContent).toContain('Fix the source-backed worker retry path.');
    expect(contract.textContent).toContain('Match proof');
    expect(contract.textContent).toContain('Review packet quality 92% from source-backed repo analysis.');
    expect(contract.textContent).toContain('2 source-backed repo demands in the selected PR packet.');
    expect(contract.textContent).toContain('Assessment fit');
    expect(contract.textContent).toContain('focused review calibrated for senior candidates.');
    expect(contract.textContent).toContain('30 minute target from deterministic engineering prior.');
    expect(contract.textContent).toContain('Success criteria');
    expect(contract.textContent).toContain('Retry order remains deterministic');
    expect(contract.textContent).toContain('Existing worker tests pass');
    expect(contract.textContent).toContain('Expected evidence');
    expect(contract.textContent).toContain('Commit SHA on assessment branch');
    expect(contract.textContent).toContain('Test command output');
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

  it('does not invent a structured contract when exact packet text lacks contract sections', () => {
    render(<ChallengePacketPanel packet={{
      ...packet,
      exactText: 'Repo: https://github.com/pipe/source-backed-worker\nInvestigate the linked source-backed issue.',
    }} />);

    expect(screen.queryByTestId('challenge-packet-contract')).toBeNull();
    expect(screen.getByTestId('challenge-packet-exact-text').textContent).toContain(
      'Investigate the linked source-backed issue.',
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
