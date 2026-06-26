import { describe, expect, it } from 'vitest';
import { sendTransactionalEmail } from '../transactionalEmail';
import type { Env } from '../../types';

describe('sendTransactionalEmail', () => {
  it('treats a void local Cloudflare Email response as a successful send', async () => {
    const sentMessages: unknown[] = [];
    const env = {
      EMAIL: {
        send: async (message: unknown) => {
          sentMessages.push(message);
          return undefined as unknown as { messageId: string };
        },
      },
      OUTBOUND_EMAIL_FROM: 'no-reply@hire-pipe.com',
    } as Partial<Env> as Env;

    const result = await sendTransactionalEmail(env, {
      to: 'candidate@example.com',
      subject: 'Interview scheduled',
      html: '<p>Join at https://meet.example.com/abc</p>',
    });

    expect(result).toEqual({ provider: 'cloudflare', id: null });
    expect(sentMessages).toHaveLength(1);
  });
});
