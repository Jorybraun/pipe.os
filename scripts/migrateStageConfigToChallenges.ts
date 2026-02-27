import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../src/amplify/data/resource';

/**
 * Migration Script: Stage Config -> Challenges
 * 
 * Logic:
 * 1. Fetch all Pipelines
 * 2. For each pipeline, fetch all Stages
 * 3. For each Stage:
 *    a. If type is CODE_REVIEW, extract snippets from config
 *    b. For each snippet, create a CodeArtifact and a CODE_REVIEW Challenge
 *    c. If type is QUIZ, extract questions from config
 *    d. For each question, create a QUIZ_MCQ Challenge
 * 4. Update existing Assessments to point to the new Challenges (best effort)
 */

// Note: This script is intended to be run in a Node environment with Amplify configured.
// For MVP, we'll implement the logic here and can trigger it via a temporary admin UI or CLI.

const client = generateClient<Schema>();

export async function migrateData() {
  console.log('[migration] Starting migration...');

  try {
    const { data: pipelines } = await client.models.Pipeline.list();
    
    for (const pipeline of pipelines) {
      console.log(`[migration] Processing pipeline: ${pipeline.title} (${pipeline.id})`);
      
      const { data: stages } = await client.models.Stage.list({
        filter: { pipelineId: { eq: pipeline.id } }
      });

      for (const stage of stages) {
        console.log(`[migration]   Processing stage: ${stage.type} (${stage.id})`);
        
        const config = typeof stage.config === 'string' ? JSON.parse(stage.config) : stage.config;
        if (!config) continue;

        if (stage.type === 'CODE_REVIEW') {
          const snippets = config.snippets || (config.code ? [config] : []);
          
          for (let i = 0; i < snippets.length; i++) {
            const s = snippets[i];
            
            // 1. Create CodeArtifact
            const { data: artifact } = await client.models.CodeArtifact.create({
              pipelineId: pipeline.id,
              title: s.title || `Snippet ${i + 1}`,
              language: s.language || 'javascript',
              code: s.code,
              groundTruth: JSON.stringify(s.groundTruth || []),
            });

            if (artifact) {
              // 2. Create Challenge
              await client.models.Challenge.create({
                stageId: stage.id,
                type: 'CODE_REVIEW',
                order: i,
                title: s.title || `Review: Snippet ${i + 1}`,
                instructions: 'Review the following code and identify any bugs or improvements.',
                codeArtifactId: artifact.id,
                config: JSON.stringify({ renderer: config.renderer || 'DIFF_VIEW' })
              });
            }
          }
        } else if (stage.type === 'QUIZ') {
          const questions = config.questions || [];
          
          for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            
            await client.models.Challenge.create({
              stageId: stage.id,
              type: 'QUIZ_MCQ',
              order: i,
              title: q.q.substring(0, 50) + '...',
              instructions: 'Select the correct answer from the options below.',
              config: JSON.stringify({
                q: q.q,
                options: q.options,
                correct: q.correct
              })
            });
          }
        }
      }
    }

    console.log('[migration] Migration completed successfully.');
  } catch (err) {
    console.error('[migration] Migration failed:', err);
  }
}
