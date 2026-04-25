---
mode: agent
description: >-
  Generate Mermaid diagrams from code to visualize architecture, flows, and
  relationships
---
# DIAGRAM Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/database.md` - Amplify Data patterns

---

## Task Objective

Analyze code, data structures, or system architecture to generate visual Mermaid diagrams that clearly communicate structure, flow, and relationships.

---

## Task Instructions

1. **Ask discovery questions:**
   1. "What type of diagram should I generate?"
      - a) System Architecture (AWS Amplify components and interactions)
      - b) User Flow (user journey through features)
      - c) Sequence Diagram (interaction between components)
      - d) Entity Relationship Diagram (Amplify Data schema)
      - e) Component Diagram (React component hierarchy)
      - f) State Machine (state transitions)
      - g) Data Flow (data movement through system)
   2. "What should I diagram?"
      - Provide feature name, file path, or system area
   3. "What level of detail?"
      - a) High-level overview
      - b) Detailed with all components
      - c) Focus on specific aspect

2. **Generate System Architecture Diagram:**

   ```mermaid
   graph TB
       subgraph "Client Layer"
           React[React 18 + Vite]
           Components[React Components]
           Hooks[Custom Hooks]
       end

       subgraph "AWS Amplify"
           Auth[Amplify Auth]
           Data[Amplify Data]
           AppSync[AWS AppSync]
       end

       subgraph "AWS Backend"
           Cognito[Amazon Cognito]
           DynamoDB[(DynamoDB)]
       end

       React --> Components
       Components --> Hooks
       Hooks --> Auth
       Hooks --> Data
       Auth --> Cognito
       Data --> AppSync
       AppSync --> DynamoDB
   ```

3. **Generate User Flow Diagram:**

   ```mermaid
   flowchart TD
       Start([User Opens App]) --> Auth{Authenticated?}
       Auth -->|No| SignIn[Sign In Page]
       Auth -->|Yes| Dashboard[Dashboard]

       SignIn --> Cognito[Cognito Auth]
       Cognito --> Dashboard

       Dashboard --> Pipelines[View Pipelines]
       Pipelines --> CreatePipeline[Create Pipeline]
       CreatePipeline --> FillForm[Configure Stages]
       FillForm --> Process{Processing}

       Process -->|Success| SavePipeline[Pipeline Created]
       Process -->|Error| Error[Show Error]

       SavePipeline --> RealTime[Real-time Updates]
       RealTime --> End([Complete])
       Error --> CreatePipeline
   ```

4. **Generate Sequence Diagram:**

   ```mermaid
   sequenceDiagram
       participant User
       participant React
       participant AmplifyData
       participant AppSync
       participant DynamoDB

       User->>React: Create Pipeline
       React->>AmplifyData: client.models.Pipeline.create()

       AmplifyData->>AppSync: GraphQL Mutation
       AppSync->>DynamoDB: PutItem
       DynamoDB-->>AppSync: Item Created
       AppSync-->>AmplifyData: Response

       AmplifyData-->>React: { data, errors }
       React-->>User: Pipeline Created
   ```

5. **Generate Entity Relationship Diagram (ERD):**

   Analyze Amplify Data schema and generate ERD:

   ```mermaid
   erDiagram
       User ||--o{ Pipeline : "owns"
       User ||--o{ Interview : "conducts"
       Pipeline ||--o{ Stage : "contains"
       Pipeline ||--o{ Candidate : "has"

       User {
           string id PK
           string email UK
           string name
           datetime createdAt
           datetime updatedAt
       }

       Pipeline {
           string id PK
           string name
           string description
           string ownerId FK
           enum status
           datetime createdAt
           datetime updatedAt
       }

       Stage {
           string id PK
           string name
           int order
           string pipelineId FK
           enum type
           datetime createdAt
       }

       Candidate {
           string id PK
           string name
           string email
           string pipelineId FK
           enum status
           datetime createdAt
       }
   ```

6. **Generate Component Diagram:**

   For React component hierarchies:

   ```mermaid
   graph TD
       App[App Layout]
       App --> Dashboard[Dashboard Page]
       App --> Settings[Settings Page]

       Dashboard --> PipelineList[Pipeline List]
       Dashboard --> CreateButton[Create Pipeline Button]

       PipelineList --> PipelineCard[Pipeline Card]
       PipelineCard --> StageIndicator[Stage Indicator]
       PipelineCard --> CandidateCount[Candidate Count]
       PipelineCard --> PipelineActions[Pipeline Actions]

       CreateButton --> PipelineForm[Pipeline Form]
       PipelineForm --> StageConfig[Stage Configuration]

       style App fill:#e1f5ff
       style Dashboard fill:#fff4e6
       style PipelineList fill:#f0f9ff
   ```

7. **Generate State Machine Diagram:**

   For state transitions:

   ```mermaid
   stateDiagram-v2
       [*] --> Draft
       Draft --> Active: Publish
       Active --> Paused: Pause
       Paused --> Active: Resume
       Active --> Completed: Complete
       Completed --> Archived: Archive
       Draft --> Archived: Archive
       Archived --> [*]
   ```

8. **Generate Data Flow Diagram:**

   ```mermaid
   flowchart LR
       User[User Input] --> Form[React Form]
       Form --> Validation[Validation]
       Validation -->|Valid| Mutation[Amplify Mutation]
       Validation -->|Invalid| Error[Error State]

       Mutation --> Auth[Auth Check]
       Auth -->|Pass| AppSync[AppSync]
       Auth -->|Fail| Unauthorized[401]

       AppSync --> DynamoDB[DynamoDB]
       DynamoDB --> Response[Response]
       Response --> Subscription[Subscription Update]
       Subscription --> UI[Update UI]

       style User fill:#e3f2fd
       style Form fill:#f3e5f5
       style AppSync fill:#e8f5e9
       style Response fill:#fff3e0
   ```

9. **Save and document:**

   Create directory if needed: `/docs/diagrams/`

   Save diagram to: `/docs/diagrams/{name}.md`

   Include:

   ````markdown
   # {Diagram Title}

   **Type:** {Architecture | Flow | Sequence | ERD | Component | State | Data Flow}
   **Created:** {date}
   **Scope:** {what this diagrams}

   ## Diagram

   ```mermaid
   {generated diagram}
   ```

   ## Description

   {Explain what the diagram shows}

   ## Key Components

   - **{Component}:** {Description}
   - **{Component}:** {Description}

   ## Notes

   {Any important context or caveats}

   ## Related Documentation

   - {Link to related spec/brief/docs}
   ````

10. **Provide summary:**
    - Show preview of diagram
    - Explain key components
    - Suggest where to use this diagram (specs, docs, PRs)
    - Ask if updates needed

---

## Notes

- Use Mermaid syntax (renders in GitHub, GitLab, many docs tools)
- Keep diagrams focused - split complex systems into multiple diagrams
- Choose the right diagram type for what you're communicating
- Use clear labels and legends
- Update diagrams when code changes
- Include diagrams in technical specifications

---

## Diagram Types Guide

**Use System Architecture when:**

- Explaining high-level AWS Amplify design
- Onboarding new developers
- Planning major changes

**Use User Flow when:**

- Documenting user journeys
- Planning UX improvements
- E2E test planning

**Use Sequence Diagram when:**

- Explaining Amplify Data operations
- Debugging integration issues
- Documenting API workflows

**Use ERD when:**

- Documenting Amplify Data schema
- Planning schema changes
- Understanding data relationships

**Use Component Diagram when:**

- Documenting React structure
- Planning component refactoring
- Understanding UI hierarchy

**Use State Machine when:**

- Documenting entity states
- Planning feature states
- Understanding complex workflows

**Use Data Flow when:**

- Documenting data movement
- Understanding transformations
- Planning data pipelines
