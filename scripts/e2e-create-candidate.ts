import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';

const outputs = JSON.parse(readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8'));
Amplify.configure(outputs);

const client = generateClient<Schema>();

async function main() {
  const username = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!username || !password) {
    console.error('E2E_EMAIL and E2E_PASSWORD env vars are required');
    process.exit(1);
  }

  try {
    await signIn({ username, password });
    
    // 1. Find or create a pipeline
    const { data: pipelines } = await client.models.Pipeline.list({ limit: 1 });
    let pipelineId = pipelines[0]?.id;

    if (!pipelineId) {
      const { data: pipeline } = await client.models.Pipeline.create({
        title: 'E2E Test Pipeline',
        status: 'ACTIVE',
        creationMode: 'PRESET'
      } as any);
      pipelineId = pipeline?.id;

      // Add a simple stage and challenge
      if (pipelineId) {
        const { data: stage } = await client.models.Stage.create({
          pipelineId,
          order: 0,
        });
        if (stage) {
          await client.models.Challenge.create({
            stageId: stage.id,
            type: 'QUIZ_MCQ',
            title: 'E2E Quiz',
            order: 0,
            config: JSON.stringify({
              q: 'Is this an E2E test?',
              options: [{ id: '1', text: 'Yes' }, { id: '2', text: 'No' }],
              correct: '1'
            })
          });
        }
      }
    }

    if (!pipelineId) throw new Error('Could not find or create pipeline');

    // 2. Create candidate
    const token = `e2e-${uuidv4().slice(0, 8)}`;
    const { data: candidate, errors } = await client.models.Candidate.create({
      pipelineId,
      name: 'E2E Candidate',
      email: `e2e-${Date.now()}@example.com`,
      inviteToken: token,
      status: 'INVITED'
    });

    if (errors) throw new Error(errors[0].message);

    process.stdout.write(JSON.stringify({
      token: candidate?.inviteToken,
      candidateId: candidate?.id,
      pipelineId: candidate?.pipelineId
    }));

  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await signOut();
  }
}

main();
