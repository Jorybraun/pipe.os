# Challenge Management & Template System - Technical Design

## 1. Introduction

This document outlines the technical design for the Challenge Management & Template System, aligning with ADR-010 (Database-Driven Challenge Library & Template System). This system allows for the creation, storage, retrieval, and execution of coding challenges within the Pipe platform. It leverages AWS Amplify Gen 2 for backend infrastructure, React for the frontend, and TypeScript throughout.  We will use a **Unified Challenge Table** approach as outlined in ADR-010.

## 2. Scope

The Challenge Management & Template System includes the following features:

*   **Challenge Template Creation:** Define challenge templates with descriptions, instructions, initial code, test cases, and scoring criteria.
*   **Challenge Instance Creation:** Create specific challenge instances from templates, potentially with modifications for specific candidates or roles.  These are simply `Challenge` records linked to a `PipelineStage`.
*   **Challenge Assignment:** Assign challenge instances to candidates as part of a pipeline stage. This involves creating a `Challenge` record and linking it to a `PipelineStage`.
*   **Challenge Execution:** Execute coding challenges in a secure environment.
*   **Automated Scoring:** Automatically score challenge submissions based on predefined test cases and scoring criteria.
*   **Manual Review:** Allow for manual review and adjustment of scores by recruiters or reviewers.
*   **Reporting:** Generate reports on challenge performance and candidate results.
*   **Challenge Library Management:** Recruiters can create, edit, and manage reusable challenge templates.

## 3. Amplify Data Schema

The following Amplify Data schema defines the data model for the Challenge Management & Template System. We will be modifying the existing `Challenge` model to support standalone templates.

**TypeScript Diff (Target):**

```typescript
// amplify/data/resource.ts

  Challenge: a
    .model({
      // Modified: stageId is now optional to allow "Global" challenges
      stageId: a.id(), 
      stage: a.belongsTo('Stage', 'stageId'),
      
      // Existing fields
      type: a.enum(['CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER']),
      order: a.integer(),
      title: a.string().required(),
      instructions: a.string(),
      config: a.json(), 
      serverConfig: a.json(), 
      
      // New: Template & Discovery metadata
      isTemplate: a.boolean().default(false),
      isSystem: a.boolean().default(false),
      tags: a.string().array(),
      difficulty: a.enum(['beginner', 'intermediate', 'advanced']),
      topic: a.string(),
      estimatedMinutes: a.integer(),

      // Linked code if applicable
      codeArtifactId: a.id(),
      codeArtifact: a.belongsTo('CodeArtifact', 'codeArtifactId'),

      assessments: a.hasMany('Assessment', 'challengeId'),
    })
    .secondaryIndexes((index) => [
      index('isTemplate').sortKeys(['type', 'difficulty']), // Primary discovery index
      index('topic'), // Topic-based discovery
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
    ]),
```

**Global Secondary Indexes (GSIs):**

To support efficient filtering and querying of challenges, we will use Amplify's `.secondaryIndexes()`:

*   **`isTemplate-type-difficulty-index`**: Enables the main "Library" view. Allows filtering for all templates, then narrow by type or difficulty.
*   **`topic-index`**: Allows recruiters to browse by domain (e.g., "Security", "React").

Note: Since DynamoDB doesn't index inside JSON blobs, `tags` filtering will be performed in the frontend for the MVP.

## 4. Authentication and Authorization

*   **Authentication:** AWS Cognito will be used for user authentication.
*   **Authorization:** Authorization rules are defined within the Amplify Data schema using the `@auth` directive.
    *   Owners (creators) can create, update, and delete their own challenge templates and instances.
    *   Members of the `admins` group can create, read, update, and delete all challenge templates and instances.  System templates (`isSystem: true`) will be read-only for non-admin users.
    *   Public read access is granted to allow retrieval of challenge data for display purposes.

## 5. Workflow

1.  **Create Challenge Template:** An admin or recruiter user creates a new challenge template, defining the problem statement, instructions, initial code, test cases, and scoring criteria. The `isTemplate` flag is set to `true`. The `stageId` is null.
2.  **Create Challenge Instance:** A recruiter creates a challenge instance from a template, assigning it to a specific pipeline stage.  This involves creating a new `Challenge` record, copying the relevant data from the template, setting the `stageId`, and setting `isTemplate` to `false`.
3.  **Candidate Completes Challenge:** The candidate receives a notification and completes the challenge within the platform, submitting their code.
4.  **Automated Scoring:** Upon submission, the system automatically executes the test cases and calculates a score based on the scoring criteria.
5.  **Manual Review (Optional):** A reviewer can manually review the submission, provide feedback, and adjust the score if necessary.
6.  **Reporting:** The system generates reports on challenge performance and candidate results, providing insights into candidate skills and the effectiveness of the challenge templates.

## 6. Components and APIs

*   **ChallengeManagementPage:** A new React component for listing and managing challenge templates (`isTemplate: true`). This page will allow filtering by `type` and `difficulty`.
*   **ChallengeEditorPage:** A React component for creating and editing challenges (both templates and instances).
*   **Challenge Instance Creation Form:** A React component for creating challenge instances (used within the pipeline stage configuration).
*   **Code Editor:** A Monaco editor component for candidates to write and execute code.
*   **Submission Review Page:** A React component for reviewers to review submissions and provide feedback.
*   **GraphQL API:** Amplify auto-generates a GraphQL API based on the data schema for data access and manipulation.

**UI Architecture for Management Page:**

The `ChallengeManagementPage` will display a list of challenge templates. Each item in the list will use the `ChallengeRegistry` component (from ADR-005) to render a preview of the challenge.  The page will include filtering options for `type` and `difficulty`.  A "Create New Challenge" button will open the `ChallengeEditorPage`.

**Editor State Branching (Template vs. Instance):**

The `ChallengeEditorPage` will need to handle both challenge templates and challenge instances.  The editor state will branch based on whether a `stageId` is present.

*   **Template Mode (no `stageId`):** The editor will allow modification of the template's name, description, instructions, initial code, test cases, scoring criteria, tags, difficulty, and type.  Saving will update the `Challenge` record directly.
*   **Instance Mode (with `stageId`):** The editor will display the challenge data associated with the given `stageId`.  Changes will update the `Challenge` record associated with that `stageId`.  "Save as Template" functionality will be provided, which will create a *new* `Challenge` record with `isTemplate: true` and a null `stageId`, copying the current challenge data.

## 7. Backend Logic

*   **Challenge Execution:** Lambda functions will be used to execute code in a secure environment.
*   **Automated Scoring:** Lambda functions will execute test cases and calculate scores based on predefined criteria.
*   **Data Management:** Lambda functions will be used for data validation, transformation, and integration with other systems.

**Seeding Logic for `src/content/challengeLibrary.ts`:**

A one-time seeding script (`scripts/seedChallengeLibrary.ts`) will be created to read the existing challenge data from `src/content/challengeLibrary.ts` and populate the `Challenge` table.  This script will:

1.  Read each challenge from the `challengeLibrary` array in `src/content/challengeLibrary.ts`.
2.  Create a new `Challenge` record for each challenge, setting `isTemplate: true` and `isSystem: true`.  The `stageId` will be null.
3.  The script will be run once during the transition to the database-driven challenge library.
4.  After successful seeding and verification, the `src/content/challengeLibrary.ts` file will be deprecated and eventually removed.

## 8. Security Considerations

*   **Code Execution Environment:** The code execution environment must be isolated and secure to prevent malicious code from compromising the system.
*   **Data Validation:** Input data must be validated to prevent injection attacks and other vulnerabilities.
*   **Access Control:** Access to challenge data and functionality must be restricted based on user roles and permissions.

## 9. Future Enhancements

*   **Version Control:** Implement version control for challenge templates to track changes and revert to previous versions.
*   **Challenge Library:** Enhance the challenge library with advanced search and filtering capabilities.
*   **Integration with AI Scoring Models:** Integrate with AI models to provide more sophisticated and nuanced scoring of challenge submissions.
