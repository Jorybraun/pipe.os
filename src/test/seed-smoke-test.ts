import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { generateInviteToken } from '../lib/generateInviteToken';

const client = generateClient<Schema>();

/**
 * seedSmokeTest - Seed data for Phase 1 Smoke Test.
 *
 * Creates:
 * 1. A test pipeline.
 * 2. A "Code Review" stage for that pipeline.
 * 3. A test candidate with an inviteToken.
 */
export async function seedSmokeTest(): Promise<void> {
  console.log('[seed] Starting smoke test seeding...');

  try {
    // 1. Create Pipeline
    const { data: pipeline, errors: pErrors } = await client.models.Pipeline.create({
      title: 'Senior Frontend Engineer (Test)',
      level: 'Senior',
      stack: ['React', 'TypeScript'],
      status: 'ACTIVE',
    });

    if (pErrors || !pipeline) throw new Error(pErrors?.[0].message || 'Pipeline create failed');
    console.log('[seed] Created Pipeline:', pipeline.id);

    // 2. Create Stage
    const { data: stage, errors: sErrors } = await client.models.Stage.create({
      pipelineId: pipeline.id,
      type: 'CODE_REVIEW',
      order: 1,
      config: JSON.stringify({
        code: `export function calculateTotal(items: { price: number; quantity: number }[]) {
  // FIND THE BUG: Incorrect initialization of total
  let total = "0"; 
  
  items.forEach(item => {
    total += item.price * item.quantity;
  });
  
  return total;
}`,
        language: 'typescript'
      }),
    });

    if (sErrors || !stage) throw new Error(sErrors?.[0].message || 'Stage create failed');
    console.log('[seed] Created Stage:', stage.id);

    // 3. Create Candidate
    const token = generateInviteToken();
    const { data: candidate, errors: cErrors } = await client.models.Candidate.create({
      pipelineId: pipeline.id,
      name: 'Smoke Test Candidate',
      email: 'smoke@test.com',
      inviteToken: token,
      status: 'INVITED',
    });

    if (cErrors || !candidate) throw new Error(cErrors?.[0].message || 'Candidate create failed');
    console.log('[seed] Created Candidate:', candidate.name);
    console.log('----------------------------------------------------');
    console.log('SMOKE TEST URL:');
    console.log(`http://localhost:5173/assess/${token}`);
    console.log('----------------------------------------------------');

  } catch (err) {
    console.error('[seed] FAILED:', err);
  }
}
