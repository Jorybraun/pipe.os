import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { questionAgent } from './functions/questionAgent/resource';
import { jobDescriptionAgent } from './functions/jobDescriptionAgent/resource';
import { scoringAgent } from './functions/scoringAgent/resource';
import { turnCredentialsAgent } from './functions/turnCredentialsAgent/resource';

export const backend = defineBackend({
  auth,
  data,
  questionAgent,
  jobDescriptionAgent,
  scoringAgent,
  turnCredentialsAgent,
});
