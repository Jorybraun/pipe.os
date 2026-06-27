import { describe, expect, it } from 'vitest';
import { DEFAULT_PIPE_EMAIL_LOGO_URL } from '../emailAssets';
import { resolveTemplate, type EmailTrigger } from '../email';

describe('default notification email templates', () => {
  it('render the PIPE logo as a public HTTPS asset instead of an embedded data URI', () => {
    const triggers: EmailTrigger[] = ['INVITATION', 'SCHEDULED', 'SUCCESS', 'FAILURE'];

    for (const trigger of triggers) {
      const template = resolveTemplate(trigger, null);
      expect(template.body).toContain('{{logoUrl}}');
      expect(template.body).not.toContain('data:image');
      expect(
        template.body.replace(/\{\{logoUrl\}\}/g, DEFAULT_PIPE_EMAIL_LOGO_URL),
      ).toContain(DEFAULT_PIPE_EMAIL_LOGO_URL);
    }
  });
});
