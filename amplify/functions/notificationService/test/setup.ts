import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SESClient } from '@aws-sdk/client-ses';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

beforeEach(() => {
  ddbMock.reset();
  sesMock.reset();
  cognitoMock.reset();
});

export { ddbMock, sesMock, cognitoMock };
