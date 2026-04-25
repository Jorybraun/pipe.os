/**
 * Smoke test for the new D1Client.
 *
 * Run with: npx tsx scripts/crawl-repos/shared/d1Client.smoke.ts
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.dev.vars') });

import { D1Client, loadD1Config } from './d1Client.js';

async function main(): Promise<void> {
  const cfg = loadD1Config();
  console.log('[smoke] Config loaded', {
    accountId: cfg.accountId.slice(0, 8) + '…',
    databaseId: cfg.databaseId.slice(0, 8) + '…',
    tokenPrefix: cfg.apiToken.slice(0, 5),
  });

  const db = new D1Client(cfg);

  // 1. Trivial SELECT 1
  console.log('[smoke] 1/4 SELECT 1');
  const ping = await db.query<{ one: number }>('SELECT 1 as one');
  console.log('       →', ping);

  // 2. Read a real row count
  console.log('[smoke] 2/4 COUNT(*) qualified_repos');
  const count = await db.query<{ n: number }>('SELECT COUNT(*) as n FROM qualified_repos');
  console.log('       → rows:', count[0]?.n);

  // 3. Parameterised query
  console.log('[smoke] 3/4 parameterised query');
  const pass2 = await db.query<{ n: number }>(
    'SELECT COUNT(*) as n FROM qualified_repos WHERE pass = ?',
    [2],
  );
  console.log('       → pass=2 rows:', pass2[0]?.n);

  // 4. Batch of reads (proves serial-with-retry path works)
  console.log('[smoke] 4/4 batch of 3 reads');
  await db.batch([
    { sql: 'SELECT 1' },
    { sql: 'SELECT 2' },
    { sql: 'SELECT 3' },
  ]);
  console.log('       → batch ok');

  console.log('[smoke] PASS ✓');
}

main().catch((err) => {
  console.error('[smoke] FAIL', err instanceof Error ? err.message : err);
  process.exit(1);
});
