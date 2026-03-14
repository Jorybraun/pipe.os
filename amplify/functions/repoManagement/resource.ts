import { defineFunction } from '@aws-amplify/backend';

/**
 * STREAM 2: Code Review Challenge Backend Infrastructure
 * Phase 2: repoManagement Lambda Resource Definition
 *
 * This Lambda provides S3 utilities for:
 * - Generating presigned URLs for repository downloads
 * - Loading and caching repository metadata
 * - Querying repository templates from DynamoDB
 */

export const repoManagement = defineFunction({
  name: 'repoManagement',
  
  entry: './handler.ts',
  
  environment: {
    // S3 bucket where repositories are stored
    REPO_BUCKET_NAME: process.env.REPO_BUCKET_NAME || 'pipe-challenges-prod',
    
    // DynamoDB table for repository templates
    REPO_TEMPLATE_TABLE: process.env.REPO_TEMPLATE_TABLE || 'RepoTemplate',
    
    // AWS region is automatically provided by Lambda runtime
    // Access via process.env.AWS_REGION in handler code
    
    // Metadata cache TTL (1 hour)
    METADATA_CACHE_TTL: '3600',
  },
  
  // Timeout: Lambda needs enough time for S3 operations
  // Presigned URL generation should be fast (< 1s)
  // Metadata loading may take a few seconds depending on file size
  timeoutSeconds: 30,
  
  // Memory: Metadata parsing and URL generation are light
  // Start conservative and scale up if needed
  memoryMB: 256,
});
