#!/usr/bin/env node
/**
 * CDK App entry point — Pipe shared infrastructure
 *
 * Deploys PipeSharedStack which manages the ECS cluster, task definition,
 * IAM role, security group, and (future) ALB for dev containers.
 *
 * Usage:
 *   cd infra
 *   npx cdk deploy PipeSharedDev         # deploy dev environment
 *   npx cdk diff PipeSharedDev           # preview changes
 *   npx cdk synth PipeSharedDev          # generate CloudFormation template
 *
 * Prerequisites:
 *   AWS credentials configured (aws configure or AWS_PROFILE env var)
 *   AWS_DEFAULT_REGION=us-west-2 (or set CDK_DEFAULT_REGION)
 */

import * as cdk from 'aws-cdk-lib';
import { PipeSharedStack } from '../lib/PipeSharedStack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? '642351122747',
  region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
};

// ── Dev environment ──────────────────────────────────────────────────────────
// This is the stack that should replace the manually-provisioned resources
// documented in infra/state/2026-03-06-initial.json.
// Once deployed, update the ARN constants in amplify/backend.ts to match
// the CDK stack outputs (or migrate to SSM reads — see infra/README.md).
new PipeSharedStack(app, 'PipeSharedDev', {
  env,
  environment: 'dev',
  albDomain: 'env.pipe.dev',
  tags: {
    Project: 'pipe',
    Environment: 'dev',
    ManagedBy: 'cdk',
    Repository: 'pipe-os',
  },
});

// ── Production environment (uncomment when ready) ────────────────────────────
// new PipeSharedStack(app, 'PipeSharedProd', {
//   env,
//   environment: 'prod',
//   albDomain: 'env.pipe.dev',
//   tags: {
//     Project: 'pipe',
//     Environment: 'prod',
//     ManagedBy: 'cdk',
//     Repository: 'pipe-os',
//   },
// });
