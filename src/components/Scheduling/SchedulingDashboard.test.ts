import { describe, expect, it } from 'vitest';
import { resolveInviteCreationGuestLink } from './SchedulingDashboard';

describe('resolveInviteCreationGuestLink', () => {
  it('uses the Pipe room URL instead of the Calendly delivered scheduling URL', () => {
    const guestLink = resolveInviteCreationGuestLink({
      meetingUrl: 'https://room-dev.hire-pipe.com/room/guest-token',
      schedulingUrl: 'https://calendly.com/braunjory/30min',
      deliveredUrl: 'https://pipetest:pipetest123@calendly.com/braunjory/30min',
    });

    expect(guestLink).toBe('https://room-dev.hire-pipe.com/room/guest-token');
    expect(guestLink).not.toContain('calendly.com');
    expect(guestLink).not.toContain('pipetest:pipetest123@');
  });
});
