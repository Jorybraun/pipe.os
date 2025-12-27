---
description: Add comprehensive logging and error tracking to code for observability
targets: ["*"]
globs: []
---

# MONITOR Task

**Persona:** Execute this task as the `@developer` subagent (Devin, Staff Engineer).
Load the persona characteristics from `.rulesync/subagents/developer.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/code-quality.md` - Logging standards and error handling patterns
- `.rulesync/rules/security.md` - Security considerations for logging
- `.rulesync/rules/architecture.md` - AWS Amplify patterns

---

## Task Objective

Add comprehensive structured logging and error tracking to code to improve observability, debugging, and monitoring in production.

---

## Task Instructions

1. **Ask discovery questions:**
   1. "What code should I add monitoring to?" (file path, function, or feature)
   2. "What level of monitoring is needed?" (basic logging, detailed tracing, error tracking)
   3. "Are there specific error scenarios we need to track?"
   4. "Should I add error boundaries for React components?"

2. **Review existing monitoring patterns:**
   - Check how console.log and console.error are used in the codebase
   - Review error handling in Amplify Data operations
   - Examine existing error boundary implementations

3. **Add structured logging:**

   **For Amplify Data Operations:**

   ```typescript
   import { generateClient } from 'aws-amplify/data';
   import type { Schema } from '@/amplify/data/resource';

   const client = generateClient<Schema>();

   export async function createPipeline(input: CreatePipelineInput) {
     console.log('[Pipeline.create] Starting', {
       name: input.name,
       stageCount: input.stages?.length || 0,
     });

     try {
       const { data, errors } = await client.models.Pipeline.create(input);

       if (errors) {
         console.error('[Pipeline.create] API Errors', {
           errors: errors.map(e => e.message),
         });
         throw new Error(errors[0]?.message || 'Failed to create pipeline');
       }

       console.log('[Pipeline.create] Success', {
         pipelineId: data?.id,
       });

       return data;
     } catch (error) {
       console.error('[Pipeline.create] Failed', {
         error: error instanceof Error ? error.message : 'Unknown error',
         input: { name: input.name },
       });
       throw error;
     }
   }
   ```

4. **Add error boundaries for React components:**

   **Create error boundary component:**

   ```typescript
   'use client';

   import { Component, type ReactNode } from 'react';

   interface Props {
     children: ReactNode;
     fallback?: ReactNode;
     name: string;
   }

   interface State {
     hasError: boolean;
     error?: Error;
   }

   export class ErrorBoundary extends Component<Props, State> {
     constructor(props: Props) {
       super(props);
       this.state = { hasError: false };
     }

     static getDerivedStateFromError(error: Error): State {
       return { hasError: true, error };
     }

     componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
       console.error('[ErrorBoundary] Component error caught', {
         component: this.props.name,
         error: error.message,
         stack: error.stack,
         componentStack: errorInfo.componentStack,
       });
     }

     render() {
       if (this.state.hasError) {
         return this.props.fallback || (
           <div className="p-4 text-red-600">
             Something went wrong. Please try again.
           </div>
         );
       }

       return this.props.children;
     }
   }
   ```

   **Use in components:**

   ```typescript
   export function PipelineList() {
     return (
       <ErrorBoundary name="PipelineList" fallback={<PipelineListError />}>
         <PipelineListContent />
       </ErrorBoundary>
     );
   }
   ```

5. **Add logging for custom hooks:**

   ```typescript
   export function usePipelines() {
     const [pipelines, setPipelines] = useState<Pipeline[]>([]);
     const [isLoading, setIsLoading] = useState(true);
     const [error, setError] = useState<Error | null>(null);

     useEffect(() => {
       console.log('[usePipelines] Setting up subscription');

       const subscription = client.models.Pipeline.observeQuery().subscribe({
         next: ({ items, isSynced }) => {
           console.log('[usePipelines] Data received', {
             count: items.length,
             isSynced,
           });
           setPipelines([...items]);
           setIsLoading(!isSynced);
         },
         error: (err) => {
           console.error('[usePipelines] Subscription error', {
             error: err.message,
           });
           setError(err);
           setIsLoading(false);
         },
       });

       return () => {
         console.log('[usePipelines] Cleaning up subscription');
         subscription.unsubscribe();
       };
     }, []);

     return { pipelines, isLoading, error };
   }
   ```

6. **Add logging at key points:**

   Log at these critical moments:
   - Hook/function entry (with input parameters)
   - Amplify Data operations
   - Business logic decisions
   - Errors and exceptions
   - Hook/function exit (with results)
   - Subscription lifecycle (setup/cleanup)

7. **Follow security best practices:**
   - Never log passwords, tokens, or secrets
   - Be cautious with user PII in logs
   - Log error codes, not sensitive error details
   - Use structured logging (JSON objects) for easy parsing

8. **Add performance monitoring:**

   Track execution time for slow operations:

   ```typescript
   const startTime = Date.now();

   try {
     const result = await slowOperation();
     const duration = Date.now() - startTime;

     console.log('[Operation] Completed', {
       operation: 'slowOperation',
       duration,
       ...(duration > 1000 && { slow: true }),
     });

     return result;
   } catch (error) {
     console.error('[Operation] Failed', {
       operation: 'slowOperation',
       duration: Date.now() - startTime,
       error: error instanceof Error ? error.message : 'Unknown',
     });
     throw error;
   }
   ```

9. **Test error scenarios:**

   Add tests to verify error handling:

   ```typescript
   import { describe, it, expect, vi } from 'vitest';
   import { createPipeline } from './pipeline';

   describe('createPipeline monitoring', () => {
     it('should log errors correctly', async () => {
       const consoleSpy = vi.spyOn(console, 'error');

       // Mock Amplify client to return error
       vi.mock('aws-amplify/data', () => ({
         generateClient: () => ({
           models: {
             Pipeline: {
               create: vi.fn().mockResolvedValue({
                 data: null,
                 errors: [{ message: 'Validation failed' }],
               }),
             },
           },
         }),
       }));

       await expect(createPipeline({ name: '' })).rejects.toThrow();

       expect(consoleSpy).toHaveBeenCalledWith(
         '[Pipeline.create] API Errors',
         expect.any(Object)
       );
     });
   });
   ```

10. **Run quality checks:**

    ```bash
    npm run lint
    npm run build
    npm run test
    ```

11. **Provide summary:**
    - List all functions/components with added monitoring
    - Show example log outputs
    - Highlight error scenarios covered
    - Provide logging query examples for monitoring

---

## Logging Levels

Use appropriate console methods:

- **`console.log`:** Normal operations, milestones
- **`console.warn`:** Recoverable issues, deprecations
- **`console.error`:** Errors requiring attention
- **`console.debug`:** Development debugging (consider removing in production)

---

## Notes

- Use structured logging (key-value pairs) for easy querying
- Be cautious with sensitive data in logs
- Keep logging performant (avoid heavy computations)
- Log enough context for debugging but not too much noise
- Test error paths to ensure they're handled correctly
- Use consistent log prefixes (e.g., [ComponentName] or [hook.action])
