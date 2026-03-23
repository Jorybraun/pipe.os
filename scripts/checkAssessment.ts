import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import { readFileSync } from 'fs';
import { join } from 'path';

const outputs = JSON.parse(readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8')) as unknown;
Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);
const client = generateClient<Schema>();

const candidateId = process.env['CANDIDATE_ID'] ?? '7782128a-495a-435e-88d1-d148e619ee09';

await signIn({ username: process.env['E2E_EMAIL']!, password: process.env['E2E_PASSWORD']! });

const { data } = await client.models.Assessment.list({
  filter: { candidateId: { eq: candidateId } },
});

for (const a of data) {
  console.log('Assessment:', a.id);
  console.log('  score:', a.score);
  console.log('  completedAt:', a.completedAt);
  console.log('  feedback length:', a.feedback?.length ?? 0);
  if (a.feedback && a.feedback.length > 10) {
    try {
      const parsed = JSON.parse(a.feedback) as Record<string, unknown>;
      console.log('  feedback (parsed):', JSON.stringify(parsed).slice(0, 200));
    } catch {
      console.log('  feedback (raw):', a.feedback.slice(0, 200));
    }
  }
}

if (data.length === 0) console.log('No assessments found for candidate', candidateId);

await signOut();
