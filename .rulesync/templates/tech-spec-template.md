# Technical Specification - {{Project Name}}

**Date:** {{today's date}}
**Author:** Archer (Principal Architect)
**Handoff:** Devin (Staff Engineer)
**Status:** Draft

**Brief:** {{markdown link to the Product Brief}}

---

## Overview

Summarize the initiative's purpose and high-level system objectives derived from the Product Brief.

## System Architecture

### AWS Amplify Resources

| Resource | Type | Description |
|----------|------|-------------|
| {{Resource 1}} | Auth/Data/Storage/Function | {{Description}} |
| {{Resource 2}} | Auth/Data/Storage/Function | {{Description}} |

### Component Hierarchy

```
src/
├── components/
│   └── {{Feature}}/
│       ├── {{Component}}.tsx      # Main component
│       ├── {{Component}}.test.tsx # Unit tests
│       └── {{Component}}.stories.tsx # Storybook
├── hooks/
│   └── use{{Feature}}.ts          # Custom hook
└── lib/
    └── {{feature}}/
        └── index.ts               # Business logic
```

### Integration Points

- {{Integration 1}}
- {{Integration 2}}

## Data Model

### Amplify Data Schema

```typescript
// amplify/data/resource.ts
import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  {{ModelName}}: a
    .model({
      // Required fields
      id: a.id().required(),
      name: a.string().required(),

      // Optional fields
      description: a.string(),
      status: a.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),

      // Relationships
      {{relatedModel}}Id: a.id(),
      {{relatedModel}}: a.belongsTo('{{RelatedModel}}', '{{relatedModel}}Id'),
      {{childModels}}: a.hasMany('{{ChildModel}}', '{{parentModel}}Id'),

      // Timestamps (auto-managed)
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group('admins').to(['read', 'update', 'delete']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;
export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
```

### Authorization Strategy

| Model | Owner | Group | Guest | Notes |
|-------|-------|-------|-------|-------|
| {{Model 1}} | CRUD | Read | - | {{Notes}} |
| {{Model 2}} | CRUD | CRUD | Read | {{Notes}} |

### Indexes and Query Patterns

| Query Pattern | Index | Fields |
|---------------|-------|--------|
| {{Pattern 1}} | GSI | {{Fields}} |
| {{Pattern 2}} | LSI | {{Fields}} |

## API Design

### Queries

| Query | Description | Auth | Response |
|-------|-------------|------|----------|
| list{{Model}}s | List all items | Owner/Group | { items: Model[], nextToken } |
| get{{Model}} | Get single item | Owner/Group | { data: Model } |

### Mutations

| Mutation | Description | Auth | Input | Response |
|----------|-------------|------|-------|----------|
| create{{Model}} | Create new item | Owner | Create{{Model}}Input | { data: Model } |
| update{{Model}} | Update existing | Owner | Update{{Model}}Input | { data: Model } |
| delete{{Model}} | Delete item | Owner | { id: string } | { data: Model } |

### Subscriptions (Real-time)

| Subscription | Description | Filter | Use Case |
|--------------|-------------|--------|----------|
| onCreate{{Model}} | New item created | owner | Live updates |
| onUpdate{{Model}} | Item updated | owner | Sync changes |
| onDelete{{Model}} | Item deleted | owner | Remove from UI |

## Security Considerations

### Authentication

- [ ] User authentication via Cognito User Pools
- [ ] MFA requirements: {{None/Optional/Required}}
- [ ] Session duration: {{Duration}}
- [ ] Password policy: {{Policy}}

### Authorization

- [ ] Owner-based access for personal data
- [ ] Group-based access for team features
- [ ] Field-level authorization where needed
- [ ] Public access explicitly disabled unless required

### Data Protection

- [ ] Encryption at rest (DynamoDB default)
- [ ] Encryption in transit (HTTPS/WSS)
- [ ] PII handling: {{Approach}}
- [ ] Audit logging: {{Approach}}

### Input Validation

- [ ] Schema-level validation via Amplify Data
- [ ] Client-side validation before submission
- [ ] Sanitization of user input

## Testing Plan

**IMPORTANT:** Document test requirements, scope, and assertions - NOT actual test implementations.
Test code should be written during the implementation phase, not in the specification.

### Unit Tests (Vitest)

**Test Area: {{Component/Function Name}}**

- **Test:** {{Scenario name}}
  - **Setup:** {{Initial conditions}}
  - **Actions:** {{What to do}}
  - **Assertions:** {{What to verify}}

### Component Tests (Storybook)

**Component: {{Component Name}}**

- **Story:** Default
  - **Props:** {{Default props}}
  - **Assertions:** Renders correctly

- **Story:** Loading
  - **Props:** {{ isLoading: true }}
  - **Assertions:** Shows loading state

- **Story:** Error
  - **Props:** {{ error: 'Error message' }}
  - **Assertions:** Shows error state

- **Story:** Interactive
  - **Actions:** User clicks button
  - **Assertions:** Handler called with correct args

### E2E Tests (Playwright)

**Feature: {{Feature Name}}**

- **Test:** Happy path user flow
  - **Setup:** Navigate to /{{path}}, authenticate
  - **Actions:** Fill form, submit, verify result
  - **Assertions:** Success message visible, data persisted

- **Test:** Error handling
  - **Setup:** Mock API failure
  - **Actions:** Trigger action
  - **Assertions:** Error message displayed, no data loss

### Coverage Requirements

- Critical paths: 90%+
- Business logic: 80%+
- UI components: 70%+
- Utilities: 100%

## Performance Budgets

| Metric | Target | Current |
|--------|--------|---------|
| LCP (Largest Contentful Paint) | < 2.5s | {{Current}} |
| FID (First Input Delay) | < 100ms | {{Current}} |
| CLS (Cumulative Layout Shift) | < 0.1 | {{Current}} |
| TTI (Time to Interactive) | < 3.5s | {{Current}} |
| Bundle size (gzipped) | < 200KB | {{Current}} |
| API response time | < 500ms | {{Current}} |

## Observability

### Logging

- Use structured logging with context
- Log levels: error, warn, info, debug
- No sensitive data in logs

### Error Tracking

- Client errors captured via error boundaries
- API errors logged with request context
- Subscription errors with retry logic

### Metrics

- API latency by operation
- Error rates by type
- User engagement metrics

## Documentation Deliverables

- [ ] JSDoc comments on all exported functions
- [ ] README updates for new features
- [ ] Storybook documentation for components
- [ ] API documentation in schema comments

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| {{Risk 1}} | High/Med/Low | High/Med/Low | {{Mitigation}} |
| {{Risk 2}} | High/Med/Low | High/Med/Low | {{Mitigation}} |

## Rollout Plan

### Phase 1: Development
- Implement backend schema changes
- Build React components
- Write tests

### Phase 2: Staging
- Deploy to staging environment
- Run E2E test suite
- QA review

### Phase 3: Production
- Deploy to production
- Monitor for errors
- Gather user feedback

## Agent Impact Analysis

> **Purpose**: Document how this specification affects AI agent configurations to keep them synchronized with codebase evolution.

### Architectural Pattern Changes

{{Describe any new or modified patterns for Amplify Data operations, authentication, component architecture}}

### New Dependencies or Integrations

{{List new AWS services, updated Amplify packages, new npm dependencies}}

### Required Agent Updates

#### Agent Personas (`.rulesync/subagents-v3/*.md`)

- **@product-owner (product-owner.md)**: {{Specific updates needed or "No changes"}}
- **@architect (architect.md)**: {{Specific updates needed or "No changes"}}
- **@developer (developer.md)**: {{Specific updates needed or "No changes"}}
- **@qa (qa.md)**: {{Specific updates needed or "No changes"}}

#### Agent Commands (`.rulesync/commands-v3/*.md`)

- {{List command files requiring updates with specific change descriptions}}
- {{Or state "No command updates required"}}

#### Agent Rules (`.rulesync/rules-v3/*.md`)

- {{List rule files requiring updates with specific change descriptions}}
- {{Or state "No rule updates required"}}

**Summary**: {{One sentence summary of overall agent maintenance impact}}
