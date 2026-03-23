import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const outputs = JSON.parse(readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8')) as unknown;
Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

const client = generateClient<Schema>();

const username = process.env['E2E_EMAIL']!;
const password = process.env['E2E_PASSWORD']!;
const pipelineId = process.env['PIPELINE_ID'] ?? '0dbe4944-98f5-4113-9ea9-c64044421687';

await signIn({ username, password });

const token = 'real-pr-fresh-' + uuidv4().slice(0, 8);
const { data: candidate, errors } = await client.models.Candidate.create({
  pipelineId,
  name: 'Test Candidate',
  email: 'test@example.com',
  inviteToken: token,
  status: 'INVITED',
});

if (errors) { console.error(errors); await signOut(); process.exit(1); }
if (!candidate) { console.error('No candidate returned'); await signOut(); process.exit(1); }

const out = { token, candidateId: candidate.id, pipelineId };
writeFileSync(join(process.cwd(), 'playwright/fresh-candidate-token.json'), JSON.stringify(out, null, 2));
console.log('Token:', token);
console.log('CandidateId:', candidate.id);
console.log('URL: /assess/' + token);

await signOut();
