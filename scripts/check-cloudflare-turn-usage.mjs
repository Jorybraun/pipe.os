const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const LIMIT_GB = Number.parseFloat(process.env.TURN_USAGE_LIMIT_GB || '1000');

function usage(message) {
  console.error(message);
  console.error('');
  console.error('Required env:');
  console.error('  CLOUDFLARE_API_TOKEN   token with Cloudflare GraphQL Account Analytics read access');
  console.error('  CLOUDFLARE_ACCOUNT_ID   Cloudflare account id');
  console.error('');
  console.error('Optional env:');
  console.error('  TURN_USAGE_LIMIT_GB     included TURN quota, defaults to 1000');
  process.exit(1);
}

if (!API_TOKEN) usage('Missing CLOUDFLARE_API_TOKEN.');
if (!ACCOUNT_ID) usage('Missing CLOUDFLARE_ACCOUNT_ID.');
if (!Number.isFinite(LIMIT_GB) || LIMIT_GB <= 0) usage('TURN_USAGE_LIMIT_GB must be a positive number.');

const now = new Date();
const dateFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
const dateTo = now.toISOString().slice(0, 10);

const query = `query turnUsage($accountId: string!, $dateFrom: Date!, $dateTo: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountId }) {
      callsTurnUsageAdaptiveGroups(
        limit: 1
        filter: { date_geq: $dateFrom, date_leq: $dateTo }
      ) {
        sum {
          egressBytes
          ingressBytes
        }
      }
    }
  }
}`;

const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query,
    variables: { accountId: ACCOUNT_ID, dateFrom, dateTo },
  }),
});

const body = await response.json().catch(() => null);
if (!response.ok || body?.errors?.length) {
  console.error(JSON.stringify(body ?? { status: response.status }, null, 2));
  throw new Error('Cloudflare TURN usage query failed.');
}

const group = body?.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups?.[0];
const egressBytes = group?.sum?.egressBytes ?? 0;
const ingressBytes = group?.sum?.ingressBytes ?? 0;
const egressGb = egressBytes / 1024 / 1024 / 1024;
const ingressGb = ingressBytes / 1024 / 1024 / 1024;
const percent = (egressGb / LIMIT_GB) * 100;
const remainingGb = Math.max(0, LIMIT_GB - egressGb);

const status =
  percent >= 100 ? 'EXHAUSTED'
    : percent >= 95 ? 'CRITICAL'
      : percent >= 85 ? 'WARNING'
        : percent >= 70 ? 'WATCH'
          : 'OK';

console.log(JSON.stringify({
  ok: true,
  status,
  period: { dateFrom, dateTo },
  limitGb: LIMIT_GB,
  billedEgressGb: Number(egressGb.toFixed(3)),
  ingressGb: Number(ingressGb.toFixed(3)),
  percentOfLimit: Number(percent.toFixed(2)),
  remainingGb: Number(remainingGb.toFixed(3)),
  thresholds: {
    watch: 70,
    warning: 85,
    critical: 95,
    exhausted: 100,
  },
}, null, 2));
