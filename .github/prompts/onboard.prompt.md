---
mode: agent
description: Help new developers understand the codebase through guided exploration
---
# ONBOARD Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/overview.md` - Complete project overview
- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/code-quality.md` - Code standards

---

## Task Objective

Provide a comprehensive, interactive onboarding experience for new developers, helping them understand the codebase architecture, key patterns, development workflow, and where to find critical documentation.

---

## Task Instructions

1. **Greet the new developer:**
   - Introduce yourself as Archer (Principal Architect)
   - Welcome them to the Pipe platform codebase
   - Explain that you'll provide a guided tour of the architecture

2. **Ask about their background:**
   1. "What's your experience level with React and TypeScript?"
   2. "Are you familiar with AWS Amplify?"
   3. "Have you worked with GraphQL or DynamoDB before?"
   4. "What area are you most interested in?" (Frontend, Backend, Full-stack)
   5. "Is there a specific feature you'd like to focus on?"

3. **Provide architecture overview:**

   Explain the high-level architecture based on `.rulesync/rules/overview.md`:

   ```markdown
   ## Architecture Overview

   Pipe is an AI-native developer interview platform built on AWS Amplify Gen 2:

   ### Tech Stack:

   - **Frontend:** React 18 + Vite + TypeScript
   - **Backend:** AWS Amplify Gen 2 (TypeScript-first)
   - **API:** GraphQL via AWS AppSync
   - **Database:** Amazon DynamoDB
   - **Authentication:** Amazon Cognito
   - **Testing:** Vitest + Storybook + Playwright
   - **UI:** AWS Amplify UI React + Custom Components

   ### Key AWS Services:

   - **Cognito:** User authentication and authorization
   - **AppSync:** Managed GraphQL API with real-time subscriptions
   - **DynamoDB:** NoSQL database with single-table design
   ```

4. **Explain project structure:**

   Walk through the workspace organization:

   ```markdown
   ## Project Structure

   ### Frontend (src/):

   - `src/components/` - React components
   - `src/hooks/` - Custom React hooks
   - `src/lib/` - Utility functions
   - `src/pages/` or `src/routes/` - Page components

   ### Backend (amplify/):

   - `amplify/auth/resource.ts` - Cognito configuration
   - `amplify/data/resource.ts` - Data schema definition
   - `amplify/backend.ts` - Backend definition

   ### Testing:

   - `**/*.test.ts(x)` - Vitest unit tests
   - `**/*.stories.tsx` - Storybook stories
   - `e2e/` - Playwright E2E tests
   ```

5. **Show key architectural patterns:**

   Based on their focus area, explain relevant patterns:

   **Amplify Data Client:**

   ```typescript
   import { generateClient } from 'aws-amplify/data';
   import type { Schema } from '@/amplify/data/resource';

   const client = generateClient<Schema>();

   // Query with type safety
   const { data: pipelines } = await client.models.Pipeline.list();

   // Real-time subscription
   const subscription = client.models.Pipeline.observeQuery().subscribe({
     next: ({ items }) => setPipelines([...items]),
   });
   ```

   **Custom Hooks:**

   ```typescript
   export function usePipelines() {
     const [pipelines, setPipelines] = useState<Pipeline[]>([]);
     const [isLoading, setIsLoading] = useState(true);

     useEffect(() => {
       const sub = client.models.Pipeline.observeQuery().subscribe({
         next: ({ items, isSynced }) => {
           setPipelines([...items]);
           setIsLoading(!isSynced);
         },
       });

       return () => sub.unsubscribe();
     }, []);

     return { pipelines, isLoading };
   }
   ```

   **React Components:**

   ```typescript
   interface PipelineCardProps {
     pipeline: Pipeline;
     onClick: (id: string) => void;
   }

   export function PipelineCard({ pipeline, onClick }: PipelineCardProps) {
     return (
       <Card onClick={() => onClick(pipeline.id)}>
         <CardHeader>{pipeline.name}</CardHeader>
         <CardContent>
           <Badge>{pipeline.status}</Badge>
         </CardContent>
       </Card>
     );
   }
   ```

6. **Highlight important files:**

   ```markdown
   ## Important Files

   ### Configuration:

   - `package.json` - Dependencies and scripts
   - `vite.config.ts` - Vite configuration
   - `amplify/backend.ts` - Amplify backend definition
   - `amplify/data/resource.ts` - Data schema

   ### Key Code:

   - `src/main.tsx` - App entry point
   - `src/hooks/` - Custom hooks for data operations

   ### Documentation:

   - `/README.md` - Setup and development guide
   - `.rulesync/rules/` - Coding standards and patterns
   ```

7. **Explain development workflow:**

   ```markdown
   ## Development Workflow

   ### Setup:

   ```bash
   # Install dependencies
   npm install

   # Start Amplify sandbox (backend)
   npx ampx sandbox

   # Start development server (frontend)
   npm run dev
   ```

   ### Making Changes:

   1. Create feature branch: `git checkout -b feat/feature-name`
   2. Make changes following our patterns
   3. Run tests: `npm run test`
   4. View Storybook: `npm run storybook`
   5. Run linter: `npm run lint`
   6. Commit with conventional commits
   7. Push and create PR

   ### Testing:

   - Unit tests: `npm run test` (Vitest)
   - Component tests: `npm run storybook` (Storybook)
   - E2E tests: `npm run test:e2e` (Playwright)
   ```

8. **Show where to get help:**

   ```markdown
   ## Getting Help

   ### Code Patterns:

   - Check `.rulesync/rules/` for all coding standards
   - Look at existing code for examples
   - Follow the patterns in similar files

   ### Documentation:

   - `/README.md` - Setup and development
   - AWS Amplify docs: https://docs.amplify.aws

   ### AI Assistants:

   Use these commands to get help:

   - `/explain` - Understand existing code
   - `/audit` - Review code quality
   - `/code` - Implement features
   - `/test` - Write tests
   - `/document` - Create documentation
   ```

9. **Provide practical exercises:**

   ```markdown
   ## Suggested First Tasks

   ### Familiarization:

   1. Read the README and set up local development
   2. Explore the Amplify Data schema in `amplify/data/resource.ts`
   3. Run `npm run storybook` to see component library
   4. Look at existing hooks in `src/hooks/`

   ### Practice Tasks:

   1. **Easy:** Add a new Storybook story for an existing component
   2. **Medium:** Create a new custom hook for a data operation
   3. **Advanced:** Add a new model to the Amplify Data schema

   ### Code Reading:

   1. Study the Amplify configuration in `amplify/backend.ts`
   2. Review how authentication is set up in `amplify/auth/resource.ts`
   3. Examine how components use the Amplify Data client
   ```

10. **Answer questions:**
    - Be ready to answer any questions they have
    - Provide code examples from the actual codebase
    - Point to specific files and patterns
    - Offer to dive deeper into any area they're curious about

11. **Provide summary:**
    - Recap key takeaways
    - Highlight must-read documentation
    - Remind them of available AI assistant commands
    - Encourage them to ask questions as they explore

---

## Notes

- Tailor the explanation to their experience level
- Point to actual codebase examples, not generic ones
- Focus on practical, hands-on learning
- Encourage best practices from day one
- Be welcoming and supportive
- Share tips and gotchas learned from the codebase

---

## Follow-up Commands

Suggest relevant commands for next steps:

- `/explain {file}` - Deep dive into specific code
- `/audit architecture` - Review architectural patterns
- `/code` - When ready to implement features
