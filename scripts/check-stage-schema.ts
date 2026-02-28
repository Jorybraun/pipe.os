import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Schema } from '../amplify/data/resource';

const outputs = JSON.parse(readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8'));
Amplify.configure(outputs);

const client = generateClient<Schema>();

async function checkSchema() {
  try {
    console.log('Fetching stages...');
    const { data: stages } = await client.models.Stage.list({ limit: 1 });
    if (stages.length > 0) {
      console.log('Stage found:', JSON.stringify(stages[0], null, 2));
      console.log('Available keys:', Object.keys(stages[0]));
    } else {
      console.log('No stages found. Creating one...');
      // Try to create with title
      try {
          const { data: newStage } = await client.models.Stage.create({
              pipelineId: 'test-id',
              title: 'Test Stage'
          } as any);
          console.log('Created with title:', newStage);
      } catch (e: any) {
          console.log('Failed to create with title:', e.message);
          // Try with name
          try {
              const { data: newStage } = await client.models.Stage.create({
                  pipelineId: 'test-id',
                  name: 'Test Stage'
              } as any);
              console.log('Created with name:', newStage);
          } catch (e2: any) {
              console.log('Failed to create with name:', e2.message);
          }
      }
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

checkSchema();
