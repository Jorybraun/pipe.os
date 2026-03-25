import { defineFunction, secret } from "@aws-amplify/backend";

/**
 * parseCandidateCV - Lambda for extracting structured data from candidate CVs.
 * 
 * Uses S3 to fetch the resume file and Bedrock (Mistral/Claude) to parse the text.
 * Requires:
 * - Read access to the resume S3 bucket
 * - Invoke access to Amazon Bedrock
 * - Write access to the Candidate model in DynamoDB (for auto-filling data)
 */
export const parseCandidateCV = defineFunction({
  name: "parseCandidateCV",
  timeoutSeconds: 120, // Increased to 2 minutes for Mistral API calls
  memoryMB: 1024, // Increased memory for PDF parsing
  resourceGroupName: "data", // Assign to data stack to avoid circular dependency
  environment: {
    MISTRAL_API_KEY: secret("MISTRAL_API_KEY"),
  }
});
