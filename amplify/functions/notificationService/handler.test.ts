import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './handler';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';

const ddbMock = mockClient(DynamoDBClient);
const sesMock = mockClient(SESClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

describe('Notification Service Handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    sesMock.reset();
    cognitoMock.reset();
    process.env.CANDIDATE_TABLE_NAME = 'Candidate';
    process.env.STAGE_TABLE_NAME = 'Stage';
    process.env.PIPELINE_TABLE_NAME = 'Pipeline';
    process.env.SCHEDULEDINTERVIEW_TABLE_NAME = 'ScheduledInterview';
    process.env.USER_POOL_ID = 'user-pool-id';
  });

  describe('DynamoDB Stream Events', () => {
    it('should send invite email when ScheduledInterview status changes to INVITED', async () => {
      const event = {
        Records: [{
          eventSourceARN: '...:ScheduledInterview',
          dynamodb: {
            NewImage: {
              id: { S: 'int-123' },
              candidateId: { S: 'cand-123' },
              stageId: { S: 'stage-123' },
              status: { S: 'INVITED' }
            },
            OldImage: {
              status: { S: 'NONE' }
            }
          }
        }]
      };

      // Mock metadata lookups
      ddbMock.on(GetItemCommand).callsFake((params) => {
        if (params.TableName === 'Candidate') return { Item: { id: { S: 'cand-123' }, email: { S: 'test@example.com' }, name: { S: 'Test Candidate' } } };
        if (params.TableName === 'Stage') return { Item: { id: { S: 'stage-123' }, pipelineId: { S: 'pipe-123' }, title: { S: 'Interview' }, mode: { S: 'LIVE_VIDEO' } } };
        if (params.TableName === 'Pipeline') return { Item: { id: { S: 'pipe-123' }, title: { S: 'Software Engineer' } } };
        if (params.TableName === 'ScheduledInterview') return { Item: { id: { S: 'int-123' }, schedulingUrl: { S: 'https://cal.com/book' } } };
        return {};
      });

      sesMock.on(SendEmailCommand).resolves({});
      ddbMock.on(UpdateItemCommand).resolves({});

      await handler(event as any, {} as any, () => {});

      expect(sesMock).toHaveReceivedCommand(SendEmailCommand);
      const emailParams = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(emailParams.Destination?.ToAddresses).toContain('test@example.com');
      expect(emailParams.Message?.Subject?.Data).toContain('Software Engineer');
    });

    it('should notify recruiter when interview status changes to SCHEDULED', async () => {
      const event = {
        Records: [{
          eventSourceARN: '...:ScheduledInterview',
          dynamodb: {
            NewImage: {
              candidateId: { S: 'cand-123' },
              pipelineId: { S: 'pipe-123' },
              status: { S: 'SCHEDULED' },
              scheduledAt: { S: '2026-03-03T10:00:00Z' }
            },
            OldImage: {
              status: { S: 'INVITED' }
            }
          }
        }]
      };

      ddbMock.on(GetItemCommand).callsFake((params) => {
        if (params.TableName === 'Candidate') return { Item: { id: { S: 'cand-123' }, name: { S: 'Jane Doe' } } };
        if (params.TableName === 'Pipeline') return { Item: { id: { S: 'pipe-123' }, title: { S: 'Dev' }, owner: { S: 'recruiter-sub::sub' } } };
        return {};
      });

      cognitoMock.on(AdminGetUserCommand).resolves({
        UserAttributes: [{ Name: 'email', Value: 'recruiter@example.com' }]
      });

      sesMock.on(SendEmailCommand).resolves({});

      await handler(event as any, {} as any, () => {});

      expect(sesMock).toHaveReceivedCommand(SendEmailCommand);
      const emailParams = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(emailParams.Destination?.ToAddresses).toContain('recruiter@example.com');
      expect(emailParams.Message?.Subject?.Data).toContain('Interview Booked');
    });
  });

  describe('AppSync Mutation Trigger', () => {
    it('should send notification manually via sendNotification mutation', async () => {
      const event = {
        arguments: {
          candidateId: 'cand-123',
          stageId: 'stage-123',
          templateType: 'SUCCESS'
        }
      };

      ddbMock.on(GetItemCommand).callsFake((params) => {
        if (params.TableName === 'Candidate') return { Item: { id: { S: 'cand-123' }, email: { S: 'cand@example.com' } } };
        if (params.TableName === 'Stage') return { Item: { id: { S: 'stage-123' }, pipelineId: { S: 'pipe-123' }, title: { S: 'QA Round' } } };
        if (params.TableName === 'Pipeline') return { Item: { id: { S: 'pipe-123' }, title: { S: 'Role' } } };
        return {};
      });

      sesMock.on(SendEmailCommand).resolves({});

      await handler(event as any, {} as any, () => {});

      expect(sesMock).toHaveReceivedCommand(SendEmailCommand);
      const emailParams = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(emailParams.Message?.Subject?.Data).toContain('passed the QA Round');
    });
  });
});
