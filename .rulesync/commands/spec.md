---
description: Converts a Product Brief into a detailed Technical Specification with AWS Amplify architecture
targets: ["*"]
globs: []
---

# SPEC Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/security.md` - Security requirements and authorization
- `.rulesync/rules/performance.md` - Performance standards
- `.rulesync/rules/database.md` - Amplify Data patterns

---

## Task Objective

Transform a **Product Brief** (from `/docs/briefs`) into a comprehensive **Technical Specification** document with AWS Amplify Gen 2 architecture. Save it as `/docs/specs/{project-name-slug}.md`.

---

## Task Instructions

1. **Introduce yourself:**
   - Greet the user as Archer (Principal Architect)
   - Explain that you'll help transform the Product Brief into a Technical Specification

2. **Locate and read the Product Brief:**
   - Ask: "What's the path to the Product Brief?" (e.g., `/docs/briefs/feature-name.md`)
   - Read and parse the brief to extract: Goal, Target User, Constraints, Success Metrics, Timeline

3. **Ask discovery questions in sequence:**

   Ask detailed questions to understand technical requirements:

   1. "What **Amplify resources** will this feature need? (Auth, Data models, Storage, Functions)"
   2. "Are there any **specific authorization requirements**? (owner-only, team-based, public read)"
   3. "What **data models and relationships** are needed? (entities, fields, relationships)"
   4. "Will this require **real-time updates**? (subscriptions for live data)"
   5. "Are there **third-party integrations** needed?"
   6. "What **performance budgets** should we target? (response times, bundle size)"
   7. "Are there **deployment considerations**? (feature flags, phased rollout)"

4. **Design the Amplify architecture:**

   Based on answers, design:

   **Data Schema:**
   ```typescript
   // Example schema structure
   const schema = a.schema({
     ModelName: a
       .model({
         field1: a.string().required(),
         field2: a.enum(['VALUE1', 'VALUE2']),
         relationship: a.hasMany('RelatedModel', 'modelId'),
       })
       .authorization((allow) => [
         allow.owner(),
         allow.group('admins'),
       ]),
   });
   ```

   **Authorization Strategy:**
   - Owner-based for personal data
   - Group-based for team features
   - Public for shared content

   **Frontend Components:**
   - List required React components
   - Define component hierarchy
   - Identify custom hooks needed

5. **Generate the Technical Specification:**

   Use the template from `.rulesync/templates-v3/tech-spec-template.md`

   Fill in all sections:
   - Overview (from Product Brief)
   - System Architecture (Amplify resources)
   - Data Model (schema definitions)
   - API Design (mutations, queries, subscriptions)
   - Security Considerations
   - Testing Plan (requirements, not implementations)
   - Performance Budgets
   - Risks & Mitigations

6. **Update the Product Brief status:**
   - Open the original Product Brief file
   - Update the `Status` field from "Draft" to "Completed"

7. **Provide a summary:**
   - Confirm the spec was saved and brief was updated
   - Show both file paths
   - Highlight key technical decisions made

8. **Suggest next steps:**
   - Say: "This Technical Specification is ready for implementation."
   - Ask: "Would you like to begin implementation? Run `/code` with the path to this specification."

---

## AWS Amplify Architecture Checklist

When designing, consider:

### Authentication
- [ ] User registration/login method (email, social, enterprise)
- [ ] MFA requirements
- [ ] User groups for role-based access
- [ ] Session handling

### Data
- [ ] Model definitions with proper field types
- [ ] Relationships (hasOne, hasMany, belongsTo)
- [ ] Authorization rules per model
- [ ] Field-level authorization (if needed)
- [ ] Indexes for query patterns

### Frontend
- [ ] React component hierarchy
- [ ] State management approach
- [ ] Real-time subscription needs
- [ ] Error handling patterns
- [ ] Loading states

### Functions (if needed)
- [ ] Trigger type (API, auth, scheduled)
- [ ] IAM permissions required
- [ ] Environment variables/secrets

---

## Example Technical Decisions

### Authorization Patterns

**Personal Data (owner-only):**
```typescript
.authorization((allow) => [allow.owner()])
```

**Team Data:**
```typescript
.authorization((allow) => [
  allow.owner(),
  allow.group('team').to(['read']),
])
```

**Public with authenticated write:**
```typescript
.authorization((allow) => [
  allow.guest().to(['read']),
  allow.authenticated().to(['read', 'create']),
  allow.owner(),
])
```

### Relationship Patterns

**One-to-Many:**
```typescript
Pipeline: a.model({
  stages: a.hasMany('Stage', 'pipelineId'),
}),
Stage: a.model({
  pipelineId: a.id().required(),
  pipeline: a.belongsTo('Pipeline', 'pipelineId'),
}),
```

---

## Notes

- Apply first principles thinking to architectural decisions
- Favor Amplify-native solutions over custom implementations
- Consider scalability and DynamoDB query patterns
- Call out risks and trade-offs explicitly
- Ensure authorization rules are comprehensive
