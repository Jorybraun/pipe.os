import type { D1Database } from '@cloudflare/workers-types';

export function isClaimedInviteToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith('CLAIMED::');
}

export async function ensureUsableCandidateInviteToken(
  db: D1Database,
  candidateId: string,
  currentToken: string | null | undefined,
): Promise<string> {
  if (currentToken && !isClaimedInviteToken(currentToken)) {
    return currentToken;
  }

  const inviteToken = crypto.randomUUID();
  await db
    .prepare(
      `UPDATE candidates
          SET invite_token = ?1,
              status = CASE WHEN status = 'COMPLETED' THEN 'INVITED' ELSE status END,
              updated_at = ?2
        WHERE id = ?3`,
    )
    .bind(inviteToken, new Date().toISOString(), candidateId)
    .run();

  return inviteToken;
}
