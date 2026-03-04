import { expect, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Bypassing aws-sdk-client-mock-jest matchers due to Chalk TypeErrors.
export const ddbMock = mockClient(DynamoDBDocumentClient);
