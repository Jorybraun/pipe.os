# Pipe — Technical Specification (Working Draft)

> **Status**: Draft v0.1  
> **Last Updated**: 2024-12-19  
> **Authors**: Architecture Team

---

## Executive Summary

Pipe is an AI-native developer interview platform. This document outlines the technical architecture, infrastructure choices, and implementation approach for the MVP.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Infrastructure Stack](#infrastructure-stack)
3. [Data Model](#data-model)
4. [AI Architecture](#ai-architecture)
5. [Feature Technical Specs](#feature-technical-specs)
6. [Security & Compliance](#security--compliance)
7. [Open Questions](#open-questions)

---

## Architecture Overview

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│   │   Web App       │    │   Mobile App    │    │   Admin Portal  │        │
│   │   (Next.js)     │    │   (React Native)│    │   (Next.js)     │        │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘        │
│            │                      │                      │                  │
└────────────┼──────────────────────┼──────────────────────┼──────────────────┘
             │                      │                      │
             └──────────────────────┼──────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     AWS API Gateway                                  │   │
│   │                     (REST + WebSocket)                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│            ┌───────────────────────┼───────────────────────┐               │
│            │                       │                       │               │
│            ▼                       ▼                       ▼               │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│   │  Auth Lambda    │    │  Core API       │    │  AI Lambda      │       │
│   │  (Cognito +     │    │  Lambda         │    │  (Bedrock       │       │
│   │   Custom)       │    │  (CRUD, Biz     │    │   Integration)  │       │
│   │                 │    │   Logic)        │    │                 │       │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│   │  DynamoDB       │    │  S3             │    │  ElastiCache    │       │
│   │  (Primary DB)   │    │  (Files, Code,  │    │  (Redis -       │       │
│   │                 │    │   Recordings)   │    │   Sessions)     │       │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI LAYER                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│   │  Amazon Bedrock │    │  Knowledge      │    │  Prompt         │       │
│   │  (Claude 3.5)   │    │  Bases          │    │  Templates      │       │
│   │                 │    │  (RAG - future) │    │  (S3)           │       │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Serverless-First**: Lambda + managed services to minimize ops overhead
2. **Event-Driven**: Async processing where possible (SNS/SQS for decoupling)
3. **AI-Native**: AI capabilities are core, not bolted on
4. **Multi-Tenant**: Single deployment serves multiple organizations
5. **Cost-Optimized**: Pay-per-use model aligned with customer usage

---

## Infrastructure Stack

### AWS Amplify Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| **Rapid Prototyping** | ✅ Excellent | Quick to scaffold auth, API, storage |
| **Authentication** | ✅ Excellent | Cognito integration out of box |
| **API (GraphQL)** | ✅ Good | AppSync works well for CRUD |
| **API (REST)** | ⚠️ Limited | May need custom API Gateway for complex cases |
| **AI Integration** | ⚠️ Manual | Bedrock not natively integrated, need custom Lambda |
| **Real-time** | ✅ Good | AppSync subscriptions for live updates |
| **Customization** | ⚠️ Constrained | Can hit walls with complex requirements |
| **Ejection Path** | ✅ Good | Can export to CDK/CloudFormation |

**Recommendation**: Use Amplify for MVP with plan to eject to CDK for production.

### Recommended Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | Next.js 14 (App Router) | SSR, RSC, great DX, Vercel deployment option |
| **Auth** | AWS Cognito + Amplify Auth | Managed auth, social login, MFA |
| **API** | API Gateway + Lambda | Flexible, scalable, pay-per-request |
| **Database** | DynamoDB | Serverless, scales to zero, flexible schema |
| **File Storage** | S3 | Code files, recordings, documents |
| **AI** | Amazon Bedrock (Claude 3.5 Sonnet) | Managed, scalable, AWS-native |
| **Cache** | ElastiCache (Redis) | Session storage, rate limiting |
| **Search** | OpenSearch Serverless | Full-text search on candidates, roles |
| **CDN** | CloudFront | Static assets, API caching |
| **IaC** | AWS CDK (TypeScript) | Type-safe, composable infrastructure |

### Database Choice: DynamoDB vs PostgreSQL

| Factor | DynamoDB | PostgreSQL (RDS/Aurora) |
|--------|----------|------------------------|
| **Serverless** | ✅ Native | ⚠️ Aurora Serverless v2 (min cost) |
| **Schema Flexibility** | ✅ Excellent | ❌ Requires migrations |
| **Cost at Low Scale** | ✅ Pay-per-request | ❌ Always-on instance cost |
| **Complex Queries** | ❌ Limited (GSI design) | ✅ Full SQL |
| **Transactions** | ⚠️ Limited (25 items) | ✅ Full ACID |
| **Relationships** | ❌ Denormalized | ✅ Native joins |

**Recommendation**: **DynamoDB** for MVP

**Rationale**:
- Interview platform is document-oriented (challenges, rubrics, responses)
- Access patterns are predictable (by org, by candidate, by role)
- Serverless aligns with Lambda architecture
- Can migrate to PostgreSQL later if complex reporting needed

**Mitigation**: Design clear access patterns upfront, use single-table design

---

## Data Model

### DynamoDB Single-Table Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRIMARY TABLE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  PK                    │  SK                      │  Attributes              │
├────────────────────────┼──────────────────────────┼──────────────────────────┤
│  ORG#<orgId>           │  METADATA                │  name, plan, settings    │
│  ORG#<orgId>           │  ROLE#<roleId>           │  title, requirements...  │
│  ORG#<orgId>           │  PIPELINE#<pipelineId>   │  stages, config...       │
│  PIPELINE#<pipelineId> │  STAGE#<stageId>         │  type, config, rubric... │
│  STAGE#<stageId>       │  CHALLENGE#<challengeId> │  code, bugs, timeLimit...|
│  STAGE#<stageId>       │  RUBRIC                  │  dimensions, weights...  │
│  CANDIDATE#<candId>    │  METADATA                │  name, email, resume...  │
│  CANDIDATE#<candId>    │  APP#<appId>             │  roleId, status, stage...|
│  APP#<appId>           │  RESPONSE#<stageId>      │  answers, score, time... │
└─────────────────────────────────────────────────────────────────────────────┘

GSI1: Access by type across org
  PK: ORG#<orgId>
  SK: TYPE#<entityType>#<timestamp>

GSI2: Access candidate applications
  PK: CANDIDATE#<email>
  SK: APP#<appId>
```

### Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| **Organization** | Tenant/company | name, plan, settings, branding |
| **Role** | Job position | title, department, requirements, skills |
| **Pipeline** | Interview workflow | roleId, stages[], status, version |
| **Stage** | Single interview step | type, config, rubric, order |
| **Challenge** | Code review task | code, language, bugs[], timeLimit |
| **Bug** | Planted bug in code | line, type, severity, description, hint, fix |
| **Rubric** | Scoring criteria | dimensions[], passingScore |
| **RubricDimension** | Single scoring axis | name, weight, criteria, examples |
| **Candidate** | Job applicant | name, email, resumeUrl, profileData |
| **Application** | Candidate → Role | candidateId, roleId, pipelineId, currentStage |
| **Response** | Stage submission | applicationId, stageId, answers, score |

---

## AI Architecture

### Bedrock Configuration

```yaml
Model: anthropic.claude-3-5-sonnet-20241022-v2:0
Region: us-east-1 (primary), us-west-2 (fallback)
Provisioned Throughput: On-demand (MVP), Reserved (production)
```

### AI Agents by Feature

| Agent | Purpose | Detailed Spec |
|-------|---------|---------------|
| **Pipeline Designer** | Suggest pipeline structure | `./pipeline-builder/TECH-SPEC.md` |
| **Code Review Designer** | Generate challenges & bugs | `./code-review/TECH-SPEC.md` |
| **Voice Interview Designer** | Generate questions | `./voice-interview/TECH-SPEC.md` |
| **Candidate Evaluator** | Score submissions | `./evaluation/TECH-SPEC.md` |
| **Profile Generator** | Synthesize candidate profile | `./profiles/TECH-SPEC.md` |

### Prompt Management

Prompts stored in S3 with versioning:

```
s3://pipe-prompts/
├── v1/
│   ├── code-review/
│   │   ├── challenge-generator.md
│   │   ├── bug-generator.md
│   │   ├── conversation-system.md
│   │   └── rubric-generator.md
│   ├── voice-interview/
│   │   └── ...
│   └── evaluation/
│       └── ...
└── v2/
    └── ...
```

---

## Feature Technical Specs

Each feature has its own detailed technical specification:

| Feature | Spec Location | Status |
|---------|---------------|--------|
| Role Creation | `./role-creation/TECH-SPEC.md` | 📝 Pending |
| Pipeline Builder | `./pipeline-builder/TECH-SPEC.md` | 📝 Pending |
| Code Review Stage | `./code-review/TECH-SPEC.md` | 🟡 In Progress |
| Voice Interview Stage | `./voice-interview/TECH-SPEC.md` | 📝 Pending |
| AI Screening Stage | `./ai-screening/TECH-SPEC.md` | 📝 Pending |
| AI Collaboration Stage | `./ai-collaboration/TECH-SPEC.md` | 📝 Pending |
| Feature Planning Stage | `./feature-planning/TECH-SPEC.md` | 📝 Pending |
| Human Panel Stage | `./human-panel/TECH-SPEC.md` | 📝 Pending |
| Candidate Portal | `./candidate-portal/TECH-SPEC.md` | 📝 Pending |
| Evaluation Engine | `./evaluation/TECH-SPEC.md` | 📝 Pending |

---

## Security & Compliance

### Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────┐
│                    AUTHORIZATION MODEL                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Organization                                              │
│   └── Owner (full access)                                   │
│       └── Admin (manage users, roles, pipelines)            │
│           └── Hiring Manager (manage assigned roles)        │
│               └── Interviewer (view candidates, feedback)   │
│                   └── Viewer (read-only)                    │
│                                                             │
│   Candidate (separate auth pool)                            │
│   └── Access own applications and assessments only          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Protection

| Data Type | Classification | Protection |
|-----------|---------------|------------|
| Candidate PII | Sensitive | Encrypted at rest (KMS), field-level encryption |
| Assessment Responses | Confidential | Encrypted, org-isolated |
| Code Challenges | Proprietary | Encrypted, access-logged |
| AI Prompts | Internal | S3 bucket policy, no public access |
| Recordings | Sensitive | S3 encryption, signed URLs, auto-expiry |

### Compliance Considerations

- **GDPR**: Data residency options, right to deletion, export
- **SOC 2**: Audit logging, access controls, encryption
- **Accessibility**: WCAG 2.1 AA compliance target

---

## Cost Estimation (MVP)

### Monthly Cost Projection (1,000 candidates/month)

| Service | Usage | Est. Cost |
|---------|-------|-----------|
| Lambda | 500K invocations | $5 |
| API Gateway | 500K requests | $2 |
| DynamoDB | 10GB, on-demand | $15 |
| S3 | 50GB storage | $2 |
| Bedrock (Claude) | 10M tokens | $150 |
| Cognito | 1K MAU | $0 (free tier) |
| CloudFront | 100GB transfer | $10 |
| **Total** | | **~$185/month** |

*Note: Bedrock is largest cost driver. Implement caching and token optimization.*

---

## Open Questions

| ID | Question | Owner | Status |
|----|----------|-------|--------|
| TQ-001 | Should we use AppSync (GraphQL) or API Gateway (REST)? | Arch | Open |
| TQ-002 | How to handle long-running AI generations (>30s Lambda limit)? | Arch | Open |
| TQ-003 | Multi-region deployment strategy? | Infra | Open |
| TQ-004 | Bedrock vs direct Anthropic API for cost/features? | Arch | Open |
| TQ-005 | Real-time collaboration on pipeline editing? | Product | Open |

---

## Next Steps

1. ✅ Create high-level architecture (this document)
2. 🔄 Create Code Review Stage technical spec
3. 📝 Define DynamoDB access patterns in detail
4. 📝 Set up Amplify project scaffold
5. 📝 Create AI prompt templates
6. 📝 Define API contracts (OpenAPI spec)

---

## Appendix

### References

- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [Amazon Bedrock Developer Guide](https://docs.aws.amazon.com/bedrock/)
- [DynamoDB Single-Table Design](https://www.alexdebrie.com/posts/dynamodb-single-table/)
- [Claude API Documentation](https://docs.anthropic.com/)

### Related Documents

- [Business Requirements](../../pipe-business-requirements.md)
- [Pipeline Creation Epic](./EPIC.md)
- [Design System](../../design-system/TOKENS.md)
