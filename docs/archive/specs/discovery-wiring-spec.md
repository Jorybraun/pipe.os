# Technical Spec: Discovery-to-Lambda Wiring

## 1. Goal
Connect the `RoleDiscoveryPage` to the `questionAgent` Lambda via an Amplify Gen 2 custom mutation. This ensures that every time a user completes a phase, the AI processes the data and returns the next set of questions.

## 2. Schema Definition (`amplify/data/resource.ts`)
We will use the `a.json()` return type to handle the complex, dynamic nature of the agent's response.

```typescript
generateQuestions: a
  .mutation()
  .arguments({
    roleContext: a.json().required(),
    responses: a.json(), // Array of { questionId, response }
  })
  .returns(a.json())
  .handler(a.handler.function('questionAgent'))
  .authorization((allow) => [allow.authenticated()]),
```

## 3. Lambda Handler Interface (`amplify/functions/questionAgent/handler.ts`)
The handler must extract arguments from the `props` object provided by Amplify.

```typescript
import type { Schema } from '../../data/resource';

type HandlerProps = {
  arguments: Schema['generateQuestions']['arguments'];
};

export const handler = async (event: HandlerProps) => {
  const { roleContext, responses } = event.arguments;
  
  // 1. Extraction Logic
  // 2. Gap Assessment
  // 3. Question Generation
  
  return {
    updatedContext: { ... },
    nextSection: { ... },
    status: 'exploring',
    reasoning: "..."
  };
};
```

## 4. Frontend Hook Wiring (`src/hooks/useRoleDiscovery.ts`)
The hook will transition from mock data to the `generateClient` mutation.

```typescript
const client = generateClient<Schema>();

export function useRoleDiscovery() {
  const submitPhase = async (responses) => {
    setLoading(true);
    try {
      const { data: rawResponse } = await client.mutations.generateQuestions({
        roleContext,
        responses
      });
      
      const response = JSON.parse(rawResponse as string); // Handle JSON return
      
      // Update local state with Agent's next steps
      setRoleContext(response.updatedContext);
      setCurrentSection(response.nextSection);
    } finally {
      setLoading(false);
    }
  };
}
```

## 5. UI Integration (`src/pages/RoleDiscoveryPage.tsx`)
- The `onPhaseChange` handler in the UI will trigger the hook's `submitPhase`.
- Local "Draft" state will be synced to the sidebar in real-time.
- The "Save" button will persist the final `RoleContext` model to DynamoDB once status is 'ready'.
