import { Amplify } from '@aws-amplify/core';
import { DataStore } from '@aws-amplify/datastore';
import { Challenge, Assessment, CodeArtifact } from './models';
import { scorer } from './scorer';
import awsconfig from './amplifyconfiguration.json';

Amplify.configure(awsconfig);

export const handler = async (event: any) => {
  console.log('EVENT: ', event);
  try {
    const assessmentId = event.arguments.assessmentId;
    const assessment = await DataStore.query(Assessment, assessmentId);

    if (!assessment) {
      throw new Error(`Assessment with id ${assessmentId} not found`);
    }

    const challengeId = assessment.challengeId;
    const challenge = await DataStore.query(Challenge, challengeId);

    if (!challenge) {
      throw new Error(`Challenge with id ${challengeId} not found`);
    }

    let serverConfig = challenge.serverConfig;
    if (challenge.type === 'CODE_REVIEW') {
        if(challenge.codeArtifactId){
            const codeArtifact = await DataStore.query(CodeArtifact, challenge.codeArtifactId);
            if(codeArtifact){
                serverConfig = codeArtifact.serverConfig;
            }
        } else {
            console.warn('Challenge is of type CODE_REVIEW but no codeArtifactId is present.');
        }
    }

    if (!serverConfig) {
      console.warn(`Challenge ${challengeId} has no serverConfig. Skipping scoring.`);
      return;
    }

    const submission = assessment.submission;

    if (!submission) {
      throw new Error(`Assessment ${assessmentId} has no submission`);
    }

    const score = scorer(challenge.type, submission, serverConfig);

    await DataStore.save(Assessment.copyOf(assessment, updated => {
      updated.score = score;
      updated.status = 'SCORED';
    }));

    console.log(`Assessment ${assessmentId} scored successfully`);
  } catch (error: any) {
    console.error('Error scoring assessment:', error);
    throw new Error(error.message || 'Failed to score assessment');
  }
};
