import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBClient);
const sesMock = mockClient(SESClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

describe('Notification Service Handler', () => {
  beforeEach(async () => {
    vi.resetModules();
    ddbMock.reset();
    sesMock.reset();
    cognitoMock.reset();
    
    process.env.CANDIDATE_TABLE_NAME = 'Candidate';
    process.env.STAGE_TABLE_NAME = 'Stage';
    process.env.PIPELINE_TABLE_NAME = 'Pipeline';
    process.env.SCHEDULEDINTERVIEW_TABLE_NAME = 'ScheduledInterview';
    process.env.USER_POOL_ID = 'user-pool-id';
    process.env.SES_SENDER_EMAIL = 'noreply@pipe-os.com';
    
    vi.clearAllMocks();
  });

  describe('4.1 ScheduledInterview Stream Events', () => {
    it('should trigger INVITATION email when status changes to INVITED', async () => {
      const { handler } = await import('./handler');
      
      const event = {
        Records: [{
          eventSourceARN: '...:ScheduledInterview',
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: { id: { S: 'int-1' }, candidateId: { S: 'can-1' }, stageId: { S: 'stg-1' }, status: { S: 'INVITED' } },
            OldImage: { id: { S: 'int-1' }, candidateId: { S: 'can-1' }, stageId: { S: 'stg-1' }, status: { S: 'NONE' } }
          }
        }]
      };

      // Mock metadata lookups for sendNotification
      ddbMock.on(GetItemCommand).callsFake((input) => {
        if (input.TableName === 'Candidate') return { Item: { id: { S: 'can-1' }, email: { S: 'cand@test.com' }, name: { S: 'John' } } };
        if (input.TableName === 'Stage') return { Item: { id: { S: 'stg-1' }, title: { S: 'Interview' }, pipelineId: { S: 'p-1' } } };
        if (input.TableName === 'Pipeline') return { Item: { id: { S: 'p-1' }, title: { S: 'Role' } } };
        return {};
      });

      sesMock.on(SendEmailCommand).resolves({});
      ddbMock.on(UpdateItemCommand).resolves({});

      await handler(event as any, {} as any, () => {});

      expect(sesMock.commandCalls(SendEmailCommand).length).toBe(1);
    });

    it('should notify recruiter when status changes to SCHEDULED', async () => {
      const { handler } = await import('./handler');
      
      const event = {
        Records: [{
          eventSourceARN: '...:ScheduledInterview',
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: { id: { S: 'int-1' }, candidateId: { S: 'can-1' }, pipelineId: { S: 'p-1' }, status: { S: 'SCHEDULED' } },
            OldImage: { id: { S: 'int-1' }, candidateId: { S: 'can-1' }, pipelineId: { S: 'p-1' }, status: { S: 'INVITED' } }
          }
        }]
      };

      // Mock candidate and pipeline for notifyRecruiterOfStatusChange
      ddbMock.on(GetItemCommand).callsFake((input) => {
        if (input.TableName === 'Candidate') return { Item: { id: { S: 'can-1' }, name: { S: 'John' } } };
        if (input.TableName === 'Pipeline') return { Item: { id: { S: 'p-1' }, title: { S: 'Engineer' }, owner: { S: 'recruiter-sub' } } };
        return {};
      });

      cognitoMock.on(AdminGetUserCommand).resolves({
        UserAttributes: [{ Name: 'email', Value: 'recruiter@test.com' }]
      });

      sesMock.on(SendEmailCommand).resolves({});

      await handler(event as any, {} as any, () => {});

      expect(sesMock.commandCalls(SendEmailCommand).length).toBe(1);
      const emailParams = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(emailParams.Destination?.ToAddresses).toContain('recruiter@test.com');
      expect(emailParams.Message?.Subject?.Data).toContain('Interview Booked');
    });
  });

  describe('4.2 Candidate Stream Events', () => {
    it('should send candidate invite email on INSERT with status INVITED', async () => {
      const { handler } = await import('./handler');
      
      const event = {
        Records: [{
          eventSourceARN: '...:Candidate',
          eventName: 'INSERT',
          dynamodb: {
            NewImage: { id: { S: 'can-1' }, email: { S: 'c@t.com' }, status: { S: 'INVITED' }, pipelineId: { S: 'p-1' } }
          }
        }]
      };

      ddbMock.on(ScanCommand).resolves({
        Items: [{ id: { S: 'stg-1' }, title: { S: 'Round 1' }, order: { N: '0' }, pipelineId: { S: 'p-1' } }]
      });

      ddbMock.on(GetItemCommand).callsFake((input) => {
        if (input.TableName === 'Pipeline') return { Item: { id: { S: 'p-1' }, title: { S: 'Job' } } };
        if (input.TableName === 'Candidate') return { Item: { id: { S: 'can-1' }, email: { S: 'c@t.com' }, name: { S: 'C' } } };
        if (input.TableName === 'Stage') return { Item: { id: { S: 'stg-1' }, title: { S: 'Round 1' }, pipelineId: { S: 'p-1' } } };
        return {};
      });

      sesMock.on(SendEmailCommand).resolves({});
      ddbMock.on(UpdateItemCommand).resolves({});

      await handler(event as any, {} as any, () => {});

      expect(sesMock.commandCalls(SendEmailCommand).length).toBe(1);
    });
  });

  describe('4.8 AppSync Mutation Trigger', () => {
    it('should send notification manually via sendNotification mutation', async () => {
      const { handler } = await import('./handler');

      const event = {
        arguments: { candidateId: 'can-1', stageId: 'stg-1', templateType: 'SUCCESS' }
      };

      ddbMock.on(GetItemCommand).callsFake((input) => {
        if (input.TableName === 'Candidate') return { Item: { id: { S: 'can-1' }, email: { S: 'c@t.com' }, name: { S: 'Jane' } } };
        if (input.TableName === 'Stage') return { Item: { id: { S: 'stg-1' }, pipelineId: { S: 'p-1' }, title: { S: 'QA Round' } } };
        if (input.TableName === 'Pipeline') return { Item: { id: { S: 'p-1' }, title: { S: 'Role' } } };
        return {};
      });

      sesMock.on(SendEmailCommand).resolves({});

      await handler(event as any, {} as any, () => {});

      expect(sesMock.commandCalls(SendEmailCommand).length).toBe(1);
      const emailParams = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(emailParams.Message?.Subject?.Data).toContain('passed the QA Round');
    });
  });
});
