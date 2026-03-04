import { vi, expect } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import * as matchers from 'aws-sdk-client-mock-jest';

expect.extend(matchers);

export const ddbMock = mockClient(DynamoDBDocumentClient);
